import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLoupe, type LoupeClient } from './index'
import { createTransport } from './transport'
import { FakeSocket, FakeXHR, tick } from './testing'
import type { MockRule } from './protocol'

type Msg = { type: string; payload: Record<string, unknown> }
const g = globalThis as unknown as { XMLHttpRequest: unknown }

const mock = (over: Partial<MockRule> = {}): MockRule => ({
  id: 'm',
  name: 'mock',
  enabled: true,
  method: 'ANY',
  matchType: 'contains',
  urlPattern: '/users',
  status: 200,
  headers: {},
  body: '{}',
  delayMs: 30,
  ...over
})

describe('transport socket lifecycle', () => {
  it('ignores a stale socket closing after reconnect', () => {
    FakeSocket.instances = []
    const transport = createTransport({
      urls: ['ws://x'],
      getDeviceInfo: () => ({ appName: 'A', platform: 'ios' }),
      onMessage: () => undefined,
      createSocket: (url) => new FakeSocket(url)
    })
    transport.connect()
    const first = FakeSocket.instances[0]
    first.open()
    const staleClose = first.onclose
    transport.close()
    transport.connect()
    const second = FakeSocket.instances[1]
    second.open()
    staleClose?.() // late close event from the old socket
    expect(transport.isConnected()).toBe(true)
    expect(FakeSocket.instances).toHaveLength(2)
    transport.send({ type: 'console', payload: { level: 'log', args: [], timestamp: 1 } })
    expect(second.messages().at(-1)?.type).toBe('console')
    transport.close()
  })
})

describe('network safety', () => {
  let originalXhr: unknown
  let loupe: LoupeClient
  let socket: FakeSocket

  beforeEach(() => {
    FakeSocket.instances = []
    FakeXHR.sendCount = 0
    originalXhr = g.XMLHttpRequest
    g.XMLHttpRequest = FakeXHR
    loupe = createLoupe({
      host: 'h',
      console: false,
      performance: false,
      errors: false,
      createSocket: (u) => new FakeSocket(u)
    }).connect()
    socket = FakeSocket.instances[0]
    socket.open()
  })

  afterEach(() => {
    loupe.disconnect()
    g.XMLHttpRequest = originalXhr
  })

  const sent = (type: string): Msg[] => socket.messages<Msg>().filter((m) => m.type === type)

  it('resets offline simulation and mocks when the desktop disconnects', async () => {
    vi.useFakeTimers()
    socket.receive({ type: 'network.conditions', payload: { offline: true, latencyMs: 0 } })
    socket.receive({ type: 'mocks.update', payload: { mocks: [mock({ delayMs: 0 })] } })
    socket.close()
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    xhr.open('GET', 'https://api/users')
    xhr.send()
    expect(FakeXHR.sendCount).toBe(1) // went to the real network
    vi.useRealTimers()
  })

  it('does not deliver a mocked response to an aborted XHR', async () => {
    socket.receive({ type: 'mocks.update', payload: { mocks: [mock()] } })
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    const onLoad = vi.fn()
    xhr.addEventListener('load', onLoad)
    xhr.open('GET', 'https://api/users')
    xhr.send()
    ;(xhr as unknown as { dispatchEvent(e: { type: string }): void }).dispatchEvent({ type: 'abort' })
    await tick(50)
    expect(onLoad).not.toHaveBeenCalled()
    expect(sent('network.response')).toHaveLength(0)
    expect(sent('network.error')[0].payload.kind).toBe('abort')
  })

  it('keeps mocked XHR properties writable for RN resets', async () => {
    socket.receive({ type: 'mocks.update', payload: { mocks: [mock({ delayMs: 0 })] } })
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    xhr.open('GET', 'https://api/users')
    xhr.send()
    await tick(5)
    expect(() => {
      ;(xhr as unknown as { readyState: number; status: number }).readyState = 0
      ;(xhr as unknown as { status: number }).status = 0
    }).not.toThrow()
  })

  it('rejects mocked fetches whose signal was aborted', async () => {
    socket.receive({ type: 'mocks.update', payload: { mocks: [mock()] } })
    const controller = new AbortController()
    const pending = fetch('https://api/users', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('serves null-body mocked statuses through fetch', async () => {
    socket.receive({ type: 'mocks.update', payload: { mocks: [mock({ status: 205, delayMs: 0, body: 'x' })] } })
    const res = await fetch('https://api/users')
    expect(res.status).toBe(205)
  })

  it('still captures app endpoints whose paths resemble Metro routes', () => {
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    xhr.open('GET', 'https://api.example.com/logs/recent')
    xhr.send()
    expect(sent('network.request')).toHaveLength(1)
  })
})

describe('host fallback', () => {
  it('rotates hosts until one connects, then sticks with it', () => {
    vi.useFakeTimers()
    FakeSocket.instances = []
    const transport = createTransport({
      urls: ['ws://192.168.1.6:9393', 'ws://localhost:9393'],
      getDeviceInfo: () => ({ appName: 'A', platform: 'ios' }),
      onMessage: () => undefined,
      createSocket: (url) => new FakeSocket(url),
      reconnectDelayMs: 10
    })
    transport.connect()
    FakeSocket.instances[0].close() // LAN host refused
    vi.advanceTimersByTime(20)
    expect(FakeSocket.instances[1].url).toBe('ws://localhost:9393')
    FakeSocket.instances[1].open()
    FakeSocket.instances[1].close() // desktop restarted after a successful session
    vi.advanceTimersByTime(20)
    expect(FakeSocket.instances[2].url).toBe('ws://localhost:9393')
    transport.close()
    vi.useRealTimers()
  })
})

describe('fetch capture', () => {
  const realFetch = globalThis.fetch
  let socket: FakeSocket
  let loupe: LoupeClient
  let originalXhr: unknown

  const setup = (fetchImpl: typeof fetch): void => {
    FakeSocket.instances = []
    originalXhr = g.XMLHttpRequest
    g.XMLHttpRequest = FakeXHR
    globalThis.fetch = fetchImpl
    loupe = createLoupe({
      host: 'h',
      console: false,
      performance: false,
      errors: false,
      createSocket: (u) => new FakeSocket(u)
    }).connect()
    socket = FakeSocket.instances[0]
    socket.open()
  }

  afterEach(() => {
    loupe.disconnect()
    globalThis.fetch = realFetch
    g.XMLHttpRequest = originalXhr
  })

  const sent = (type: string): Msg[] => socket.messages<Msg>().filter((m) => m.type === type)

  it('captures native (non-XHR) fetch requests and responses', async () => {
    setup(async () => new Response('{"ok":true}', { status: 201, headers: { 'content-type': 'application/json' } }))
    const res = await fetch('https://api.test/items', { method: 'POST', body: '{"a":1}' })
    expect(await res.json()).toEqual({ ok: true }) // app still reads the body
    await tick(5)
    expect(sent('network.request')[0].payload).toMatchObject({ method: 'POST', source: 'fetch', body: '{"a":1}' })
    expect(sent('network.response')[0].payload).toMatchObject({ status: 201, body: '{"ok":true}' })
  })

  it('reports native fetch failures', async () => {
    setup(async () => {
      throw new TypeError('Network request failed')
    })
    await expect(fetch('https://api.test/x')).rejects.toThrow('Network request failed')
    expect(sent('network.error')[0].payload.kind).toBe('error')
  })

  it('resends requests from the device when the desktop asks', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    setup((async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch)
    socket.receive({
      type: 'network.resend',
      payload: { url: 'https://api.test/edit', method: 'patch', headers: { 'x-a': '1' }, body: '{"b":2}' }
    })
    socket.receive({ type: 'network.resend', payload: { url: 'file:///etc/passwd', method: 'GET', headers: {} } })
    socket.receive({
      type: 'network.resend',
      payload: { url: 'https://api.test/get', method: 'GET', headers: {}, body: 'x' }
    })
    await tick(5)
    expect(calls.map(([u]) => u)).toEqual(['https://api.test/edit', 'https://api.test/get'])
    expect(calls[0][1]).toMatchObject({ method: 'PATCH', body: '{"b":2}' })
    expect(calls[1][1]?.body).toBeUndefined()
    expect(sent('network.request').map((m) => m.payload.url)).toEqual(['https://api.test/edit', 'https://api.test/get'])
  })

  it('does not double-capture XHR-based fetch polyfills', async () => {
    FakeXHR.nextResponse = { status: 200, body: 'hi', headers: '' }
    setup(
      (() =>
        new Promise<Response>((resolve) => {
          const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
          xhr.open('GET', 'https://api.test/poly')
          xhr.onload = () => resolve(new Response('hi'))
          xhr.send()
        })) as typeof fetch
    )
    await fetch('https://api.test/poly')
    await tick(5)
    expect(sent('network.request')).toHaveLength(1)
    expect(sent('network.request')[0].payload.source).toBe('xhr')
  })
})
