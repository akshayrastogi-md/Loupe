import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Download, FlaskConical, Globe, Trash2 } from 'lucide-react'
import {
  EMPTY_FILTER,
  entryState,
  matchesFilter,
  resourceKind,
  type NetworkFilter,
  type ResourceKind
} from '@shared/network'
import { toHar } from '@shared/har'
import { formatBytes } from '@shared/format'
import { useSelectedDevice, useAppStore } from '../../store/appStore'
import { Chips, EmptyState, SearchInput } from '../../components/ui'
import { SplitPane } from '../../components/SplitPane'
import { saveFile } from '../../lib/actions'
import { NetworkTable } from './NetworkTable'
import { NetworkDetail } from './NetworkDetail'

const KIND_OPTIONS: ReadonlyArray<{ id: ResourceKind; label: string }> = [
  { id: 'json', label: 'JSON' },
  { id: 'graphql', label: 'GraphQL' },
  { id: 'image', label: 'Img' },
  { id: 'text', label: 'Text' },
  { id: 'html', label: 'HTML' },
  { id: 'other', label: 'Other' }
]

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

export function NetworkPanel() {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const appVersion = useAppStore((s) => s.appVersion)
  const [filter, setFilter] = useState<NetworkFilter>(EMPTY_FILTER)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const all = useMemo(() => (device ? device.network.order.map((id) => device.network.byId[id]) : []), [device])
  const entries = useMemo(() => all.filter((e) => matchesFilter(e, filter)), [all, filter])
  const selected = selectedId && device ? device.network.byId[selectedId] : undefined

  const stats = useMemo(() => {
    const kinds: Partial<Record<ResourceKind, number>> = {}
    let bytes = 0
    let errors = 0
    for (const e of all) {
      const kind = resourceKind(e)
      kinds[kind] = (kinds[kind] ?? 0) + 1
      bytes += e.response?.bodySize ?? 0
      const state = entryState(e)
      if (state === 'failed' || state === 'server-error' || state === 'client-error') errors += 1
    }
    return { kinds, bytes, errors }
  }, [all])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).matches('input, textarea')) setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleKind = (id: ResourceKind | null): void =>
    setFilter((f) => ({
      ...f,
      kinds: id === null ? [] : f.kinds.includes(id) ? f.kinds.filter((k) => k !== id) : [...f.kinds, id]
    }))

  const clear = (): void => {
    if (!device) return
    setSelectedId(null)
    updateDevice(device.summary.id, (d) => ({ ...d, network: { order: [], byId: {} } }))
  }

  const exportHar = (): void => {
    const name = `${device?.summary.info.appName ?? 'loupe'}-${new Date().toISOString().replace(/[:.]/g, '-')}.har`
    void saveFile(name, toHar(entries, appVersion))
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <SearchInput
          value={filter.text}
          onChange={(text) => setFilter((f) => ({ ...f, text }))}
          placeholder="Filter URL, GraphQL op, status:404"
        />
        <Chips
          options={KIND_OPTIONS.map((k) => ({ ...k, count: stats.kinds[k.id] }))}
          value={filter.kinds}
          onToggle={toggleKind}
        />
        <select
          className="select"
          value={filter.methods[0] ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, methods: e.target.value ? [e.target.value] : [] }))}
          aria-label="Method filter"
        >
          <option value="">All methods</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button
          className={`icon-btn${filter.onlyErrors ? ' active' : ''}`}
          title="Only failed requests"
          onClick={() => setFilter((f) => ({ ...f, onlyErrors: !f.onlyErrors }))}
        >
          <AlertCircle size={15} />
        </button>
        <button
          className={`icon-btn${filter.onlyMocked ? ' active' : ''}`}
          title="Only mocked requests"
          onClick={() => setFilter((f) => ({ ...f, onlyMocked: !f.onlyMocked }))}
        >
          <FlaskConical size={15} />
        </button>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {entries.length === all.length ? `${all.length} requests` : `${entries.length} / ${all.length} requests`} ·{' '}
          {formatBytes(stats.bytes)}
          {stats.errors > 0 && <span style={{ color: 'var(--red)' }}> · {stats.errors} failed</span>}
        </span>
        <div className="divider" />
        <button
          className="icon-btn"
          title="Export visible requests as HAR"
          onClick={exportHar}
          disabled={!entries.length}
        >
          <Download size={15} />
        </button>
        <button className="icon-btn" title="Clear (⌘K)" onClick={clear} data-clear>
          <Trash2 size={15} />
        </button>
      </div>
      {all.length === 0 ? (
        <EmptyState icon={<Globe size={22} />} title="No requests yet">
          Every fetch and XMLHttpRequest (including axios) your app makes will show up here, with headers, bodies and
          timings.
        </EmptyState>
      ) : (
        <SplitPane
          storageKey="network"
          initialSize={520}
          left={
            <NetworkTable
              entries={entries}
              selectedId={selectedId}
              onSelect={setSelectedId}
              compact={Boolean(selected)}
            />
          }
          right={
            selected ? <NetworkDetail key={selected.id} entry={selected} onClose={() => setSelectedId(null)} /> : null
          }
        />
      )}
    </div>
  )
}
