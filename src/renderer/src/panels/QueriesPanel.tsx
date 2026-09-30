import { useMemo, useState } from 'react'
import { DatabaseZap, RefreshCw, RotateCcw, Sparkles, Trash2, Zap } from 'lucide-react'
import type { QueryAction, QuerySummary } from '@shared/protocol'
import { queryKeyLabel, queryState, type QueryState } from '@shared/queryStatus'
import { formatTime } from '@shared/format'
import { useSelectedDevice } from '../store/appStore'
import { Chips, EmptyState, KeyValue, SearchInput, Tabs } from '../components/ui'
import { JsonTree } from '../components/JsonTree'
import { sendToSelected, toast } from '../lib/actions'

const STATE_OPTIONS: ReadonlyArray<{ id: QueryState; label: string }> = [
  { id: 'fresh', label: 'Fresh' },
  { id: 'fetching', label: 'Fetching' },
  { id: 'stale', label: 'Stale' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'error', label: 'Error' },
  { id: 'paused', label: 'Paused' }
]

const STATE_BADGE: Record<QueryState, string> = {
  fresh: 'green',
  fetching: 'blue',
  stale: 'yellow',
  inactive: '',
  error: 'red',
  paused: 'accent'
}

const ACTIONS: ReadonlyArray<{ id: QueryAction; label: string; icon: typeof RefreshCw; hint: string }> = [
  { id: 'refetch', label: 'Refetch', icon: RefreshCw, hint: 'Fetch again now' },
  { id: 'invalidate', label: 'Invalidate', icon: Zap, hint: 'Mark stale; active observers refetch' },
  { id: 'reset', label: 'Reset', icon: RotateCcw, hint: 'Back to initial state' },
  { id: 'remove', label: 'Remove', icon: Trash2, hint: 'Drop from the cache' }
]

type TabId = 'data' | 'details'

const ago = (timestamp: number): string => {
  if (!timestamp) return 'never'
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return formatTime(timestamp).slice(0, 8)
}

export function QueriesPanel() {
  const device = useSelectedDevice()
  const clients = useMemo(() => Object.keys(device?.queries ?? {}), [device?.queries])
  const [clientName, setClientName] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [states, setStates] = useState<QueryState[]>([])
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('data')

  const activeClient = clientName && clients.includes(clientName) ? clientName : (clients[0] ?? null)
  const snapshot = activeClient ? device?.queries[activeClient] : undefined

  const withState = useMemo(
    () => (snapshot?.queries ?? []).map((q) => ({ query: q, state: queryState(q) })),
    [snapshot?.queries]
  )
  const counts = useMemo(() => {
    const c: Partial<Record<QueryState, number>> = {}
    withState.forEach(({ state }) => (c[state] = (c[state] ?? 0) + 1))
    return c
  }, [withState])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withState.filter(
      ({ query, state }) => (!states.length || states.includes(state)) && (!q || query.hash.toLowerCase().includes(q))
    )
  }, [withState, states, search])
  const selected: QuerySummary | undefined = snapshot?.queries.find((q) => q.hash === selectedHash)

  if (!device || clients.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={<DatabaseZap size={22} />} title="No TanStack Query client connected">
          Call <code>loupe.trackQueryClient(queryClient)</code> to inspect cached queries: their status, data, errors
          and observers. You can refetch, invalidate, reset or remove any query from here.
        </EmptyState>
      </div>
    )
  }

  const run = async (action: QueryAction, hash?: string): Promise<void> => {
    if (!activeClient) return
    if (await sendToSelected({ type: 'query.action', payload: { client: activeClient, action, hash } })) {
      toast('success', `${action[0].toUpperCase()}${action.slice(1)} ${hash ? 'query' : 'all queries'}`)
      if (action === 'remove' && hash === selectedHash) setSelectedHash(null)
    }
  }

  const toggleState = (id: QueryState | null): void =>
    setStates((prev) => (id === null ? [] : prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]))

  return (
    <div className="panel">
      <div className="toolbar">
        {clients.length > 1 && (
          <select
            className="select"
            value={activeClient ?? ''}
            onChange={(e) => setClientName(e.target.value)}
            aria-label="Query client"
          >
            {clients.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
        <SearchInput value={search} onChange={setSearch} placeholder="Filter query keys" width={220} />
        <Chips
          options={STATE_OPTIONS.map((o) => ({ ...o, count: counts[o.id] }))}
          value={states}
          onToggle={toggleState}
        />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {withState.length} queries
        </span>
        <div className="divider" />
        <button className="btn sm" onClick={() => run('refetch')} title="Refetch every query">
          <RefreshCw size={12} /> Refetch all
        </button>
        <button className="btn sm" onClick={() => run('invalidate')} title="Invalidate every query">
          <Zap size={12} /> Invalidate all
        </button>
      </div>
      <div className="split">
        <div className="pane fill" style={{ borderRight: selected ? '1px solid var(--border)' : undefined }}>
          <div className="scroll">
            {filtered.length === 0 && <div className="faint pad">No queries match.</div>}
            {filtered.map(({ query, state }) => (
              <button
                key={query.hash}
                className={`action-row${query.hash === selectedHash ? ' selected' : ''}`}
                onClick={() => setSelectedHash(query.hash === selectedHash ? null : query.hash)}
              >
                <span className={`badge ${STATE_BADGE[state]}`} style={{ width: 70, justifyContent: 'center' }}>
                  {state.toUpperCase()}
                </span>
                <span className="grow ellipsis mono" style={{ fontSize: 12 }} title={query.hash}>
                  {queryKeyLabel(query.key)}
                </span>
                <span className="faint" style={{ fontSize: 11.5 }} title="Observers">
                  {query.observers} obs
                </span>
                <span className="faint mono" style={{ fontSize: 11, width: 64, textAlign: 'right' }}>
                  {ago(query.dataUpdatedAt || query.errorUpdatedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
        {selected && (
          <div className="pane" style={{ width: 460 }}>
            <div className="detail-head">
              <div className="mono selectable" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                {selected.hash}
              </div>
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {ACTIONS.map(({ id, label, icon: Icon, hint }) => (
                  <button
                    key={id}
                    className={`btn sm${id === 'remove' ? ' danger' : ''}`}
                    title={hint}
                    onClick={() => run(id, selected.hash)}
                  >
                    <Icon size={12} /> {label}
                  </button>
                ))}
              </div>
            </div>
            <Tabs<TabId>
              tabs={[
                { id: 'data', label: 'Data' },
                { id: 'details', label: 'Details' }
              ]}
              value={tab}
              onChange={setTab}
            />
            <div className="scroll pad">
              {tab === 'data' &&
                (selected.data === undefined ? (
                  <div className="faint">No data yet.</div>
                ) : (
                  <JsonTree data={selected.data} expandDepth={2} />
                ))}
              {tab === 'details' && (
                <div className="col" style={{ gap: 14 }}>
                  {selected.error && (
                    <div className="badge red" style={{ height: 'auto', padding: 10, whiteSpace: 'normal' }}>
                      <Sparkles size={11} /> {selected.error}
                    </div>
                  )}
                  <KeyValue
                    entries={[
                      ['State', queryState(selected)],
                      ['Status', selected.status],
                      ['Fetch status', selected.fetchStatus],
                      ['Observers', String(selected.observers)],
                      ['Stale', selected.isStale ? 'yes' : 'no'],
                      ['Invalidated', selected.isInvalidated ? 'yes' : 'no'],
                      ['Failures', String(selected.failureCount)],
                      ['Data updated', selected.dataUpdatedAt ? formatTime(selected.dataUpdatedAt) : 'never'],
                      ['Error updated', selected.errorUpdatedAt ? formatTime(selected.errorUpdatedAt) : 'never']
                    ]}
                  />
                  <div>
                    <div className="stat-label" style={{ marginBottom: 6 }}>
                      Query key
                    </div>
                    <JsonTree data={selected.key} expandDepth={3} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
