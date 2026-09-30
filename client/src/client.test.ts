import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPrism, type PrismClient } from './index'
import { createTransport } from './transport'
import { FakeSocket, FakeXHR, tick } from './testing'
import type { MockRule } from './protocol'

type Msg = { type: string; payload: Record<string, unknown> }

const mockRule = (over: Partial<MockRule> = {}): MockRule => ({
  id: 'm1',
  name: 'Users mock',
  enabled: true,
  method: 'GET',
  matchType: 'contains',
  urlPattern: '/users',
  status: 201,
  headers: { 'Content-Type': 'application/json' },
  body: '{"mocked":true}',
  delayMs: 0,
  ...over
})

const g = globalThis as unknown as { XMLHttpRequest: unknown }

describe('transport', () => {
  beforeEach(() => {
    FakeSocket.instances = []
  })

  it('sends hello on open, queues while offline and flushes after', () => {
    const transport = createTransport({
      urls: ['ws://x:1'],
      getDeviceInfo: () => ({ appName: 'A', platform: 'ios' }),
      onMessage: () => undefined,
      createSocket: (url) => new FakeSocket(url)
    })
    transport.connect()
    transport.send({ type: 'console', payload: { level: 'log', args: ['queued'], timestamp: 1 } })
    const socket = FakeSocket.instances[0]
    expect(socket.sent).toHaveLength(0)
    socket.open()
    expect(socket.messages().map((m) => m.type)).toEqual(['hello', 'console'])
    expect(transport.isConnected()).toBe(true)
  })

  it('drops the oldest queued messages beyond the max and reconnects on close', () => {
    vi.useFakeTimers()
    const transport = createTransport({
      urls: ['ws://x:1'],
      getDeviceInfo: () => ({ appName: 'A', platform: 'ios' }),
      onMessage: () => undefined,
      createSocket: (url) => new FakeSocket(url),
      maxQueue: 2,
      reconnectDelayMs: 50
    })
    transport.connect()
    ;[1, 2, 3].forEach((n) => transport.send({ type: 'console', payload: { level: 'log', args: [n], timestamp: n } }))
    FakeSocket.instances[0].close()
    vi.advanceTimersByTime(60)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1].open()
    const args = FakeSocket.instances[1]
      .messages()
      .slice(1)
      .map((m) => (m.payload.args as number[])[0])
    expect(args).toEqual([2, 3])
    transport.close()
    vi.useRealTimers()
  })

  it('ignores malformed server frames', () => {
    const onMessage = vi.fn()
    const transport = createTransport({
      urls: ['ws://x:1'],
      getDeviceInfo: () => ({ appName: 'A', platform: 'ios' }),
      onMessage,
      createSocket: (url) => new FakeSocket(url)
    })
    transport.connect()
    const socket = FakeSocket.instances[0]
    socket.onmessage?.({ data: '{not json' })
    socket.onmessage?.({ data: 42 })
    socket.receive({ type: 'app.reload', payload: {} })
    expect(onMessage).toHaveBeenCalledTimes(1)
  })
})

describe('createPrism', () => {
  let originalXhr: unknown
  let prism: PrismClient
  let socket: FakeSocket

  beforeEach(() => {
    FakeSocket.instances = []
    FakeXHR.sendCount = 0
    originalXhr = g.XMLHttpRequest
    g.XMLHttpRequest = FakeXHR
    prism = createPrism({
      appName: 'Test',
      host: 'localhost',
      console: false,
      performance: false,
      ignoreUrls: ['localhost:8081/symbolicate'],
      createSocket: (url) => new FakeSocket(url)
    }).connect()
    socket = FakeSocket.instances[0]
    socket.open()
  })

  afterEach(() => {
    prism.disconnect()
    g.XMLHttpRequest = originalXhr
  })

  const sent = (type: string): Msg[] => socket.messages<Msg>().filter((m) => m.type === type)

  it('captures XHR request and response', async () => {
    FakeXHR.nextResponse = { status: 200, body: '{"ok":1}', headers: 'Content-Type: application/json\r\n' }
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    xhr.open('post', 'https://api.test/items')
    xhr.setRequestHeader('Authorization', 'Bearer t')
    xhr.send('{"a":1}')
    await tick(5)
    const [request] = sent('network.request')
    expect(request.payload).toMatchObject({
      method: 'POST',
      url: 'https://api.test/items',
      headers: { authorization: 'Bearer t' },
      body: '{"a":1}'
    })
    const [response] = sent('network.response')
    expect(response.payload).toMatchObject({ id: request.payload.id, status: 200, body: '{"ok":1}' })
    expect(response.payload.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('serves mocked responses without hitting the network', async () => {
    socket.receive({ type: 'mocks.update', payload: { mocks: [mockRule()] } })
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    const onLoad = vi.fn()
    xhr.addEventListener('load', onLoad)
    xhr.open('GET', 'https://api.test/users/1')
    xhr.send()
    await tick(5)
    expect(FakeXHR.sendCount).toBe(0)
    expect(onLoad).toHaveBeenCalledTimes(1)
    expect(xhr.status).toBe(201)
    expect(xhr.responseText).toBe('{"mocked":true}')
    expect(xhr.getResponseHeader('content-type')).toBe('application/json')
    const responses = sent('network.response')
    expect(responses).toHaveLength(1)
    expect(responses[0].payload.mockedBy).toBe('Users mock')
  })

  it('fails requests when offline simulation is enabled', async () => {
    socket.receive({ type: 'network.conditions', payload: { offline: true, latencyMs: 0 } })
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    const onError = vi.fn()
    xhr.addEventListener('error', onError)
    xhr.open('GET', 'https://api.test/x')
    xhr.send()
    await tick(5)
    expect(FakeXHR.sendCount).toBe(0)
    expect(onError).toHaveBeenCalled()
    expect(sent('network.error')[0].payload.kind).toBe('offline')
  })

  it('does not capture URLs listed in ignoreUrls', () => {
    const xhr = new (g.XMLHttpRequest as typeof XMLHttpRequest)()
    xhr.open('POST', 'http://localhost:8081/symbolicate')
    xhr.send()
    expect(sent('network.request')).toHaveLength(0)
  })

  it('runs registered commands and reports results', async () => {
    prism.registerCommand({
      id: 'add',
      title: 'Add',
      args: [
        { name: 'a', type: 'number' },
        { name: 'b', type: 'number' }
      ],
      handler: ({ a, b }) => (a as number) + (b as number)
    })
    prism.registerCommand({ id: 'boom', title: 'Boom', handler: () => Promise.reject(new Error('bad')) })
    expect(sent('commands.register').at(-1)?.payload.commands).toHaveLength(2)
    socket.receive({ type: 'command.run', payload: { commandId: 'add', runId: 'r1', args: { a: '2', b: 3 } } })
    socket.receive({ type: 'command.run', payload: { commandId: 'boom', runId: 'r2', args: {} } })
    socket.receive({ type: 'command.run', payload: { commandId: 'nope', runId: 'r3', args: {} } })
    await tick()
    const results = sent('command.result').map((m) => m.payload)
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: 'r1', ok: true, result: 5 }),
        expect.objectContaining({ runId: 'r2', ok: false, error: 'bad' }),
        expect.objectContaining({ runId: 'r3', ok: false, error: 'Unknown command' })
      ])
    )
  })

  it('tracks a redux store, supports dispatch and time-travel restore', () => {
    type Action = { type: string; payload?: unknown }
    const reducer = (state: unknown = { count: 0 }, action: Action) =>
      action.type === 'inc' ? { count: (state as { count: number }).count + 1 } : state
    const createStore = (r: (s: unknown, a: Action) => unknown) => {
      let state = r(undefined, { type: '@@INIT' })
      return {
        getState: () => state,
        dispatch: (a: unknown) => {
          state = r(state, a as Action)
          return a
        },
        subscribe: () => () => undefined,
        replaceReducer: () => undefined
      }
    }
    const store = prism.reduxEnhancer('main')(createStore as never)(reducer as never)
    store.dispatch({ type: 'inc' })
    expect(sent('state.action')[0].payload).toMatchObject({
      store: 'main',
      action: { type: 'inc' },
      nextState: { count: 1 }
    })
    socket.receive({ type: 'state.dispatch', payload: { store: 'main', action: { type: 'inc' } } })
    expect(store.getState()).toEqual({ count: 2 })
    socket.receive({ type: 'state.restore', payload: { store: 'main', state: { count: 0 } } })
    expect(store.getState()).toEqual({ count: 0 })
    expect(sent('state.snapshot').at(-1)?.payload.state).toEqual({ count: 0 })
  })

  it('tracks zustand-like stores', () => {
    let state: Record<string, unknown> = { a: 1 }
    const listeners: Array<(s: unknown, p: unknown) => void> = []
    const store = {
      getState: () => state,
      setState: (partial: unknown, replace?: boolean) => {
        const prev = state
        state = replace ? (partial as Record<string, unknown>) : { ...state, ...(partial as object) }
        listeners.forEach((l) => l(state, prev))
      },
      subscribe: (l: (s: unknown, p: unknown) => void) => {
        listeners.push(l)
        return () => undefined
      }
    }
    prism.trackZustand('ui', store)
    store.setState({ b: 2 })
    expect(sent('state.action')[0].payload.nextState).toEqual({ a: 1, b: 2 })
    socket.receive({ type: 'state.restore', payload: { store: 'ui', state: { a: 9 } } })
    expect(state).toEqual({ a: 9 })
  })

  it('reports errors and tagged logs', () => {
    prism.reportError(new Error('render failed'), 'in <App>')
    prism.warn('careful', { x: 1 })
    expect(sent('error')[0].payload).toMatchObject({
      message: 'render failed',
      componentStack: 'in <App>',
      isFatal: false
    })
    expect(sent('console')[0].payload).toMatchObject({ level: 'warn', tag: 'prism', args: ['careful', { x: 1 }] })
  })
})

describe('asyncStorage bridge', () => {
  it('snapshots, mutates and refreshes storage', async () => {
    FakeSocket.instances = []
    const data = new Map<string, string>([['token', 'abc']])
    const storage = {
      getAllKeys: async () => Array.from(data.keys()),
      multiGet: async (keys: readonly string[]) => keys.map((k) => [k, data.get(k) ?? null] as const),
      setItem: async (k: string, v: string) => {
        data.set(k, v)
      },
      removeItem: async (k: string) => {
        data.delete(k)
      },
      clear: async () => data.clear()
    }
    const prism = createPrism({
      host: 'h',
      network: false,
      console: false,
      performance: false,
      errors: false,
      asyncStorage: storage,
      createSocket: (url) => new FakeSocket(url)
    }).connect()
    const socket = FakeSocket.instances[0]
    socket.open()
    socket.receive({ type: 'storage.set', payload: { key: 'user', value: '{"id":1}' } })
    await tick(5)
    socket.receive({ type: 'storage.remove', payload: { key: 'token' } })
    await tick(5)
    const snapshots = socket.messages<Msg>().filter((m) => m.type === 'storage.snapshot')
    expect(snapshots.at(-1)?.payload.entries).toEqual([['user', '{"id":1}']])
    socket.receive({ type: 'storage.clear', payload: {} })
    await tick(5)
    expect(data.size).toBe(0)
    prism.disconnect()
  })
})
