import type { ClientMessage, QueryAction, QuerySummary } from './protocol'
import { serialize } from './serialize'

export const QUERY_SNAPSHOT_DEBOUNCE_MS = 300
export const MAX_QUERIES = 300

/** The parts of a TanStack Query (v4/v5) Query the SDK reads. */
interface QueryLike {
  queryHash: string
  queryKey: unknown
  state: {
    status: string
    fetchStatus?: string
    data?: unknown
    error?: unknown
    dataUpdatedAt: number
    errorUpdatedAt: number
    isInvalidated?: boolean
    fetchFailureCount?: number
  }
  isStale(): boolean
  getObserversCount(): number
}

interface QueryFilters {
  queryKey?: unknown
  exact?: boolean
}

/** Structural subset of TanStack Query's QueryClient, so the SDK has no dependency on it. */
export interface QueryClientLike {
  getQueryCache(): { getAll(): QueryLike[]; subscribe(listener: () => void): () => void }
  refetchQueries(filters?: QueryFilters): Promise<unknown>
  invalidateQueries(filters?: QueryFilters): Promise<unknown>
  resetQueries(filters?: QueryFilters): Promise<unknown>
  removeQueries(filters?: QueryFilters): void
}

const errorMessage = (error: unknown): string | undefined => {
  if (error === null || error === undefined) return undefined
  return error instanceof Error ? error.message : String(error)
}

function summarize(query: QueryLike): QuerySummary {
  const { state } = query
  return {
    hash: query.queryHash,
    key: serialize(query.queryKey, { maxDepth: 4 }),
    status: (state.status as QuerySummary['status']) ?? 'pending',
    fetchStatus: (state.fetchStatus as QuerySummary['fetchStatus']) ?? 'idle',
    isStale: query.isStale(),
    isInvalidated: Boolean(state.isInvalidated),
    observers: query.getObserversCount(),
    dataUpdatedAt: state.dataUpdatedAt,
    errorUpdatedAt: state.errorUpdatedAt,
    failureCount: state.fetchFailureCount ?? 0,
    error: errorMessage(state.error),
    data: serialize(state.data, { maxDepth: 6, maxKeys: 100 })
  }
}

export interface QueryBridge {
  snapshot(): void
  run(action: QueryAction, hash?: string): Promise<void>
  dispose(): void
}

/** Report a QueryClient's cache (debounced) and run cache actions requested by Loupe. */
export function trackQueryClient(
  name: string,
  client: QueryClientLike,
  send: (message: ClientMessage) => void
): QueryBridge {
  const cache = client.getQueryCache()
  let timer: ReturnType<typeof setTimeout> | null = null

  const snapshot = (): void => {
    try {
      const queries = cache.getAll().slice(0, MAX_QUERIES).map(summarize)
      send({ type: 'query.snapshot', payload: { client: name, queries, timestamp: Date.now() } })
    } catch {
      // Never let reporting break the app's cache.
    }
  }

  const schedule = (): void => {
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      snapshot()
    }, QUERY_SNAPSHOT_DEBOUNCE_MS)
  }

  const unsubscribe = cache.subscribe(schedule)
  snapshot()

  const filtersFor = (hash?: string): QueryFilters | undefined => {
    if (!hash) return undefined
    const query = cache.getAll().find((q) => q.queryHash === hash)
    return query ? { queryKey: query.queryKey, exact: true } : { queryKey: ['__loupe_missing_query__'], exact: true }
  }

  return {
    snapshot,
    run: async (action, hash) => {
      const filters = filtersFor(hash)
      try {
        if (action === 'refetch') await client.refetchQueries(filters)
        else if (action === 'invalidate') await client.invalidateQueries(filters)
        else if (action === 'reset') await client.resetQueries(filters)
        else client.removeQueries(filters)
      } catch {
        // Failed fetches surface in the query's own error state.
      }
      snapshot()
    },
    dispose: () => {
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }
}
