import type { ClientMessage } from './protocol'

type Entry = [string, string | null]

/**
 * The subset of @react-native-async-storage/async-storage that Loupe needs.
 * Works with v2 (multiGet), v3 (getMany) and any storage exposing getItem.
 */
export interface AsyncStorageLike {
  getAllKeys(): Promise<readonly string[]>
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
  clear(): Promise<void>
  /** AsyncStorage v2 batch read. */
  multiGet?(keys: readonly string[]): Promise<ReadonlyArray<readonly [string, string | null]>>
  /** AsyncStorage v3 batch read. */
  getMany?(keys: string[]): Promise<Record<string, string | null>>
}

const REFRESH_DEBOUNCE_MS = 300
// v2 and v3 write APIs; whichever exist are wrapped to refresh the desktop view.
const MUTATORS = [
  'setItem',
  'removeItem',
  'mergeItem',
  'clear',
  'multiSet',
  'multiRemove',
  'multiMerge',
  'setMany',
  'removeMany'
] as const

/** Read every entry using the best batch API the storage offers. */
async function readAll(storage: AsyncStorageLike): Promise<Entry[]> {
  const keys = [...(await storage.getAllKeys())]
  if (typeof storage.multiGet === 'function') {
    const pairs = await storage.multiGet(keys)
    return pairs.map(([k, v]) => [k, v] as Entry)
  }
  if (typeof storage.getMany === 'function') {
    const values = await storage.getMany(keys)
    return keys.map((k) => [k, values[k] ?? null] as Entry)
  }
  return Promise.all(keys.map(async (k) => [k, await storage.getItem(k)] as Entry))
}

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
      send({ type: 'storage.snapshot', payload: { entries: await readAll(storage) } })
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
