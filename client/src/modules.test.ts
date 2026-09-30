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
    const { createPrism } = await import('./index')
    const createSocket = vi.fn()
    const originalFetch = globalThis.fetch
    const prism = createPrism({ enabled: false, createSocket }).connect()
    expect(createSocket).not.toHaveBeenCalled()
    expect(globalThis.fetch).toBe(originalFetch)
    const createStore = (): { ok: boolean } => ({ ok: true })
    expect(prism.reduxEnhancer()(createStore as never)).toBe(createStore)
    expect(prism.isConnected()).toBe(false)
  })
})
