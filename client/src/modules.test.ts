import { afterEach, describe, expect, it, vi } from 'vitest'
import { installConsole } from './console'
import { installErrors, toErrorPayload } from './errors'
import { installPerformance } from './perf'
import { collectDeviceInfo, detectHost } from './environment'
import type { ClientMessage } from './protocol'

type Msg = ClientMessage

describe('installConsole', () => {
  it('forwards serialized console calls and restores originals', () => {
    const sent: Msg[] = []
    const original = console.warn
    const spy = vi.fn()
    console.warn = spy
    const uninstall = installConsole((m) => sent.push(m))
    console.warn('careful', { n: 1 })
    uninstall()
    console.warn('after')
    console.warn = original
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'console', payload: { level: 'warn', args: ['careful', { n: 1 }] } })
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('does not recurse when sending logs', () => {
    const originalLog = console.log
    console.log = () => undefined
    const sent: Msg[] = []
    const uninstall = installConsole((m) => {
      sent.push(m)
      console.log('from transport')
    })
    console.log('app')
    uninstall()
    console.log = originalLog
    expect(sent).toHaveLength(1)
  })
})

describe('installErrors', () => {
  const g = globalThis as { ErrorUtils?: unknown }
  afterEach(() => {
    delete g.ErrorUtils
  })

  it('reports errors through ErrorUtils and chains to the previous handler', () => {
    const previous = vi.fn()
    let handler: (e: unknown, fatal?: boolean) => void = previous
    g.ErrorUtils = { getGlobalHandler: () => handler, setGlobalHandler: (h: typeof handler) => (handler = h) }
    const sent: Msg[] = []
    const uninstall = installErrors((m) => sent.push(m))
    handler(new RangeError('bad'), true)
    expect(sent[0]).toMatchObject({ type: 'error', payload: { name: 'RangeError', message: 'bad', isFatal: true } })
    expect(previous).toHaveBeenCalled()
    uninstall()
    expect(handler).toBe(previous)
  })

  it('is a no-op without ErrorUtils and normalizes non-Error values', () => {
    expect(() => installErrors(() => undefined)()).not.toThrow()
    expect(toErrorPayload('oops', false).message).toBe('oops')
    expect(toErrorPayload({ code: 1 }, false).message).toBe('{"code":1}')
  })
})

describe('installPerformance', () => {
  it('emits samples with fps, lag and hermes memory', () => {
    vi.useFakeTimers()
    const g = globalThis as Record<string, unknown>
    g.requestAnimationFrame = (cb: () => void) => setTimeout(cb, 16) as unknown as number
    g.cancelAnimationFrame = (id: number) => clearTimeout(id)
    g.HermesInternal = { getInstrumentedStats: () => ({ js_allocatedBytes: 50 * 1024 * 1024 }) }
    const sent: Msg[] = []
    const stop = installPerformance((m) => sent.push(m))
    vi.advanceTimersByTime(1000)
    stop()
    delete g.requestAnimationFrame
    delete g.cancelAnimationFrame
    delete g.HermesInternal
    vi.useRealTimers()
    expect(sent).toHaveLength(1)
    const sample = sent[0] as Extract<Msg, { type: 'perf.sample' }>
    expect(sample.payload.fps).toBeGreaterThan(50)
    expect(sample.payload.memoryMb).toBe(50)
    expect(sample.payload.jsLagMs).toBeGreaterThanOrEqual(0)
  })
})

describe('environment', () => {
  const rn = {
    Platform: {
      OS: 'android',
      Version: 34,
      constants: { Model: 'sdk_gphone64', Brand: 'google', reactNativeVersion: { major: 0, minor: 79, patch: 2 } }
    },
    Dimensions: { get: () => ({ width: 411, height: 914, scale: 2.6 }) },
    NativeModules: { SourceCode: { scriptURL: 'http://10.0.2.2:8081/index.bundle?platform=android' } }
  }

  it('detects the Metro host', () => {
    expect(detectHost(rn)).toBe('10.0.2.2')
    expect(detectHost(null)).toBe('localhost')
  })

  it('collects device info', () => {
    expect(collectDeviceInfo('App', rn)).toMatchObject({
      appName: 'App',
      platform: 'android',
      osVersion: '34',
      deviceName: 'google sdk_gphone64',
      rnVersion: '0.79.2',
      isEmulator: true,
      screen: { width: 411, height: 914, scale: 2.6 }
    })
    expect(collectDeviceInfo('X', null).platform).toBe('unknown')
  })
})

describe('packaging', () => {
  it('keeps SDK_VERSION in sync with package.json', async () => {
    const { SDK_VERSION } = await import('./version')
    const pkg = await import('../package.json')
    expect(SDK_VERSION).toBe(pkg.version)
  })

  it('returns an inert client when disabled', async () => {
    const { createLoupe } = await import('./index')
    const createSocket = vi.fn()
    const originalFetch = globalThis.fetch
    const loupe = createLoupe({ enabled: false, createSocket }).connect()
    expect(createSocket).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(originalFetch)
    const createStore = (): { ok: boolean } => ({ ok: true })
    expect(loupe.reduxEnhancer()(createStore as never)).toBe(createStore)
    expect(loupe.isConnected()).toBe(false)
  })
})

describe('trackNavigation', () => {
  it('logs screen changes, dispatches actions and resets state', async () => {
    const { StateRegistry, trackNavigation } = await import('./state')
    const sent: Msg[] = []
    const registry = new StateRegistry((m) => sent.push(m))
    let listener: () => void = () => undefined
    let root: unknown = { index: 0, routes: [{ name: 'Home' }] }
    const ref = {
      isReady: () => true,
      getRootState: () => root,
      getCurrentRoute: () => ({ name: 'Profile', params: { id: 7 } }),
      addListener: (_e: 'state', cb: () => void) => {
        listener = cb
        return () => undefined
      },
      dispatch: vi.fn(),
      resetRoot: vi.fn((state: unknown) => {
        root = state
      })
    }
    trackNavigation(registry, 'navigation', ref)
    root = { index: 1, routes: [{ name: 'Home' }, { name: 'Profile' }] }
    listener()
    const action = sent.find((m) => m.type === 'state.action') as Extract<Msg, { type: 'state.action' }>
    expect(action.payload.action).toEqual({ type: 'navigate/Profile', params: { id: 7 } })
    registry.dispatch('navigation', { type: 'NAVIGATE', payload: { name: 'Settings' } })
    expect(ref.dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE', payload: { name: 'Settings' } })
    registry.restore('navigation', { index: 0, routes: [{ name: 'Home' }] })
    expect(ref.resetRoot).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] })
  })
})

describe('AsyncStorage compatibility', () => {
  const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms))

  function v3Storage(initial: Record<string, string>) {
    const data = new Map(Object.entries(initial))
    return {
      data,
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
      getMany: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, data.get(k) ?? null]))),
      setMany: async (entries: Record<string, string>) => Object.entries(entries).forEach(([k, v]) => data.set(k, v)),
      removeMany: async (keys: string[]) => keys.forEach((k) => data.delete(k)),
      getAllKeys: async () => Array.from(data.keys()),
      clear: async () => data.clear()
    }
  }

  it('snapshots AsyncStorage v3 through getMany', async () => {
    const { installStorage } = await import('./storage')
    const sent: Msg[] = []
    const storage = v3Storage({ token: 'abc', theme: 'dark' })
    await installStorage(storage, (m) => sent.push(m)).snapshot()
    expect(storage.getMany).toHaveBeenCalledWith(['token', 'theme'])
    expect(sent[0]).toMatchObject({
      type: 'storage.snapshot',
      payload: {
        entries: [
          ['token', 'abc'],
          ['theme', 'dark']
        ]
      }
    })
  })

  it('refreshes after the app writes with v3 setMany/removeMany', async () => {
    const { installStorage } = await import('./storage')
    const sent: Msg[] = []
    const storage = v3Storage({ a: '1' })
    const bridge = installStorage(storage, (m) => sent.push(m))
    await storage.setMany({ b: '2' })
    await storage.removeMany(['a'])
    await settle()
    const last = sent.filter((m) => m.type === 'storage.snapshot').at(-1)
    expect(last?.payload).toEqual({ entries: [['b', '2']] })
    bridge.uninstall()
  })

  it('falls back to getItem when no batch API exists', async () => {
    const { installStorage } = await import('./storage')
    const sent: Msg[] = []
    const data = new Map([['k', 'v']])
    const storage = {
      getItem: async (k: string) => data.get(k) ?? null,
      setItem: async (k: string, v: string) => void data.set(k, v),
      removeItem: async (k: string) => void data.delete(k),
      getAllKeys: async () => Array.from(data.keys()),
      clear: async () => data.clear()
    }
    await installStorage(storage, (m) => sent.push(m)).snapshot()
    expect(sent[0].payload).toEqual({ entries: [['k', 'v']] })
  })
})
