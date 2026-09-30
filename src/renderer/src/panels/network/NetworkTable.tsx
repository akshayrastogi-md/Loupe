import { useEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { FlaskConical } from 'lucide-react'
import {
  entryDuration,
  entryState,
  graphQLOperation,
  resourceKind,
  splitUrl,
  type EntryState,
  type NetworkEntry
} from '@shared/network'
import { formatBytes, formatDuration } from '@shared/format'

const ROW_HEIGHT = 28

const STATE_COLOR: Record<EntryState, string> = {
  pending: 'var(--text-faint)',
  success: 'var(--green)',
  redirect: 'var(--blue)',
  'client-error': 'var(--yellow)',
  'server-error': 'var(--red)',
  failed: 'var(--red)'
}

export const COLUMNS = [
  { id: 'status', label: 'Status', width: 92 },
  { id: 'method', label: 'Method', width: 72 },
  { id: 'name', label: 'Name', width: 0 },
  { id: 'host', label: 'Host', width: 170 },
  { id: 'type', label: 'Type', width: 76 },
  { id: 'size', label: 'Size', width: 80 },
  { id: 'time', label: 'Time', width: 80 },
  { id: 'waterfall', label: 'Waterfall', width: 150 }
] as const

function statusLabel(entry: NetworkEntry): string {
  if (entry.error)
    return entry.error.kind === 'offline' ? 'offline' : entry.error.kind === 'abort' ? '(canceled)' : '(failed)'
  if (!entry.response) return '···'
  return String(entry.response.status)
}

interface Props {
  entries: NetworkEntry[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  compact: boolean
}

export function NetworkTable({ entries, selectedId, onSelect, compact }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  // Timeline bounds for the waterfall column.
  const bounds = useMemo(() => {
    if (!entries.length) return { start: 0, span: 1 }
    const now = Date.now()
    let start = Infinity
    let end = 0
    for (const e of entries) {
      start = Math.min(start, e.request.startedAt)
      end = Math.max(end, e.response?.endedAt ?? e.error?.endedAt ?? now)
    }
    return { start, span: Math.max(1, end - start) }
  }, [entries])

  // Stick to the bottom while new requests stream in, unless the user scrolled up.
  const stickToBottom = useRef(true)
  useEffect(() => {
    const el = parentRef.current
    if (!el) return
    const onScroll = (): void => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 2
    }
    el.addEventListener('scroll', onScroll)
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    if (stickToBottom.current && entries.length) virtualizer.scrollToIndex(entries.length - 1, { align: 'end' })
  }, [entries.length, virtualizer])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const idx = entries.findIndex((x) => x.id === selectedId)
    const next = e.key === 'ArrowDown' ? Math.min(entries.length - 1, idx + 1) : Math.max(0, idx - 1)
    const target = entries[next]
    if (target) {
      onSelect(target.id)
      virtualizer.scrollToIndex(next, { align: 'auto' })
    }
  }

  const visibleColumns = compact
    ? COLUMNS.filter((c) => c.id === 'status' || c.id === 'method' || c.id === 'name' || c.id === 'time')
    : COLUMNS

  return (
    <div className="table" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="table-head">
        {visibleColumns.map((c) => (
          <div
            key={c.id}
            className={`cell${c.id === 'size' || c.id === 'time' ? ' num' : ''}${c.width ? '' : ' grow'}`}
            style={c.width ? { width: c.width } : undefined}
          >
            {c.label}
          </div>
        ))}
      </div>
      <div className="table-body" ref={parentRef}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((item) => {
            const entry = entries[item.index]
            const state = entryState(entry)
            const duration = entryDuration(entry)
            const url = splitUrl(entry.request.url)
            const op = graphQLOperation(entry)
            const isFailed = state === 'failed' || state === 'server-error'
            const left = ((entry.request.startedAt - bounds.start) / bounds.span) * 100
            const width = Math.max(
              0.8,
              (((duration ?? Date.now() - entry.request.startedAt) as number) / bounds.span) * 100
            )
            return (
              <div
                key={entry.id}
                className={`table-row${entry.id === selectedId ? ' selected' : ''}${isFailed ? ' error' : ''}`}
                style={{ transform: `translateY(${item.start}px)`, height: ROW_HEIGHT }}
                onClick={() => onSelect(entry.id === selectedId ? null : entry.id)}
              >
                {visibleColumns.map((c) => {
                  const style = c.width ? { width: c.width } : undefined
                  switch (c.id) {
                    case 'status':
                      return (
                        <div
                          key={c.id}
                          className="cell mono row"
                          style={{ ...style, gap: 6, color: STATE_COLOR[state] }}
                        >
                          <span className="dot" style={{ background: STATE_COLOR[state] }} />
                          {statusLabel(entry)}
                        </div>
                      )
                    case 'method':
                      return (
                        <div key={c.id} className={`cell method method-${entry.request.method}`} style={style}>
                          {entry.request.method}
                        </div>
                      )
                    case 'name':
                      return (
                        <div key={c.id} className="cell grow row" style={{ gap: 6 }} title={entry.request.url}>
                          {entry.response?.mockedBy && (
                            <FlaskConical size={12} color="var(--accent-strong)" style={{ flex: 'none' }} />
                          )}
                          <span className="ellipsis">
                            {op ? (
                              <>
                                <span className="badge accent" style={{ marginRight: 6 }}>
                                  GQL
                                </span>
                                {op}
                              </>
                            ) : (
                              url.name
                            )}
                          </span>
                          {!compact && (
                            <span className="faint ellipsis" style={{ fontSize: 11.5 }}>
                              {url.path}
                            </span>
                          )}
                        </div>
                      )
                    case 'host':
                      return (
                        <div key={c.id} className="cell dim" style={style}>
                          {url.host}
                        </div>
                      )
                    case 'type':
                      return (
                        <div key={c.id} className="cell dim" style={style}>
                          {resourceKind(entry)}
                        </div>
                      )
                    case 'size':
                      return (
                        <div key={c.id} className="cell num dim" style={style}>
                          {entry.response ? formatBytes(entry.response.bodySize) : '—'}
                        </div>
                      )
                    case 'time':
                      return (
                        <div
                          key={c.id}
                          className="cell num"
                          style={{ ...style, color: (duration ?? 0) > 1000 ? 'var(--yellow)' : undefined }}
                        >
                          {duration === undefined ? 'pending' : formatDuration(duration)}
                        </div>
                      )
                    case 'waterfall':
                      return (
                        <div key={c.id} className="cell" style={style}>
                          <div className="waterfall">
                            <div
                              className={`waterfall-bar ${state}`}
                              style={{
                                left: `${Math.min(99, left)}%`,
                                width: `${Math.min(100 - Math.min(99, left), width)}%`
                              }}
                            />
                          </div>
                        </div>
                      )
                  }
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
