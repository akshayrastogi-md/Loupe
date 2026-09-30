import type { ClientMessage } from './protocol'
import { serialize } from './serialize'

export interface StoreAdapter {
  getState(): unknown
  subscribe?(listener: () => void): () => void
  dispatch?(action: unknown): unknown
  /** Replace the whole state; enables time travel from the desktop. */
  restore?(state: unknown): void
}

export const RESTORE_ACTION = '@@loupe/RESTORE'

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()

export class StateRegistry {
  private stores = new Map<string, StoreAdapter>()

  constructor(private readonly send: (message: ClientMessage) => void) {}

  register(name: string, adapter: StoreAdapter): () => void {
    this.stores.set(name, adapter)
    this.snapshot(name)
    return () => {
      this.stores.delete(name)
    }
  }

  reportAction(store: string, action: unknown, nextState: unknown, durationMs?: number): void {
    this.send({
      type: 'state.action',
      payload: { store, action: serialize(action), nextState: serialize(nextState), durationMs, timestamp: Date.now() }
    })
  }

  snapshot(name?: string): void {
    const names = name ? [name] : Array.from(this.stores.keys())
    names.forEach((storeName) => {
      const adapter = this.stores.get(storeName)
      if (!adapter) return
      this.send({ type: 'state.snapshot', payload: { store: storeName, state: serialize(adapter.getState()) } })
    })
  }

  dispatch(name: string, action: unknown): void {
    this.stores.get(name)?.dispatch?.(action)
  }

  restore(name: string, state: unknown): void {
    const adapter = this.stores.get(name)
    if (!adapter?.restore) return
    adapter.restore(state)
    this.snapshot(name)
  }
}

type Reducer = (state: unknown, action: { type?: unknown; payload?: unknown }) => unknown
type StoreCreator = (reducer: Reducer, preloadedState?: unknown, ...rest: unknown[]) => ReduxStoreLike

interface ReduxStoreLike {
  getState(): unknown
  dispatch(action: unknown): unknown
  subscribe(listener: () => void): () => void
  replaceReducer(next: Reducer): void
}

const withRestore =
  (reducer: Reducer): Reducer =>
  (state, action) =>
    action?.type === RESTORE_ACTION ? action.payload : reducer(state, action)

/**
 * Redux store enhancer. Works with `createStore` and RTK's `configureStore`:
 *   enhancers: (getDefault) => getDefault().concat(loupe.reduxEnhancer())
 */
export function createReduxEnhancer(registry: StateRegistry, name: string) {
  return (createStore: StoreCreator): StoreCreator =>
    (reducer, preloadedState, ...rest) => {
      const store = createStore(withRestore(reducer), preloadedState, ...rest)
      const dispatch = (action: unknown): unknown => {
        const start = now()
        const result = store.dispatch(action)
        const isPlainAction = typeof action === 'object' && action !== null
        if (isPlainAction && (action as { type?: unknown }).type !== RESTORE_ACTION) {
          registry.reportAction(name, action, store.getState(), Math.round((now() - start) * 100) / 100)
        }
        return result
      }
      registry.register(name, {
        getState: store.getState,
        dispatch,
        restore: (state) => store.dispatch({ type: RESTORE_ACTION, payload: state })
      })
      return {
        ...store,
        dispatch,
        replaceReducer: (next: Reducer) => store.replaceReducer(withRestore(next))
      }
    }
}

interface ZustandLike {
  getState(): unknown
  setState(partial: unknown, replace?: boolean): void
  subscribe(listener: (state: unknown, prev: unknown) => void): () => void
}

/** Track a Zustand (or any setState/subscribe style) store. */
export function trackZustand(registry: StateRegistry, name: string, store: ZustandLike): () => void {
  const unregister = registry.register(name, {
    getState: store.getState,
    dispatch: (action) => store.setState(action),
    restore: (state) => store.setState(state, true)
  })
  const unsubscribe = store.subscribe((next) => registry.reportAction(name, { type: 'setState' }, next))
  return () => {
    unsubscribe()
    unregister()
  }
}
