import type { ClientMessage, DeviceInfo, ServerMessage } from './protocol'

export const RECONNECT_DELAY_MS = 2000
export const MAX_QUEUE = 1000

export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(): void
  onopen: ((ev?: unknown) => void) | null
  onclose: ((ev?: unknown) => void) | null
  onerror: ((ev?: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface TransportOptions {
  /** Candidate URLs, tried in order until one connects; the winner is kept. */
  urls: readonly string[]
  getDeviceInfo: () => DeviceInfo
  onMessage: (message: ServerMessage) => void
  onStatusChange?: (connected: boolean) => void
  createSocket?: WebSocketFactory
  reconnectDelayMs?: number
  maxQueue?: number
}

export interface Transport {
  connect(): void
  close(): void
  send(message: ClientMessage): void
  isConnected(): boolean
}

const OPEN = 1

// Capture the native constructor before any instrumentation can touch it.
const NativeWebSocket: (new (url: string) => WebSocketLike) | undefined = (
  globalThis as unknown as { WebSocket?: new (url: string) => WebSocketLike }
).WebSocket

export function createTransport(options: TransportOptions): Transport {
  const reconnectDelay = options.reconnectDelayMs ?? RECONNECT_DELAY_MS
  const maxQueue = options.maxQueue ?? MAX_QUEUE
  const createSocket: WebSocketFactory =
    options.createSocket ??
    ((url) => {
      if (!NativeWebSocket) throw new Error('[loupe] WebSocket is not available in this environment')
      return new NativeWebSocket(url)
    })

  let socket: WebSocketLike | null = null
  let queue: string[] = []
  let connected = false
  let shouldReconnect = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let urlIndex = 0

  const setConnected = (value: boolean): void => {
    if (connected === value) return
    connected = value
    options.onStatusChange?.(value)
  }

  const scheduleReconnect = (): void => {
    if (!shouldReconnect || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      open()
    }, reconnectDelay)
  }

  const flush = (): void => {
    if (!socket || socket.readyState !== OPEN) return
    const pending = queue
    queue = []
    pending.forEach((data) => socket?.send(data))
  }

  const handleMessage = (ev: { data: unknown }): void => {
    if (typeof ev.data !== 'string') return
    try {
      const parsed = JSON.parse(ev.data) as ServerMessage
      if (parsed && typeof parsed.type === 'string') options.onMessage(parsed)
    } catch {
      // Malformed frames from the server are ignored; never crash the host app.
    }
  }

  function open(): void {
    let current: WebSocketLike
    let opened = false
    const advance = (): void => {
      // Only rotate hosts when a socket never opened; keep a host that worked.
      if (!opened) urlIndex = (urlIndex + 1) % options.urls.length
    }
    try {
      current = createSocket(options.urls[urlIndex])
    } catch {
      advance()
      scheduleReconnect()
      return
    }
    socket = current
    // Handlers ignore events from sockets that have since been replaced or closed.
    current.onopen = () => {
      if (socket !== current) return
      opened = true
      current.send(JSON.stringify({ type: 'hello', payload: options.getDeviceInfo() } satisfies ClientMessage))
      setConnected(true)
      flush()
    }
    current.onmessage = (ev) => {
      if (socket === current) handleMessage(ev)
    }
    current.onerror = () => undefined
    current.onclose = () => {
      if (socket !== current) return
      advance()
      socket = null
      setConnected(false)
      scheduleReconnect()
    }
  }

  const detach = (target: WebSocketLike): void => {
    target.onopen = null
    target.onmessage = null
    target.onclose = null
    target.onerror = null
  }

  return {
    connect() {
      shouldReconnect = true
      if (!socket) open()
    },
    close() {
      shouldReconnect = false
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = null
      const closing = socket
      socket = null
      if (closing) {
        detach(closing)
        closing.close()
      }
      setConnected(false)
    },
    send(message) {
      let data: string
      try {
        data = JSON.stringify(message)
      } catch {
        return
      }
      if (socket && socket.readyState === OPEN) {
        socket.send(data)
        return
      }
      queue = queue.length >= maxQueue ? [...queue.slice(1), data] : [...queue, data]
    },
    isConnected: () => connected
  }
}
