import { useEffect, useMemo, useState } from 'react'
import { Database, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { formatBytes, tryParseJson } from '@shared/format'
import { useSelectedDevice } from '../store/appStore'
import { EmptyState, Modal, SearchInput, Tabs } from '../components/ui'
import { JsonTree } from '../components/JsonTree'
import { sendToSelected, toast } from '../lib/actions'

type Mode = 'view' | 'edit'

const NO_ENTRIES: Array<[string, string | null]> = []

function AddKeyModal({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const submit = async (): Promise<void> => {
    if (!key.trim()) {
      toast('error', 'Key is required')
      return
    }
    if (await sendToSelected({ type: 'storage.set', payload: { key: key.trim(), value } })) onClose()
  }
  return (
    <Modal
      title="Add AsyncStorage key"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit}>
            Add key
          </button>
        </>
      }
    >
      <label className="field">
        <span>Key</span>
        <input className="input" value={key} onChange={(e) => setKey(e.target.value)} autoFocus spellCheck={false} />
      </label>
      <label className="field">
        <span>Value</span>
        <textarea
          className="textarea"
          rows={8}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
      </label>
    </Modal>
  )
}

export function StoragePanel() {
  const device = useSelectedDevice()
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const connected = device?.connected ?? false
  useEffect(() => {
    if (connected && device?.storage === null) void sendToSelected({ type: 'storage.request', payload: {} })
  }, [connected, device?.storage])

  const entries = device?.storage ?? NO_ENTRIES
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return [...entries]
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([k, v]) => !q || k.toLowerCase().includes(q) || (v ?? '').toLowerCase().includes(q))
  }, [entries, search])

  const selected = entries.find(([k]) => k === selectedKey)
  const value = selected?.[1] ?? null
  const parsed = useMemo(() => tryParseJson(value), [value])

  useEffect(() => {
    setMode('view')
    setDraft(parsed.ok ? JSON.stringify(parsed.value, null, 2) : (value ?? ''))
  }, [selectedKey, value, parsed])

  if (!device) return null

  if (device.storage === null && !connected) {
    return (
      <div className="panel">
        <EmptyState icon={<Database size={22} />} title="No storage data">
          Connect a device to inspect its AsyncStorage.
        </EmptyState>
      </div>
    )
  }

  const save = async (): Promise<void> => {
    if (!selectedKey) return
    if (await sendToSelected({ type: 'storage.set', payload: { key: selectedKey, value: draft } })) {
      toast('success', `Saved "${selectedKey}"`)
      setMode('view')
    }
  }

  const remove = async (key: string): Promise<void> => {
    if (await sendToSelected({ type: 'storage.remove', payload: { key } })) {
      if (selectedKey === key) setSelectedKey(null)
      toast('success', `Removed "${key}"`)
    }
  }

  const totalBytes = entries.reduce((sum, [k, v]) => sum + k.length + (v?.length ?? 0), 0)

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="panel-title">AsyncStorage</span>
        <SearchInput value={search} onChange={setSearch} placeholder="Filter keys & values" width={220} />
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>
          {entries.length} keys · {formatBytes(totalBytes)}
        </span>
        <div className="divider" />
        <button className="btn sm" onClick={() => setAdding(true)} disabled={!connected}>
          <Plus size={12} /> Add key
        </button>
        <button
          className="icon-btn"
          title="Refresh"
          onClick={() => sendToSelected({ type: 'storage.request', payload: {} })}
          disabled={!connected}
        >
          <RefreshCw size={15} />
        </button>
        <button
          className="icon-btn"
          title="Clear all storage"
          onClick={() => setConfirmClear(true)}
          disabled={!connected || !entries.length}
        >
          <Trash2 size={15} />
        </button>
      </div>
      {device.storage === null ? (
        <EmptyState icon={<Database size={22} />} title="AsyncStorage not connected">
          Pass your AsyncStorage instance to the SDK:{' '}
          <code>
            createPrism({'{'} asyncStorage: AsyncStorage {'}'})
          </code>
        </EmptyState>
      ) : (
        <div className="split">
          <div className="pane" style={{ width: 340, borderRight: '1px solid var(--border)' }}>
            <div className="scroll">
              {filtered.length === 0 && <div className="faint pad">No keys</div>}
              {filtered.map(([key, v]) => (
                <button
                  key={key}
                  className={`action-row${key === selectedKey ? ' selected' : ''}`}
                  onClick={() => setSelectedKey(key)}
                >
                  <span className="grow ellipsis mono">{key}</span>
                  <span className="faint mono" style={{ fontSize: 11 }}>
                    {formatBytes(v?.length ?? 0)}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="pane fill">
            {!selected ? (
              <EmptyState icon={<Database size={22} />} title="Select a key">
                View, edit or delete the stored value.
              </EmptyState>
            ) : (
              <div className="panel">
                <Tabs<Mode>
                  tabs={[
                    { id: 'view', label: 'Value' },
                    { id: 'edit', label: 'Edit' }
                  ]}
                  value={mode}
                  onChange={setMode}
                  right={
                    <>
                      <span className="mono dim" style={{ fontSize: 12 }}>
                        {selectedKey}
                      </span>
                      {mode === 'edit' && (
                        <button className="btn sm primary" onClick={save} disabled={!connected}>
                          <Save size={12} /> Save
                        </button>
                      )}
                      <button className="btn sm danger" onClick={() => remove(selected[0])} disabled={!connected}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </>
                  }
                />
                <div className="scroll pad col">
                  {mode === 'view' &&
                    (parsed.ok ? (
                      <JsonTree data={parsed.value} expandDepth={2} />
                    ) : (
                      <pre className="code">{value ?? 'null'}</pre>
                    ))}
                  {mode === 'edit' && (
                    <textarea
                      className="textarea"
                      style={{ flex: 1, minHeight: 300 }}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      spellCheck={false}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {adding && <AddKeyModal onClose={() => setAdding(false)} />}
      {confirmClear && (
        <Modal
          title="Clear all AsyncStorage?"
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                style={{ background: 'var(--red)', borderColor: 'var(--red)' }}
                onClick={async () => {
                  await sendToSelected({ type: 'storage.clear', payload: {} })
                  setConfirmClear(false)
                  setSelectedKey(null)
                }}
              >
                Clear {entries.length} keys
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }}>
            This deletes every key in the app's AsyncStorage on the device. It cannot be undone.
          </p>
        </Modal>
      )}
    </div>
  )
}
