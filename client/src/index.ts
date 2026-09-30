import type {
  ClientMessage,
  CommandArg,
  CommandDescriptor,
  MockRule,
  NetworkConditions,
  ServerMessage
} from './protocol'
import { DEFAULT_PORT } from './protocol'
import { createTransport, type Transport, type WebSocketFactory } from './transport'
import { installNetwork } from './network'
import { installConsole } from './console'
import { installErrors, toErrorPayload } from './errors'
import { installPerformance } from './perf'
import { createReduxEnhancer, StateRegistry, trackZustand, type StoreAdapter } from './state'
import { installStorage, type AsyncStorageLike, type StorageBridge } from './storage'
import { collectDeviceInfo, detectHost, getBundleUrl, getReactNative } from './environment'
import { serialize } from './serialize'

export * from './protocol'
export type { StoreAdapter, AsyncStorageLike }

export interface PrismOptions {
  /**
   * Master switch. Defaults to `__DEV__`, so the SDK is inert in release builds
   * even if the call site is not guarded.
   */
  enabled?: boolean
  appName?: string
  /** Desktop host. Defaults to the Metro bundler host (works for simulators and LAN devices). */
  host?: string
  port?: number
  network?: boolean
  console?: boolean
  errors?: boolean
  performance?: boolean
  asyncStorage?: AsyncStorageLike
  /** Extra URL substrings that should never be captured by the network inspector. */
  ignoreUrls?: string[]
  /** Advanced: custom WebSocket factory (tests, non-RN runtimes). */
  createSocket?: WebSocketFactory
}

export interface CustomCommand extends CommandDescriptor {
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>
}

export interface PrismClient {
  connect(): PrismClient
  disconnect(): void
  isConnected(): boolean
  log(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
  reportError(error: unknown, componentStack?: string): void
  trackStore(name: string, adapter: StoreAdapter): () => void
  trackZustand(name: string, store: Parameters<typeof trackZustand>[2]): () => void
  reduxEnhancer(name?: string): ReturnType<typeof createReduxEnhancer>
  registerCommand(command: CustomCommand): () => void
}

const METRO_PATHS = ['/symbolicate', '/logs', '/message', '/inspector/', '/open-stack-frame', '/status']
const DEFAULT_IGNORED = ['clients3.google.com/generate_204']

/**
 * Hosts to try, in order: the Metro host (right for LAN devices), then
 * localhost (iOS simulator) and 10.0.2.2 (Android emulator). Prism listens on
 * localhost by default, so Expo's LAN-IP bundle URL alone would not connect.
 */
function candidateHosts(): string[] {
  const hosts = [detectHost(), 'localhost']
  if (getReactNative()?.Platform?.OS === 'android') hosts.push('10.0.2.2')
  return Array.from(new Set(hosts))
}

/** Only Metro's own endpoints on the bundle origin are ignored, never app APIs. */
function metroIgnores(): string[] {
  const bundle = getBundleUrl()
  const origin = bundle?.match(/^https?:\/\/[^/]+/)?.[0]
  return origin ? METRO_PATHS.map((path) => `${origin}${path}`) : []
}

declare const __DEV__: boolean | undefined

const isDevBuild = (): boolean => (typeof __DEV__ === 'undefined' ? true : Boolean(__DEV__))

const identityEnhancer = ((createStore: unknown) => createStore) as ReturnType<typeof createReduxEnhancer>
const noop = (): void => undefined

/** Inert client returned when the SDK is disabled: no patching, no sockets. */
function createNoopClient(): PrismClient {
  const client: PrismClient = {
    connect: () => client,
    disconnect: noop,
    isConnected: () => false,
    log: noop,
    warn: noop,
    error: noop,
    reportError: noop,
    trackStore: () => noop,
    trackZustand: () => noop,
    reduxEnhancer: () => identityEnhancer,
    registerCommand: () => noop
  }
  return client
}

export function createPrism(options: PrismOptions = {}): PrismClient {
  if (!(options.enabled ?? isDevBuild())) return createNoopClient()
  const appName = options.appName ?? 'React Native App'
  const hosts = options.host ? [options.host] : candidateHosts()
  const port = options.port ?? DEFAULT_PORT
  let mocks: readonly MockRule[] = []
  let conditions: NetworkConditions = { offline: false, latencyMs: 0 }
  let idCounter = 0
  let uninstallers: Array<() => void> = []
  let storage: StorageBridge | null = null
  const commands = new Map<string, CustomCommand>()

  // `transport` is assigned below; closures only call it after connect().
  const send = (message: ClientMessage): void => transport.send(message)
  const registry = new StateRegistry(send)

  const describeCommands = (): CommandDescriptor[] =>
    Array.from(commands.values()).map(({ id, title, description, args }) => ({ id, title, description, args }))

  const coerceArgs = (defs: CommandArg[] | undefined, raw: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
      (defs ?? []).map((def) => {
        const value = raw[def.name]
        if (def.type === 'number') return [def.name, Number(value)]
        if (def.type === 'boolean') return [def.name, value === true || value === 'true']
        return [def.name, value === undefined ? '' : String(value)]
      })
    )

  const runCommand = async (commandId: string, runId: string, args: Record<string, unknown>): Promise<void> => {
    const command = commands.get(commandId)
    if (!command) {
      send({ type: 'command.result', payload: { commandId, runId, ok: false, error: 'Unknown command' } })
      return
    }
    try {
      const result = await command.handler(coerceArgs(command.args, args))
      send({ type: 'command.result', payload: { commandId, runId, ok: true, result: serialize(result) } })
    } catch (err) {
      send({
        type: 'command.result',
        payload: { commandId, runId, ok: false, error: String((err as Error)?.message ?? err) }
      })
    }
  }

  const handleServerMessage = (message: ServerMessage): void => {
    switch (message.type) {
      case 'welcome':
        mocks = message.payload.mocks
        conditions = message.payload.conditions
        registry.snapshot()
        void storage?.snapshot()
        if (commands.size) send({ type: 'commands.register', payload: { commands: describeCommands() } })
        return
      case 'mocks.update':
        mocks = message.payload.mocks
        return
      case 'network.conditions':
        conditions = message.payload
        return
      case 'state.request':
        registry.snapshot(message.payload.store)
        return
      case 'state.dispatch':
        registry.dispatch(message.payload.store, message.payload.action)
        return
      case 'state.restore':
        registry.restore(message.payload.store, message.payload.state)
        return
      case 'storage.request':
        void storage?.snapshot()
        return
      case 'storage.set':
        void storage?.set(message.payload.key, message.payload.value)
        return
      case 'storage.remove':
        void storage?.remove(message.payload.key)
        return
      case 'storage.clear':
        void storage?.clear()
        return
      case 'command.run':
        void runCommand(message.payload.commandId, message.payload.runId, message.payload.args)
        return
      case 'app.reload':
        getReactNative()?.DevSettings?.reload('Prism DevTools')
        return
      case 'app.devMenu':
        getReactNative()?.DevSettings?.openDevMenu?.()
        return
    }
  }

  const transport: Transport = createTransport({
    urls: hosts.map((h) => `ws://${h}:${port}`),
    getDeviceInfo: () => collectDeviceInfo(appName),
    onMessage: handleServerMessage,
    // Never leave offline simulation or mocks active once the desktop is gone.
    onStatusChange: (connected) => {
      if (connected) return
      mocks = []
      conditions = { offline: false, latencyMs: 0 }
    },
    createSocket: options.createSocket
  })

  const tagged = (level: 'log' | 'warn' | 'error', args: unknown[]): void =>
    send({
      type: 'console',
      payload: { level, tag: 'prism', args: args.map((a) => serialize(a)), timestamp: Date.now() }
    })

  const client: PrismClient = {
    connect() {
      if (uninstallers.length) return client
      if (options.network !== false) {
        uninstallers.push(
          installNetwork({
            send,
            getMocks: () => mocks,
            getConditions: () => conditions,
            nextId: () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`,
            ignoreUrls: [...DEFAULT_IGNORED, ...metroIgnores(), ...(options.ignoreUrls ?? [])]
          })
        )
      }
      if (options.console !== false) uninstallers.push(installConsole(send))
      if (options.errors !== false) uninstallers.push(installErrors(send))
      if (options.performance !== false) uninstallers.push(installPerformance(send))
      if (options.asyncStorage) {
        storage = installStorage(options.asyncStorage, send)
        const bridge = storage
        uninstallers.push(() => bridge.uninstall())
      }
      transport.connect()
      return client
    },
    disconnect() {
      uninstallers.forEach((fn) => fn())
      uninstallers = []
      storage = null
      transport.close()
    },
    isConnected: () => transport.isConnected(),
    log: (...args) => tagged('log', args),
    warn: (...args) => tagged('warn', args),
    error: (...args) => tagged('error', args),
    reportError: (error, componentStack) =>
      send({ type: 'error', payload: toErrorPayload(error, false, componentStack) }),
    trackStore: (name, adapter) => {
      const unregister = registry.register(name, adapter)
      const unsubscribe = adapter.subscribe?.(() => registry.reportAction(name, { type: 'update' }, adapter.getState()))
      return () => {
        unsubscribe?.()
        unregister()
      }
    },
    trackZustand: (name, store) => trackZustand(registry, name, store),
    reduxEnhancer: (name = 'redux') => createReduxEnhancer(registry, name),
    registerCommand: (command) => {
      commands.set(command.id, command)
      send({ type: 'commands.register', payload: { commands: describeCommands() } })
      return () => {
        commands.delete(command.id)
        send({ type: 'commands.register', payload: { commands: describeCommands() } })
      }
    }
  }
  return client
}

export default createPrism
