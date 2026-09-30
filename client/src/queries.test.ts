import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryObserver } from '@tanstack/query-core'
import { trackQueryClient, QUERY_SNAPSHOT_DEBOUNCE_MS, type QueryBridge } from './queries'
import type { ClientMessage, QuerySnapshotPayload } from './protocol'

// Tested against the real TanStack Query core to guarantee structural compatibility.
describe('trackQueryClient', () => {
  let client: QueryClient
  let sent: ClientMessage[]
  let bridge: QueryBridge

  const lastSnapshot = (): QuerySnapshotPayload => {
    const snaps = sent.filter((m) => m.type === 'query.snapshot')
    return snaps[snaps.length - 1].payload as QuerySnapshotPayload
  }

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } })
    sent = []
  })

  afterEach(() => {
    bridge?.dispose()
    client.clear()
  })

  it('snapshots query state, errors and observers', async () => {
    await client.prefetchQuery({ queryKey: ['user', 7], queryFn: async () => ({ id: 7, name: 'Asha' }) })
    await client.prefetchQuery({
      queryKey: ['broken'],
      queryFn: async () => {
        throw new Error('500 from API')
      }
    })
    const observer = new QueryObserver(client, { queryKey: ['user', 7], queryFn: async () => ({ id: 7 }) })
    const unsubscribe = observer.subscribe(() => undefined)
    bridge = trackQueryClient('default', client, (m) => sent.push(m))

    const { queries, client: name } = lastSnapshot()
    expect(name).toBe('default')
    const user = queries.find((q) => q.hash === '["user",7]')
    expect(user).toMatchObject({
      key: ['user', 7],
      status: 'success',
      observers: 1,
      isStale: false,
      data: { id: 7, name: 'Asha' }
    })
    expect(queries.find((q) => q.hash === '["broken"]')).toMatchObject({ status: 'error', error: '500 from API' })
    unsubscribe()
  })

  it('debounces cache events into snapshots', async () => {
    vi.useFakeTimers()
    bridge = trackQueryClient('default', client, (m) => sent.push(m))
    const before = sent.length
    client.setQueryData(['a'], 1)
    client.setQueryData(['b'], 2)
    client.setQueryData(['c'], 3)
    expect(sent.length).toBe(before)
    vi.advanceTimersByTime(QUERY_SNAPSHOT_DEBOUNCE_MS + 1)
    expect(sent.length).toBe(before + 1)
    expect(
      lastSnapshot()
        .queries.map((q) => q.hash)
        .sort()
    ).toEqual(['["a"]', '["b"]', '["c"]'])
    vi.useRealTimers()
  })

  it('runs invalidate, refetch, reset and remove for one query or all', async () => {
    const fn = vi.fn(async () => 'value')
    await client.prefetchQuery({ queryKey: ['todos'], queryFn: fn })
    client.setQueryData(['other'], 'x')
    bridge = trackQueryClient('default', client, (m) => sent.push(m))

    await bridge.run('invalidate', '["todos"]')
    expect(lastSnapshot().queries.find((q) => q.hash === '["todos"]')?.isInvalidated).toBe(true)

    await bridge.run('remove', '["other"]')
    expect(lastSnapshot().queries.map((q) => q.hash)).toEqual(['["todos"]'])

    await bridge.run('remove', '["does-not-exist"]')
    expect(lastSnapshot().queries).toHaveLength(1)

    await bridge.run('remove')
    expect(lastSnapshot().queries).toHaveLength(0)
  })
})
