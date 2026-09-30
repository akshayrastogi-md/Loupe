import { useEffect, useMemo, useState } from 'react'
import { History, Layers, RefreshCw, Send, Trash2 } from 'lucide-react'
import { diff, type DiffEntry } from '@shared/diff'
import { formatDuration, formatTime, previewValue } from '@shared/format'
import { useAppStore, useSelectedDevice } from '../store/appStore'
import type { ActionEntry } from '../store/deviceState'
import { EmptyState, Modal, SearchInput, Tabs } from '../components/ui'
import { JsonTree } from '../components/JsonTree'
import { sendToSelected, toast } from '../lib/actions'

type TabId = 'state' | 'action' | 'diff'

const actionType = (action: unknown): string => {
  const type = (action as { type?: unknown } | null)?.type
  return typeof type === 'string' ? type : previewValue(action, 60)
}

function DiffView({ entries }: { entries: DiffEntry[] }) {
  if (!entries.length) return <div className="faint pad">No state changes.</div>
  return (
    <div className="diff-list">
      {entries.map((d) => (
        <div key={`${d.kind}-${d.path}`} className={`diff-row ${d.kind}`}>
          <span className="diff-sign">{d.kind === 'added' ? '+' : d.kind === 'removed' ? '−' : '~'}</span>
          <span className="json-key mono">{d.path}</span>
          <span className="mono diff-values">
            {d.kind !== 'added' && <span className="diff-before">{previewValue(d.before, 80)}</span>}
            {d.kind === 'changed' && <span className="faint"> → </span>}
            {d.kind !== 'removed' && <span className="diff-after">{previewValue(d.after, 80)}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

function DispatchModal({ store, onClose }: { store: string; onClose: () => void }) {
  const [text, setText] = useState('{\n  "type": ""\n}')
  const [error, setError] = useState<string | null>(null)
  const submit = async (): Promise<void> => {
    let action: unknown
    try {
      action = JSON.parse(text)
    } catch (err) {
      setError(`Invalid JSON: ${(err as Error).message}`)
      return
    }
    if (await sendToSelected({ type: 'state.dispatch', payload: { store, action } })) {
      toast('success', `Dispatched to ${store}`)
      onClose()
    }
  }
  return (
    <Modal
      title={`Dispatch action → ${store}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            <Send size={13} /> Dispatch
          </button>
        </>
      }
    >
      <textarea
        className="textarea"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoFocus
      />
      {error && <div style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>}
      <div className="faint" style={{ fontSize: 12 }}>
        For Zustand stores the object is merged into state with setState().
      </div>
    </Modal>
  )
}

export function StatePanel() {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const storeNames = useMemo(() => Object.keys(device?.stores ?? {}), [device?.stores])
  const [store, setStore] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('state')
  const [search, setSearch] = useState('')
  const [dispatchOpen, setDispatchOpen] = useState(false)

  const activeStore = store && storeNames.includes(store) ? store : (storeNames[0] ?? null)
  useEffect(() => setSelectedId(null), [activeStore])

  const actions = useMemo(
    () => (device?.actions ?? []).filter((a) => a.store === activeStore),
    [device?.actions, activeStore]
  )
  const filteredActions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? actions.filter((a) => actionType(a.action).toLowerCase().includes(q)) : actions
  }, [actions, search])

  const selectedIndex = actions.findIndex((a) => a.id === selectedId)
  const selected: ActionEntry | undefined = actions[selectedIndex]
  const previous = selectedIndex > 0 ? actions[selectedIndex - 1] : undefined
  const currentState = activeStore ? device?.stores[activeStore] : undefined
  const diffEntries = useMemo(
    () => (selected ? diff(previous?.nextState ?? {}, selected.nextState) : []),
    [selected, previous]
  )

  if (!device || storeNames.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={<Layers size={22} />} title="No state stores connected">
          Connect Redux with <code>prism.reduxEnhancer()</code>, Zustand with <code>prism.trackZustand()</code>, or any
          store with <code>prism.trackStore()</code>. You get an action log, state diffs, dispatch and time travel.
        </EmptyState>
      </div>
    )
  }

  const restore = async (entry: ActionEntry): Promise<void> => {
    if (!activeStore) return
    if (await sendToSelected({ type: 'state.restore', payload: { store: activeStore, state: entry.nextState } })) {
      toast('success', `Restored state after "${actionType(entry.action)}"`)
    }
  }

  const actionList = (
    <div className="panel">
      <div className="list-head">
        <SearchInput value={search} onChange={setSearch} placeholder="Filter actions" width={0} />
      </div>
      <div className="scroll">
        <button className={`action-row${selectedId === null ? ' selected' : ''}`} onClick={() => setSelectedId(null)}>
          <span className="grow ellipsis" style={{ fontWeight: 500 }}>
            Current state
          </span>
          <span className="badge green">LIVE</span>
        </button>
        {[...filteredActions].reverse().map((a) => (
          <button
            key={a.id}
            className={`action-row${a.id === selectedId ? ' selected' : ''}`}
            onClick={() => setSelectedId(a.id)}
          >
            <span className="grow ellipsis mono">{actionType(a.action)}</span>
            {a.durationMs !== undefined && (
              <span className="faint mono" style={{ fontSize: 11 }}>
                {formatDuration(a.durationMs)}
              </span>
            )}
            <span className="faint mono" style={{ fontSize: 11 }}>
              {formatTime(a.timestamp).slice(0, 8)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )

  const detail = (
    <div className="panel">
      <Tabs<TabId>
        tabs={
          selected
            ? [
                { id: 'state', label: 'State' },
                { id: 'action', label: 'Action' },
                { id: 'diff', label: 'Diff', count: diffEntries.length }
              ]
            : [{ id: 'state', label: 'State' }]
        }
        value={selected ? tab : 'state'}
        onChange={setTab}
        right={
          selected && (
            <button
              className="btn sm"
              onClick={() => restore(selected)}
              title="Time travel: replace the app state with this snapshot"
            >
              <History size={12} /> Jump to this state
            </button>
          )
        }
      />
      <div className="scroll pad">
        {(!selected || tab === 'state') && (
          <JsonTree data={selected ? selected.nextState : currentState} expandDepth={1} />
        )}
        {selected && tab === 'action' && <JsonTree data={selected.action} expandDepth={2} />}
        {selected && tab === 'diff' && <DiffView entries={diffEntries} />}
      </div>
    </div>
  )

  return (
    <div className="panel">
      <div className="toolbar">
        <div className="chips">
          {storeNames.map((name) => (
            <button
              key={name}
              className={`chip${name === activeStore ? ' active' : ''}`}
              onClick={() => setStore(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {actions.length} actions
        </span>
        <div className="divider" />
        <button className="btn sm" onClick={() => setDispatchOpen(true)}>
          <Send size={12} /> Dispatch
        </button>
        <button
          className="icon-btn"
          title="Refresh state from device"
          onClick={() => activeStore && sendToSelected({ type: 'state.request', payload: { store: activeStore } })}
        >
          <RefreshCw size={15} />
        </button>
        <button
          className="icon-btn"
          title="Clear action log (⌘K)"
          data-clear
          onClick={() => updateDevice(device.summary.id, (d) => ({ ...d, actions: [] }))}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="split">
        <div className="pane" style={{ width: 320, borderRight: '1px solid var(--border)' }}>
          {actionList}
        </div>
        <div className="pane fill">{detail}</div>
      </div>
      {dispatchOpen && activeStore && <DispatchModal store={activeStore} onClose={() => setDispatchOpen(false)} />}
    </div>
  )
}
