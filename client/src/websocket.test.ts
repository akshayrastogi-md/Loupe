import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installWebSocket, MAX_FRAME_CHARS } from './websocket'
import type { ClientMessage } from './protocol'

class FakeWS extends EventTarget {
  static last: FakeWS | null = null
  readyState = 0
  sent: unknown[] = []
  constructor(
    public url: string,
    public protocols?: string | string[]
  ) {
    super()
    FakeWS.last = this
  }
  send(data: unknown): void {
    this.sent.push(data)
  }
  open(): void {
    this.readyState = 1
    this.dispatchEvent(new Event('open'))
  }
  receive(data: unknown): void {
    const event = new Event('message')
    Object.assign(event, { data })
    this.dispatchEvent(event)
  }
  close(code = 1000, reason = ''): void {
    this.readyState = 3
    const event = new Event('close')
    Object.assign(event, { code, reason })
    this.dispatchEvent(event)
  }
}

const g = globalThis as unknown as { WebSocket: unknown }

describe('installWebSocket', () => {
  let original: unknown
  let sent: ClientMessage[]
  let seq: number
  let api: ReturnType<typeof installWebSocket>

  beforeEach(() => {
    original = g.WebSocket
    g.WebSocket = FakeWS
    sent = []
    seq = 0
    api = installWebSocket({ send: (m) => sent.push(m), nextId: () => `s${seq++}`, ignoreUrls: ['//localhost:8081/hot'] })
  })

  afterEach(() => {
    api.uninstall()
    g.WebSocket = original
  })

  const create = (url: string, protocols?: string | string[]): FakeWS => {
    const Ctor = g.WebSocket as new (url: string, protocols?: string | string[]) => FakeWS
    return new Ctor(url, protocols)
  }

  it('records the socket lifecycle and frames in both directions', () => {
    const ws = create('wss://chat.dev/socket', 'v1')
    ws.open()
    ws.send('{"type":"hello"}')
    ws.receive('{"type":"welcome"}')
    ws.close(4001, 'bye')
    expect(sent.map((m) => m.type)).toEqual(['ws.open', 'ws.status', 'ws.frame', 'ws.frame', 'ws.status'])
    expect(sent[0].payload).toMatchObject({ id: 's0', url: 'wss://chat.dev/socket', protocols: ['v1'] })
    expect(sent[2].payload).toMatchObject({ direction: 'sent', data: '{"type":"hello"}', binary: false })
    expect(sent[3].payload).toMatchObject({ direction: 'received', data: '{"type":"welcome"}' })
    expect(sent[4].payload).toMatchObject({ status: 'closed', code: 4001, reason: 'bye' })
    expect(ws.sent).toEqual(['{"type":"hello"}']) // the app's send still works
  })

  it('summarizes binary frames and truncates huge text frames', () => {
    const ws = create('wss://x')
    ws.open()
    ws.receive(new Uint8Array(12).buffer)
    ws.receive('a'.repeat(MAX_FRAME_CHARS + 10))
    const frames = sent.filter((m) => m.type === 'ws.frame').map((m) => m.payload as Record<string, unknown>)
    expect(frames[0]).toMatchObject({ binary: true, size: 12, data: '[Binary 12 bytes]' })
    expect(frames[1]).toMatchObject({ truncated: true, size: MAX_FRAME_CHARS + 10 })
    expect((frames[1].data as string).length).toBe(MAX_FRAME_CHARS)
  })

  it('ignores Metro sockets', () => {
    create('ws://localhost:8081/hot?bundleEntry=index')
    expect(sent).toHaveLength(0)
  })

  it('sends frames from the desktop into live sockets only', () => {
    const ws = create('wss://x')
    expect(api.sendTo('s0', 'early')).toBe(false) // not open yet
    ws.open()
    expect(api.sendTo('s0', 'ping')).toBe(true)
    expect(ws.sent).toEqual(['ping'])
    expect(api.sendTo('missing', 'x')).toBe(false)
    ws.close()
    expect(api.sendTo('s0', 'late')).toBe(false)
  })

  it('restores the original constructor on uninstall', () => {
    api.uninstall()
    expect(g.WebSocket).toBe(FakeWS)
  })
})
