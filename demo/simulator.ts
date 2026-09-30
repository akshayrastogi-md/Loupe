/**
 * Simulated React Native app for trying Loupe without a device.
 * Speaks the real wire protocol: network traffic, logs, errors, Redux-style
 * state, AsyncStorage, perf samples and custom commands. Honors mocks,
 * offline simulation, dispatch, time travel and storage edits from the desktop.
 *
 *   npm run demo            (connects to ws://localhost:9393)
 *   PORT=9400 npm run demo
 */
import type {
  ClientMessage,
  ConsolePayload,
  MockRule,
  NetworkConditions,
  ServerMessage
} from '../client/src/protocol.ts'

const PORT = Number(process.env.PORT ?? 9393)
const URL_BASE = 'https://api.shopfront.dev/v2'
const TICK_MS = 1800

let socket: WebSocket
let mocks: MockRule[] = []
let conditions: NetworkConditions = { offline: false, latencyMs: 0 }
let seq = 0
let state = {
  auth: { user: null as null | { id: number; name: string } },
  cart: { items: [] as Array<{ sku: string; qty: number }>, total: 0 },
  ui: { theme: 'dark', onboarded: false }
}
let storage = new Map<string, string>([
  ['@auth/token', 'eyJhbGciOiJIUzI1NiJ9.demo.signature'],
  ['@prefs', JSON.stringify({ theme: 'dark', notifications: true, locale: 'en-IN' })],
  ['@cart/draft', JSON.stringify({ items: [{ sku: 'SKU-104', qty: 2 }] })]
])

const send = (message: ClientMessage): void => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}
const id = (): string => `demo-${Date.now().toString(36)}-${(seq++).toString(36)}`
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function reducer(s: typeof state, action: { type: string; payload?: unknown }): typeof state {
  switch (action.type) {
    case 'auth/login':
      return { ...s, auth: { user: action.payload as { id: number; name: string } } }
    case 'auth/logout':
      return { ...s, auth: { user: null } }
    case 'cart/add': {
      const item = action.payload as { sku: string; qty: number }
      const items = [...s.cart.items, item]
      return { ...s, cart: { items, total: items.reduce((t, i) => t + i.qty * 499, 0) } }
    }
    case 'cart/clear':
      return { ...s, cart: { items: [], total: 0 } }
    case 'ui/toggleTheme':
      return { ...s, ui: { ...s.ui, theme: s.ui.theme === 'dark' ? 'light' : 'dark' } }
    default:
      return s
  }
}

function dispatch(action: { type: string; payload?: unknown }): void {
  const start = performance.now()
  state = reducer(state, action)
  send({
    type: 'state.action',
    payload: {
      store: 'redux',
      action,
      nextState: state,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
      timestamp: Date.now()
    }
  })
}

const storageSnapshot = (): void =>
  send({ type: 'storage.snapshot', payload: { entries: Array.from(storage.entries()) } })

interface Endpoint {
  method: string
  path: string
  status: number
  gql?: string
  image?: boolean
  body: () => unknown
}

const ENDPOINTS: readonly Endpoint[] = [
  {
    method: 'GET',
    path: '/products?page=1&limit=20',
    status: 200,
    body: () => ({
      page: 1,
      items: Array.from({ length: 5 }, (_, i) => ({
        id: 100 + i,
        title: pick(['Linen Shirt', 'Denim Jacket', 'Canvas Sneakers', 'Leather Belt', 'Wool Scarf']),
        price: 499 + i * 150,
        inStock: i % 3 !== 0
      }))
    })
  },
  {
    method: 'GET',
    path: '/me',
    status: 200,
    body: () => ({ id: 7, name: 'Asha', email: 'asha@example.com', plan: 'pro' })
  },
  {
    method: 'POST',
    path: '/cart/items',
    status: 201,
    body: () => ({ ok: true, cartId: 'c_91', count: state.cart.items.length })
  },
  {
    method: 'GET',
    path: '/recommendations',
    status: 200,
    body: () => ({
      items: [
        { id: 5, score: 0.92 },
        { id: 9, score: 0.81 }
      ]
    })
  },
  {
    method: 'POST',
    path: '/graphql',
    status: 200,
    gql: 'query GetOrders { orders { id total } }',
    body: () => ({ data: { orders: [{ id: 'o_1', total: 1299 }] } })
  },
  { method: 'GET', path: '/orders/9999', status: 404, body: () => ({ error: 'Order not found' }) },
  {
    method: 'POST',
    path: '/checkout',
    status: 500,
    body: () => ({ error: 'Payment gateway timeout', code: 'PGW_504' })
  },
  { method: 'GET', path: '/assets/banner.png', status: 200, image: true, body: () => '' }
]

async function fakeRequest(): Promise<void> {
  const endpoint = pick(ENDPOINTS)
  const url = endpoint.image ? 'https://picsum.photos/seed/loupe/600/240' : `${URL_BASE}${endpoint.path}`
  const reqId = id()
  const body = endpoint.gql
    ? JSON.stringify({ query: endpoint.gql, operationName: 'GetOrders' })
    : endpoint.method === 'POST'
      ? JSON.stringify({ sku: 'SKU-104', qty: 1 })
      : undefined
  send({
    type: 'network.request',
    payload: {
      id: reqId,
      url,
      method: endpoint.method,
      headers: { accept: 'application/json', authorization: 'Bearer eyJhbGciOi…', 'x-app-version': '3.4.1' },
      body,
      startedAt: Date.now(),
      source: 'xhr'
    }
  })

  if (conditions.offline) {
    send({
      type: 'network.error',
      payload: {
        id: reqId,
        kind: 'offline',
        message: 'Network request failed (offline simulation)',
        endedAt: Date.now()
      }
    })
    console.warn('[demo] request failed: offline')
    send({
      type: 'console',
      payload: { level: 'warn', args: ['Request failed, device offline', { url }], timestamp: Date.now() }
    })
    return
  }
  const mock = mocks.find(
    (m) =>
      m.enabled &&
      (m.method === 'ANY' || m.method === endpoint.method) &&
      (m.matchType === 'exact'
        ? url === m.urlPattern
        : m.matchType === 'regex'
          ? new RegExp(m.urlPattern).test(url)
          : url.includes(m.urlPattern))
  )
  await sleep(conditions.latencyMs + (mock ? mock.delayMs : 80 + Math.random() * 600))
  if (mock) {
    send({
      type: 'network.response',
      payload: {
        id: reqId,
        status: mock.status,
        statusText: 'Mocked',
        headers: mock.headers,
        body: mock.body,
        bodySize: mock.body.length,
        endedAt: Date.now(),
        mockedBy: mock.name
      }
    })
    return
  }
  const responseBody = endpoint.image ? undefined : JSON.stringify(endpoint.body())
  send({
    type: 'network.response',
    payload: {
      id: reqId,
      status: endpoint.status,
      statusText: endpoint.status < 400 ? 'OK' : endpoint.status === 404 ? 'Not Found' : 'Internal Server Error',
      headers: {
        'content-type': endpoint.image ? 'image/png' : 'application/json; charset=utf-8',
        'cache-control': 'no-cache',
        'x-request-id': reqId
      },
      body: responseBody,
      bodySize: endpoint.image ? 48_213 : (responseBody?.length ?? 0),
      endedAt: Date.now()
    }
  })
  if (endpoint.status >= 500)
    send({
      type: 'console',
      payload: { level: 'error', args: [`Checkout failed: ${endpoint.status}`, endpoint.body()], timestamp: Date.now() }
    })
}

const LOGS: Array<() => ConsolePayload> = [
  () => ({
    level: 'log',
    args: ['Rendering ProductList', { count: 20, filters: { category: 'apparel', sort: 'popular' } }],
    timestamp: Date.now()
  }),
  () => ({ level: 'info', args: ['Navigation →', 'ProductDetail', { params: { id: 104 } }], timestamp: Date.now() }),
  () => ({ level: 'debug', args: ['Image cache hit ratio', 0.87], timestamp: Date.now() }),
  () => ({
    level: 'warn',
    args: ['VirtualizedList: You have a large list that is slow to update. Consider using getItemLayout.'],
    timestamp: Date.now()
  }),
  () => ({
    level: 'log',
    args: ['Analytics event', { name: 'add_to_cart', sku: 'SKU-104', value: 499 }],
    timestamp: Date.now()
  })
]

function tick(): void {
  void fakeRequest()
  if (Math.random() < 0.7) send({ type: 'console', payload: pick(LOGS)() })
  if (Math.random() < 0.35)
    dispatch(
      pick([
        { type: 'cart/add', payload: { sku: `SKU-${100 + Math.floor(Math.random() * 20)}`, qty: 1 } },
        { type: 'ui/toggleTheme' },
        { type: 'auth/login', payload: { id: 7, name: 'Asha' } }
      ])
    )
  if (Math.random() < 0.08) {
    const err = new TypeError("Cannot read property 'price' of undefined")
    err.stack = [
      "TypeError: Cannot read property 'price' of undefined",
      `    at ProductCard (http://localhost:8081/index.bundle?platform=ios&dev=true:48213:34)`,
      `    at renderWithHooks (http://localhost:8081/index.bundle?platform=ios&dev=true:10244:27)`,
      `    at map (native)`,
      `    at ProductList (http://localhost:8081/index.bundle?platform=ios&dev=true:48180:21)`
    ].join('\n')
    send({
      type: 'error',
      payload: {
        name: err.name,
        message: err.message,
        stack: err.stack,
        componentStack: '\n    in ProductCard\n    in ProductList\n    in HomeScreen',
        isFatal: false,
        timestamp: Date.now()
      }
    })
  }
}

let perfTimer: ReturnType<typeof setInterval> | undefined
let tickTimer: ReturnType<typeof setInterval> | undefined

const CHAT_SOCKET = 'demo-chat'
let chatTimer: ReturnType<typeof setInterval> | undefined

function chatFrame(direction: 'sent' | 'received', payload: unknown): void {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  send({
    type: 'ws.frame',
    payload: { id: CHAT_SOCKET, direction, data, binary: false, size: data.length, timestamp: Date.now() }
  })
}

/** A simulated realtime chat socket for the WebSockets view. */
function startChatSocket(): void {
  send({
    type: 'ws.open',
    payload: {
      id: CHAT_SOCKET,
      url: 'wss://realtime.shopfront.dev/v1/chat',
      protocols: ['chat.v1'],
      timestamp: Date.now()
    }
  })
  send({ type: 'ws.status', payload: { id: CHAT_SOCKET, status: 'open', timestamp: Date.now() } })
  chatFrame('sent', { type: 'subscribe', channel: 'order-updates', userId: 7 })
  chatFrame('received', { type: 'subscribed', channel: 'order-updates' })
  chatTimer = setInterval(() => {
    chatFrame('received', {
      type: 'order.status',
      orderId: 'o_1',
      status: pick(['packed', 'shipped', 'out_for_delivery']),
      at: new Date().toISOString()
    })
    if (Math.random() < 0.4) chatFrame('sent', { type: 'ping', t: Date.now() })
  }, 2500)
}

function startStreams(): void {
  startChatSocket()
  let heap = 38
  perfTimer = setInterval(() => {
    heap = Math.max(30, heap + (Math.random() - 0.45) * 2)
    const jank = Math.random() < 0.1
    send({
      type: 'perf.sample',
      payload: {
        timestamp: Date.now(),
        fps: jank ? 28 + Math.round(Math.random() * 15) : 57 + Math.round(Math.random() * 3),
        jsLagMs: jank ? 120 + Math.random() * 180 : Math.random() * 18,
        memoryMb: Math.round(heap * 10) / 10
      }
    })
  }, 1000)
  tickTimer = setInterval(tick, TICK_MS)
}

function handle(message: ServerMessage): void {
  switch (message.type) {
    case 'welcome':
      mocks = message.payload.mocks
      conditions = message.payload.conditions
      send({ type: 'state.snapshot', payload: { store: 'redux', state } })
      storageSnapshot()
      send({
        type: 'commands.register',
        payload: {
          commands: [
            { id: 'logout', title: 'Log out', description: 'Dispatches auth/logout and clears the token.' },
            {
              id: 'seedCart',
              title: 'Seed cart',
              description: 'Adds N random items to the cart.',
              args: [{ name: 'count', type: 'number' }]
            },
            { id: 'crash', title: 'Throw test error', description: 'Reports a non-fatal error.' }
          ]
        }
      })
      return
    case 'mocks.update':
      mocks = message.payload.mocks
      return
    case 'network.conditions':
      conditions = message.payload
      return
    case 'state.request':
      send({ type: 'state.snapshot', payload: { store: 'redux', state } })
      return
    case 'state.dispatch':
      dispatch(message.payload.action as { type: string })
      return
    case 'state.restore':
      state = message.payload.state as typeof state
      send({ type: 'state.snapshot', payload: { store: 'redux', state } })
      return
    case 'storage.request':
      storageSnapshot()
      return
    case 'storage.set':
      storage = new Map(storage).set(message.payload.key, message.payload.value)
      storageSnapshot()
      return
    case 'storage.remove': {
      const next = new Map(storage)
      next.delete(message.payload.key)
      storage = next
      storageSnapshot()
      return
    }
    case 'storage.clear':
      storage = new Map()
      storageSnapshot()
      return
    case 'command.run': {
      const { commandId, runId, args } = message.payload
      if (commandId === 'logout') {
        dispatch({ type: 'auth/logout' })
        send({ type: 'command.result', payload: { commandId, runId, ok: true, result: 'Logged out' } })
      } else if (commandId === 'seedCart') {
        const count = Math.min(50, Number(args.count) || 3)
        for (let i = 0; i < count; i++) dispatch({ type: 'cart/add', payload: { sku: `SKU-${200 + i}`, qty: 1 } })
        send({
          type: 'command.result',
          payload: { commandId, runId, ok: true, result: { added: count, total: state.cart.total } }
        })
      } else {
        send({
          type: 'error',
          payload: {
            name: 'Error',
            message: 'Test error from command',
            stack: 'Error: Test error from command\n    at crash (http://localhost:8081/index.bundle:1:1)',
            isFatal: false,
            timestamp: Date.now()
          }
        })
        send({ type: 'command.result', payload: { commandId, runId, ok: false, error: 'Threw test error' } })
      }
      return
    }
    case 'app.reload':
      console.log('[demo] reload requested, reconnecting…')
      socket.close()
      return
    case 'ws.send':
      if (message.payload.id === CHAT_SOCKET) {
        chatFrame('sent', message.payload.data)
        chatFrame('received', { type: 'echo', data: message.payload.data })
      }
      return
    case 'app.devMenu':
      send({
        type: 'console',
        payload: { level: 'info', args: ['Dev menu opened (simulated)'], timestamp: Date.now() }
      })
      return
  }
}

function connect(): void {
  socket = new WebSocket(`ws://localhost:${PORT}`)
  socket.onopen = () => {
    console.log(`[demo] connected to Loupe on port ${PORT}`)
    send({
      type: 'hello',
      payload: {
        appName: 'ShopFront',
        platform: 'ios',
        osVersion: '18.2',
        deviceName: 'iPhone 16 Pro',
        rnVersion: '0.79.2',
        sdkVersion: '0.1.0',
        isEmulator: true,
        hermes: true,
        bundleUrl: 'http://localhost:8081/index.bundle?platform=ios&dev=true',
        screen: { width: 402, height: 874, scale: 3 },
        protocolVersion: 1
      }
    })
    startStreams()
  }
  socket.onmessage = (ev) => {
    try {
      handle(JSON.parse(String(ev.data)) as ServerMessage)
    } catch (err) {
      console.error('[demo] bad message', err)
    }
  }
  socket.onclose = () => {
    clearInterval(perfTimer)
    clearInterval(tickTimer)
    clearInterval(chatTimer)
    console.log('[demo] disconnected, retrying in 2s')
    setTimeout(connect, 2000)
  }
  socket.onerror = () => undefined
}

connect()
