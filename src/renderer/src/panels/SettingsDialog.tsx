import { useState } from 'react'
import type { AppSettings } from '@shared/types'
import { useAppStore } from '../store/appStore'
import { Modal, Switch } from '../components/ui'
import { toast } from '../lib/actions'

export function SettingsDialog() {
  const settings = useAppStore((s) => s.settings)
  const status = useAppStore((s) => s.status)
  const setSettings = useAppStore((s) => s.setSettings)
  const setStatus = useAppStore((s) => s.setStatus)
  const close = (): void => useAppStore.getState().setSettingsOpen(false)
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saving, setSaving] = useState(false)

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }))

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const nextStatus = await window.prism.updateSettings(draft)
      setSettings(draft)
      setStatus(nextStatus)
      if (nextStatus.listening) {
        toast('success', 'Settings saved')
        close()
      } else toast('error', nextStatus.error ?? 'Server failed to start')
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Settings"
      onClose={close}
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="settings-group">
        <div className="settings-title">Connection</div>
        <div className="form-grid">
          <label className="field">
            <span>Prism port</span>
            <input
              className="input mono"
              type="number"
              min={1024}
              max={65535}
              value={draft.port}
              onChange={(e) => set('port', Number(e.target.value))}
            />
            <span className="hint">Apps connect to ws://host:{draft.port}</span>
          </label>
          <label className="field">
            <span>Metro port</span>
            <input
              className="input mono"
              type="number"
              min={1}
              max={65535}
              value={draft.metroPort}
              onChange={(e) => set('metroPort', Number(e.target.value))}
            />
            <span className="hint">Used for reload, symbolication, open-in-editor</span>
          </label>
        </div>
        <label className="row" style={{ marginTop: 12 }}>
          <Switch on={draft.allowLan} onChange={(v) => set('allowLan', v)} label="Allow LAN connections" />
          <span className="col">
            <span>Allow connections from other devices on the network</span>
            <span className="hint faint" style={{ fontSize: 11.5 }}>
              Needed for physical devices without adb reverse.{' '}
              {status.addresses.length > 1 && `Current IPs: ${status.addresses.slice(1).join(', ')}`}
            </span>
          </span>
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-title">Appearance & data</div>
        <div className="form-grid">
          <label className="field">
            <span>Theme</span>
            <select
              className="select"
              value={draft.theme}
              onChange={(e) => set('theme', e.target.value as AppSettings['theme'])}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">Match system</option>
            </select>
          </label>
          <label className="field">
            <span>Max entries per list</span>
            <input
              className="input mono"
              type="number"
              min={100}
              max={100000}
              step={500}
              value={draft.maxEntries}
              onChange={(e) => set('maxEntries', Number(e.target.value))}
            />
            <span className="hint">Oldest requests/logs are dropped beyond this</span>
          </label>
        </div>
      </div>
      <div className="settings-group">
        <div className="settings-title">Keyboard shortcuts</div>
        <div className="shortcuts">
          <span>
            <kbd>⌘1</kbd>–<kbd>⌘8</kbd> Switch panel
          </span>
          <span>
            <kbd>⌘K</kbd> Clear current panel
          </span>
          <span>
            <kbd>⌘F</kbd> Focus filter
          </span>
          <span>
            <kbd>⌘,</kbd> Settings
          </span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Move through requests
          </span>
          <span>
            <kbd>Esc</kbd> Close details
          </span>
        </div>
      </div>
    </Modal>
  )
}
