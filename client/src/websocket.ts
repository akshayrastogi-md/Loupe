import type { ClientMessage } from './protocol'

/** Frame payloads larger than this are truncated before being sent to Loupe. */
export const MAX_FRAME_CHARS = 64 * 1024

export interface WebSocketContext {
  send(message: ClientMessage): void
  nextId(): string
  /** URLs matching these substrings are never recorded (Metro HMR, inspector). */
  ignoreUrls: readonly string[]
}

type SocketCtor = new (url: string, protocols?: string | string[], ...rest: unknown[]) => WebSocket

function describeFrame(data: unknown): { data: string; binary: boolean; size: number; truncated?: boolean } {
  if (typeof data === 'string') {
    const truncated = data.length > MAX_FRAME_CHARS
    return { data: truncated ? data.slice(0, MAX_FRAME_CHARS) : data, binary: false, size: data.length, truncated }
  }
  const size =
    (data as { byteLength?: number })?.byteLength ?? (data as { size?: number })?.size ?? (data as { length?: number })?.length ?? 0
  return { data: `[Binary ${size} bytes]`, binary: true, size }
}

/**
 * Wrap the global WebSocket so app sockets are recorded. Loupe's own transport
 * captured the native constructor at import time, so it is never recorded.
 * Returns an uninstall function and a way to send a frame into a live socket.
 */
export function installWebSocket(ctx: WebSocketContext): { uninstall: () => void; sendTo: (id: string, data: string) => boolean } {
  const g = globalThis as { WebSocket?: SocketCtor }
  const Original = g.WebSocket
  const live = new Map<string, WebSocket>()
  if (!Original) return { uninstall: () => undefined, sendTo: () => false }

  const shouldIgnore = (url: string): boolean => ctx.ignoreUrls.some((pattern) => url.includes(pattern))

  const instrument = (socket: WebSocket, url: string, protocols?: string | string[]): void => {
    const id = ctx.nextId()
    live.set(id, socket)
    const now = Date.now
    const safe = (fn: () => void): void => {
      try {
        fn()
      } catch {
        // Instrumentation must never break the app's socket.
      }
    }
    ctx.send({
      type: 'ws.open',
      payload: { id, url, protocols: protocols === undefined ? undefined : ([] as string[]).concat(protocols), timestamp: now() }
    })
    socket.addEventListener('open', () =>
      safe(() => ctx.send({ type: 'ws.status', payload: { id, status: 'open', timestamp: now() } }))
    )
    socket.addEventListener('message', (event: MessageEvent) =>
      safe(() =>
        ctx.send({ type: 'ws.frame', payload: { id, direction: 'received', ...describeFrame(event.data), timestamp: now() } })
      )
    )
    socket.addEventListener('error', () =>
      safe(() => ctx.send({ type: 'ws.status', payload: { id, status: 'error', timestamp: now() } }))
    )
    socket.addEventListener('close', (event: CloseEvent) =>
      safe(() => {
        live.delete(id)
        ctx.send({ type: 'ws.status', payload: { id, status: 'closed', code: event.code, reason: event.reason, timestamp: now() } })
      })
    )
    const originalSend = socket.send.bind(socket)
    socket.send = (data: Parameters<WebSocket['send']>[0]) => {
      originalSend(data)
      safe(() => ctx.send({ type: 'ws.frame', payload: { id, direction: 'sent', ...describeFrame(data), timestamp: now() } }))
    }
  }

  class LoupeWebSocket extends (Original as SocketCtor) {
    constructor(url: string, protocols?: string | string[], ...rest: unknown[]) {
      super(url, protocols, ...rest)
      const urlString = String(url)
      if (!shouldIgnore(urlString)) instrument(this as unknown as WebSocket, urlString, protocols)
    }
  }

  g.WebSocket = LoupeWebSocket as unknown as SocketCtor
  return {
    uninstall: () => {
      g.WebSocket = Original
      live.clear()
    },
    sendTo: (id, data) => {
      const socket = live.get(id)
      if (!socket || socket.readyState !== 1) return false
      socket.send(data)
      return true
    }
  }
}
