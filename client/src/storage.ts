import type { ClientMessage } from './protocol'

/** The subset of @react-native-async-storage/async-storage that Loupe needs. */
export interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>
  multiGet(keys: readonly string[]): Promise<ReadonlyArray<readonly [string, string | null]>>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  clear(): Promise<void>
}

const REFRESH_DEBOUNCE_MS = 300
const MUTATORS = ['setItem', 'removeItem', 'mergeItem', 'clear', 'multiSet', 'multiRemove', 'multiMerge'] as const

export interface StorageBridge {
  snapshot(): Promise<void>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
  uninstall(): void
}

export function installStorage(storage: AsyncStorageLike, send: (message: ClientMessage) => void): StorageBridge {
  let timer: ReturnType<typeof setTimeout> | null = null

  const snapshot = async (): Promise<void> => {
    try {
      const keys = await storage.getAllKeys()
      const pairs = await storage.multiGet(keys)
      send({ type: 'storage.snapshot', payload: { entries: pairs.map(([k, v]) => [k, v] as [string, string | null]) } })
    } catch (err) {
      send({
        type: 'console',
        payload: {
          level: 'warn',
          tag: 'loupe',
          args: [`AsyncStorage snapshot failed: ${String(err)}`],
          timestamp: Date.now()
        }
      })
    }
  }

  const scheduleSnapshot = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void snapshot()
    }, REFRESH_DEBOUNCE_MS)
  }

  // Refresh the desktop view whenever the app itself mutates storage.
  const target = storage as unknown as Record<string, unknown>
  const originals = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  MUTATORS.forEach((method) => {
    const original = target[method]
    if (typeof original !== 'function') return
    const bound = (original as (...args: unknown[]) => Promise<unknown>).bind(storage)
    originals.set(method, original as (...args: unknown[]) => Promise<unknown>)
    target[method] = (...args: unknown[]) => bound(...args).finally(scheduleSnapshot)
  })

  const call = (method: string, ...args: unknown[]): Promise<unknown> => {
    const original = originals.get(method)
    return original ? original.apply(storage, args) : Promise.resolve()
  }

  return {
    snapshot,
    set: async (key, value) => {
      await call('setItem', key, value)
      await snapshot()
    },
    remove: async (key) => {
      await call('removeItem', key)
      await snapshot()
    },
    clear: async () => {
      await call('clear')
      await snapshot()
    },
    uninstall: () => {
      if (timer) clearTimeout(timer)
      originals.forEach((fn, method) => {
        target[method] = fn
      })
    }
  }
}
