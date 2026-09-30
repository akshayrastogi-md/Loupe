import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { DeviceInfo, MockRule, NetworkConditions, ServerMessage } from '@shared/protocol'
import type { DeviceSummary, HubEvent, ServerStatus } from '@shared/types'
import { parseClientMessage } from './validate'

export const HELLO_TIMEOUT_MS = 10_000
export const FLUSH_INTERVAL_MS = 50
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
export const MAX_PENDING_CONNECTIONS = 32

/**
 * Browsers always send an Origin header, so a web page could otherwise open a
 * socket to the local port. React Native's native WebSocket either omits it or
 * sets it to the target URL itself, so we only accept origins that match Host.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || origin === 'null') return !origin
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export interface HubOptions {
  getWelcome: () => { mocks: MockRule[]; conditions: NetworkConditions }
  onEvents: (events: HubEvent[]) => void
  onStatus?: (status: ServerStatus) => void
  onWarning?: (message: string) => void
  flushIntervalMs?: number
  helloTimeoutMs?: number
}

interface Connection {
  socket: WebSocket
  summary?: DeviceSummary
}

export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net): net is NonNullable<typeof net> => Boolean(net) && net!.family === 'IPv4' && !net!.internal)
    .map((net) => net.address)
}

/**
 * WebSocket server that devices connect to. Incoming frames are validated,
 * then batched and handed to the renderer in small bursts to keep IPC cheap.
 */
export class DeviceHub {
  private server: WebSocketServer | null = null
  private connections = new Map<WebSocket, Connection>()
  private devices = new Map<string, Connection>()
  private pending: HubEvent[] = []
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private status: ServerStatus = { listening: false, port: 0, host: '', addresses: [] }
  private lifecycle: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: HubOptions) {}

  getStatus(): ServerStatus {
    return this.status
  }

  listDevices(): DeviceSummary[] {
    return Array.from(this.devices.values()).flatMap((c) => (c.summary ? [c.summary] : []))
  }

  /** Start (or restart) the server. Calls are serialized so restarts never race. */
  start(port: number, allowLan: boolean): Promise<ServerStatus> {
    const run = this.lifecycle.then(() => this.doStart(port, allowLan))
    this.lifecycle = run.catch(() => undefined)
    return run
  }

  stop(): Promise<void> {
    const run = this.lifecycle.then(() => this.doStop())
    this.lifecycle = run.catch(() => undefined)
    return run
  }

  private async doStart(port: number, allowLan: boolean): Promise<ServerStatus> {
    await this.doStop()
    const host = allowLan ? '0.0.0.0' : '127.0.0.1'
    const addresses = allowLan ? ['localhost', ...lanAddresses()] : ['localhost']
    this.status = await new Promise<ServerStatus>((resolve) => {
      const server = new WebSocketServer({
        port,
        host,
        maxPayload: MAX_PAYLOAD_BYTES,
        verifyClient: ({ req }: { req: IncomingMessage }) =>
          isAllowedOrigin(req.headers.origin, req.headers.host) && this.pendingCount() < MAX_PENDING_CONNECTIONS
      })
      server.once('listening', () => {
        this.server = server
        resolve({ listening: true, port, host, addresses })
      })
      server.once('error', (err: NodeJS.ErrnoException) => {
        server.close()
        const reason = err.code === 'EADDRINUSE' ? `Port ${port} is already in use` : err.message
        resolve({ listening: false, port, host, addresses, error: reason })
      })
      server.on('connection', (socket, req) => this.handleConnection(socket, req))
    })
    this.options.onStatus?.(this.status)
    return this.status
  }

  private pendingCount(): number {
    let count = 0
    this.connections.forEach((c) => {
      if (!c.summary) count += 1
    })
    return count
  }

  private async doStop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    this.connections.forEach(({ socket }) => socket.terminate())
    await new Promise<void>((resolve) => server.close(() => resolve()))
    this.flush()
    this.status = { ...this.status, listening: false }
  }

  send(deviceId: string, message: ServerMessage): boolean {
    const conn = this.devices.get(deviceId)
    if (!conn || conn.socket.readyState !== WebSocket.OPEN) return false
    conn.socket.send(JSON.stringify(message))
    return true
  }

  broadcast(message: ServerMessage): void {
    const data = JSON.stringify(message)
    this.devices.forEach(({ socket }) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    })
  }

  private handleConnection(socket: WebSocket, req: IncomingMessage): void {
    const conn: Connection = { socket }
    this.connections.set(socket, conn)
    const helloTimer = setTimeout(() => {
      if (!conn.summary) socket.close(4000, 'hello timeout')
    }, this.options.helloTimeoutMs ?? HELLO_TIMEOUT_MS)

    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      try {
        this.handleFrame(conn, data.toString(), req, helloTimer)
      } catch (err) {
        this.options.onWarning?.(`Failed to handle frame: ${(err as Error).message}`)
      }
    })

    socket.on('close', () => {
      clearTimeout(helloTimer)
      this.connections.delete(socket)
      if (conn.summary) {
        this.devices.delete(conn.summary.id)
        this.enqueue({ kind: 'device.disconnected', deviceId: conn.summary.id })
      }
    })
    socket.on('error', (err) => this.options.onWarning?.(`Socket error: ${err.message}`))
  }

  private handleFrame(
    conn: Connection,
    raw: string,
    req: IncomingMessage,
    helloTimer: ReturnType<typeof setTimeout>
  ): void {
    const parsed = parseClientMessage(raw)
    if (!parsed.ok) {
      this.options.onWarning?.(`Dropped message from ${req.socket.remoteAddress}: ${parsed.reason}`)
      return
    }
    const { message } = parsed
    if (message.type === 'hello') {
      clearTimeout(helloTimer)
      this.registerDevice(conn, message.payload, req.socket.remoteAddress ?? 'unknown')
      return
    }
    if (!conn.summary) return // ignore traffic before handshake
    this.enqueue({ kind: 'message', deviceId: conn.summary.id, message, receivedAt: Date.now() })
  }

  private registerDevice(conn: Connection, info: DeviceInfo, remoteAddress: string): void {
    if (conn.summary) return
    const summary: DeviceSummary = { id: randomUUID(), info, connectedAt: Date.now(), remoteAddress }
    conn.summary = summary
    this.devices.set(summary.id, conn)
    const welcome: ServerMessage = { type: 'welcome', payload: { deviceId: summary.id, ...this.options.getWelcome() } }
    conn.socket.send(JSON.stringify(welcome))
    this.enqueue({ kind: 'device.connected', device: summary })
  }

  private enqueue(event: HubEvent): void {
    this.pending = [...this.pending, event]
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.options.flushIntervalMs ?? FLUSH_INTERVAL_MS)
    }
  }

  private flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = null
    if (!this.pending.length) return
    const events = this.pending
    this.pending = []
    this.options.onEvents(events)
  }
}
