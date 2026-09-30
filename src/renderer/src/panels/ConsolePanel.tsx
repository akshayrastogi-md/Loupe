import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertTriangle, ChevronsDown, Copy, Info, SquareTerminal, Trash2, XCircle } from 'lucide-react'
import type { LogLevel } from '@shared/protocol'
import { formatTime, previewValue } from '@shared/format'
import { useAppStore, useSelectedDevice } from '../store/appStore'
import type { LogEntry } from '../store/deviceState'
import { Chips, EmptyState, SearchInput } from '../components/ui'
import { JsonTree } from '../components/JsonTree'
import { copyText } from '../lib/actions'

const NO_LOGS: LogEntry[] = []

const LEVELS: ReadonlyArray<{ id: LogLevel; label: string }> = [
  { id: 'error', label: 'Errors' },
  { id: 'warn', label: 'Warnings' },
  { id: 'info', label: 'Info' },
  { id: 'log', label: 'Logs' },
  { id: 'debug', label: 'Debug' }
]

const entryText = (entry: LogEntry): string =>
  entry.args.map((a) => (typeof a === 'string' ? a : previewValue(a, 10_000))).join(' ')

function LevelIcon({ level }: { level: LogLevel }) {
  if (level === 'error') return <XCircle size={13} color="var(--red)" />
  if (level === 'warn') return <AlertTriangle size={13} color="var(--yellow)" />
  if (level === 'info') return <Info size={13} color="var(--blue)" />
  return <span style={{ width: 13 }} />
}

const COLLAPSE_CHARS = 400

function LogString({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false)
  if (value.length <= COLLAPSE_CHARS) return <span className="log-string">{value}</span>
  return (
    <span className="log-string">
      {expanded ? value : `${value.slice(0, COLLAPSE_CHARS)}…`}{' '}
      <button className="log-more" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'show less' : `show ${(value.length - COLLAPSE_CHARS).toLocaleString()} more chars`}
      </button>
    </span>
  )
}

const LogArg = memo(function LogArg({ value }: { value: unknown }) {
  if (typeof value === 'string') return <LogString value={value} />
  if (typeof value !== 'object' || value === null)
    return <span className={`json-${value === null ? 'null' : typeof value}`}>{String(value)}</span>
  return (
    <div className="log-object">
      <JsonTree data={value} expandDepth={0} />
    </div>
  )
})

const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  if (entry.system) {
    return (
      <div className="log-row system">
        <span className="log-divider">{String(entry.args[0])}</span>
        <span className="faint mono">{formatTime(entry.timestamp)}</span>
      </div>
    )
  }
  return (
    <div className={`log-row level-${entry.level}`}>
      <span className="log-time mono">{formatTime(entry.timestamp)}</span>
      <span className="log-icon">
        <LevelIcon level={entry.level} />
      </span>
      <div className="log-body mono selectable">
        {entry.tag && (
          <span className="badge accent" style={{ marginRight: 6 }}>
            {entry.tag}
          </span>
        )}
        {entry.args.map((arg, i) => (
          <LogArg key={i} value={arg} />
        ))}
      </div>
      <button
        className="icon-btn sm log-copy"
        title="Copy message"
        onClick={() => copyText(entryText(entry), 'Log copied')}
      >
        <Copy size={12} />
      </button>
    </div>
  )
})

export function ConsolePanel() {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const [levels, setLevels] = useState<LogLevel[]>([])
  const [search, setSearch] = useState('')
  const [following, setFollowing] = useState(true)
  const parentRef = useRef<HTMLDivElement>(null)

  const logs = device?.logs ?? NO_LOGS
  const counts = useMemo(() => {
    const c: Partial<Record<LogLevel, number>> = {}
    logs.forEach((l) => {
      if (!l.system) c[l.level] = (c[l.level] ?? 0) + 1
    })
    return c
  }, [logs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter((l) => {
      if (l.system) return !q && levels.length === 0
      if (levels.length && !levels.includes(l.level)) return false
      return !q || entryText(l).toLowerCase().includes(q)
    })
  }, [logs, levels, search])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 26,
    overscan: 10,
    getItemKey: (i) => filtered[i].id
  })

  useEffect(() => {
    if (following && filtered.length) virtualizer.scrollToIndex(filtered.length - 1, { align: 'end' })
  }, [filtered.length, following, virtualizer])

  const onScroll = (): void => {
    const el = parentRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom !== following) setFollowing(atBottom)
  }

  const toggleLevel = (id: LogLevel | null): void =>
    setLevels((prev) => (id === null ? [] : prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]))

  const clear = (): void => {
    if (device) updateDevice(device.summary.id, (d) => ({ ...d, logs: [] }))
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter logs" />
        <Chips options={LEVELS.map((l) => ({ ...l, count: counts[l.id] }))} value={levels} onToggle={toggleLevel} />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {filtered.length} messages
        </span>
        <div className="divider" />
        <button className="icon-btn" title="Clear console (⌘K)" onClick={clear} data-clear>
          <Trash2 size={15} />
        </button>
      </div>
      {logs.length === 0 ? (
        <EmptyState icon={<SquareTerminal size={22} />} title="Console is empty">
          console.log / info / warn / error calls from your app stream here in real time. Objects are fully expandable.
        </EmptyState>
      ) : (
        <div className="log-list" ref={parentRef} onScroll={onScroll}>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}
              >
                <LogRow entry={filtered[item.index]} />
              </div>
            ))}
          </div>
          {!following && (
            <button className="btn follow-btn" onClick={() => setFollowing(true)}>
              <ChevronsDown size={13} /> Jump to latest
            </button>
          )}
        </div>
      )}
    </div>
  )
}
