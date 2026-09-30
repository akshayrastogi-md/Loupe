import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownLeft, ArrowUpRight, Plug, Send, Trash2 } from 'lucide-react'
import { formatBytes, formatDuration, formatTime, tryParseJson } from '@shared/format'
import { splitUrl } from '@shared/network'
import { useAppStore, useSelectedDevice } from '../../store/appStore'
import type { SocketEntry, SocketFrame } from '../../store/deviceState'
import { Chips, EmptyState, SearchInput } from '../../components/ui'
import { JsonTree } from '../../components/JsonTree'
import { sendToSelected, toast } from '../../lib/actions'

type Direction = 'sent' | 'received'
const FRAME_ROW = 28
const NO_FRAMES: SocketFrame[] = []

const STATUS_COLOR: Record<SocketEntry['status'], string> = {
  connecting: 'var(--text-faint)',
  open: 'var(--green)',
  closing: 'var(--yellow)',
  closed: 'var(--text-faint)',
  error: 'var(--red)'
}

function SocketRow({ socket, selected, onSelect }: { socket: SocketEntry; selected: boolean; onSelect: () => void }) {
  const url = splitUrl(socket.url)
  const end = socket.closedAt ?? Date.now()
  return (
    <button
      className={`action-row${selected ? ' selected' : ''}`}
      onClick={onSelect}
      style={{ alignItems: 'flex-start' }}
    >
      <span className="dot" style={{ background: STATUS_COLOR[socket.status], marginTop: 5 }} />
      <span className="grow" style={{ minWidth: 0 }}>
        <div className="ellipsis mono" style={{ fontSize: 12 }}>
          {url.path || socket.url}
        </div>
        <div className="sub ellipsis">
          {url.host} · {socket.status}
          {socket.code !== undefined && ` (${socket.code})`} · {formatDuration(end - socket.openedAt)}
        </div>
      </span>
      <span className="badge">{socket.frames.length + socket.droppedFrames}</span>
    </button>
  )
}

function FrameDetail({ frame }: { frame: SocketFrame }) {
  const parsed = tryParseJson(frame.data)
  return (
    <div className="scroll pad col" style={{ gap: 10 }}>
      <div className="row faint" style={{ fontSize: 12 }}>
        {frame.direction === 'sent' ? 'Sent' : 'Received'} at {formatTime(frame.timestamp)} · {formatBytes(frame.size)}
        {frame.truncated && <span className="badge yellow">TRUNCATED</span>}
      </div>
      {parsed.ok && !frame.binary ? (
        <JsonTree data={parsed.value} expandDepth={2} />
      ) : (
        <pre className="code">{frame.data}</pre>
      )}
    </div>
  )
}

function Composer({ socket, disabled }: { socket: SocketEntry; disabled: boolean }) {
  const [text, setText] = useState('')
  const send = async (): Promise<void> => {
    if (!text) return
    if (await sendToSelected({ type: 'ws.send', payload: { id: socket.id, data: text } })) {
      toast('success', 'Frame sent from the device')
      setText('')
    }
  }
  return (
    <div className="ws-composer">
      <textarea
        className="textarea"
        rows={2}
        placeholder={disabled ? 'Socket is not open' : 'Send a text frame through this socket (⌘↵)'}
        value={text}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
        }}
      />
      <button className="btn primary" onClick={send} disabled={disabled || !text}>
        <Send size={13} /> Send
      </button>
    </div>
  )
}

export function SocketsView({ modeSwitch }: { modeSwitch: ReactNode }) {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [frameSeq, setFrameSeq] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [directions, setDirections] = useState<Direction[]>([])
  const listRef = useRef<HTMLDivElement>(null)

  const sockets = useMemo(
    () => (device ? device.sockets.order.map((id) => device.sockets.byId[id]).reverse() : []),
    [device]
  )
  const socket = sockets.find((s) => s.id === selectedId) ?? sockets[0]
  const allFrames = socket?.frames ?? NO_FRAMES
  const frames = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allFrames.filter(
      (f) => (!directions.length || directions.includes(f.direction)) && (!q || f.data.toLowerCase().includes(q))
    )
  }, [allFrames, directions, search])
  const frame = frames.find((f) => f.seq === frameSeq)

  const virtualizer = useVirtualizer({
    count: frames.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => FRAME_ROW,
    overscan: 12
  })

  const clear = (): void => {
    if (!device) return
    setSelectedId(null)
    setFrameSeq(null)
    updateDevice(device.summary.id, (d) => ({ ...d, sockets: { order: [], byId: {} } }))
  }

  const toggleDirection = (id: Direction | null): void =>
    setDirections((prev) => (id === null ? [] : prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]))

  return (
    <div className="panel">
      <div className="toolbar">
        {modeSwitch}
        <SearchInput value={search} onChange={setSearch} placeholder="Filter frames" width={220} />
        <Chips
          options={[
            { id: 'sent' as const, label: 'Sent' },
            { id: 'received' as const, label: 'Received' }
          ]}
          value={directions}
          onToggle={toggleDirection}
        />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {sockets.length} socket{sockets.length === 1 ? '' : 's'}
        </span>
        <div className="divider" />
        <button className="icon-btn" title="Clear sockets (⌘K)" onClick={clear} data-clear>
          <Trash2 size={15} />
        </button>
      </div>
      {sockets.length === 0 ? (
        <EmptyState icon={<Plug size={22} />} title="No WebSocket connections yet">
          WebSockets your app opens (chat, live updates, GraphQL subscriptions) appear here with every frame sent and
          received.
        </EmptyState>
      ) : (
        <div className="split">
          <div className="pane" style={{ width: 320, borderRight: '1px solid var(--border)' }}>
            <div className="scroll">
              {sockets.map((s) => (
                <SocketRow
                  key={s.id}
                  socket={s}
                  selected={s.id === socket?.id}
                  onSelect={() => {
                    setSelectedId(s.id)
                    setFrameSeq(null)
                  }}
                />
              ))}
            </div>
          </div>
          <div className="pane fill">
            {socket && (
              <>
                <div className="ws-url mono selectable" title={socket.url}>
                  {socket.url}
                  {socket.droppedFrames > 0 && (
                    <span className="faint"> · oldest {socket.droppedFrames} frames dropped</span>
                  )}
                </div>
                <div className="split" style={{ flex: 1, minHeight: 0 }}>
                  <div className="pane fill">
                    <div className="log-list" ref={listRef}>
                      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                        {virtualizer.getVirtualItems().map((item) => {
                          const f = frames[item.index]
                          const sent = f.direction === 'sent'
                          return (
                            <div
                              key={f.seq}
                              className={`table-row${f.seq === frameSeq ? ' selected' : ''}`}
                              style={{ transform: `translateY(${item.start}px)`, height: FRAME_ROW }}
                              onClick={() => setFrameSeq(f.seq === frameSeq ? null : f.seq)}
                            >
                              <span className="cell" style={{ width: 34 }}>
                                {sent ? (
                                  <ArrowUpRight size={13} color="var(--green)" />
                                ) : (
                                  <ArrowDownLeft size={13} color="var(--blue)" />
                                )}
                              </span>
                              <span className="cell mono faint" style={{ width: 112, fontSize: 11 }}>
                                {formatTime(f.timestamp)}
                              </span>
                              <span className="cell grow mono" style={{ fontSize: 12 }}>
                                {f.data}
                              </span>
                              <span className="cell num faint" style={{ width: 80, fontSize: 11.5 }}>
                                {formatBytes(f.size)}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <Composer socket={socket} disabled={socket.status !== 'open' || !device?.connected} />
                  </div>
                  {frame && (
                    <div className="pane" style={{ width: 380, borderLeft: '1px solid var(--border)' }}>
                      <FrameDetail frame={frame} />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
