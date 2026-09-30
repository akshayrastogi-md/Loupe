import type { QuerySummary } from './protocol'

export type QueryState = 'fetching' | 'paused' | 'error' | 'inactive' | 'stale' | 'fresh'

/** Mirrors TanStack Query Devtools' labels, with errors surfaced explicitly. */
export function queryState(q: Pick<QuerySummary, 'fetchStatus' | 'status' | 'observers' | 'isStale'>): QueryState {
  if (q.fetchStatus === 'fetching') return 'fetching'
  if (q.fetchStatus === 'paused') return 'paused'
  if (q.status === 'error') return 'error'
  if (q.observers === 0) return 'inactive'
  if (q.isStale) return 'stale'
  return 'fresh'
}

/** Human label for a query key, e.g. ["user", 7] -> user › 7 */
export function queryKeyLabel(key: unknown): string {
  if (!Array.isArray(key)) return JSON.stringify(key)
  return key
    .map((part) => (typeof part === 'string' || typeof part === 'number' ? String(part) : JSON.stringify(part)))
    .join(' › ')
}
