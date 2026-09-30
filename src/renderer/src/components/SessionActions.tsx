import { useState } from 'react'
import { FileDown, FileUp } from 'lucide-react'
import { useAppStore, useSelectedDevice } from '../store/appStore'
import { exportSession, importSession } from '../store/session'
import { saveFile, toast } from '../lib/actions'
import { Modal, Switch } from './ui'

const SESSION_EXTENSION = 'loupe'

/** Title-bar buttons to export the selected device's capture or import a shared one. */
export function SessionActions() {
  const device = useSelectedDevice()
  const appVersion = useAppStore((s) => s.appVersion)
  const addDevice = useAppStore((s) => s.addDevice)
  const [exporting, setExporting] = useState(false)
  const [redact, setRedact] = useState(true)

  const doExport = (): void => {
    if (!device) return
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `${device.summary.info.appName.replace(/[^\w.-]+/g, '_')}-${stamp}.${SESSION_EXTENSION}`
    void saveFile(name, exportSession(device, appVersion, redact))
    setExporting(false)
  }

  const doImport = async (): Promise<void> => {
    try {
      const file = await window.loupe.openFile([SESSION_EXTENSION, 'json'])
      if (!file) return
      const result = importSession(file.content)
      if (!result.ok) {
        toast('error', result.error)
        return
      }
      addDevice(result.device)
      toast('success', `Imported ${file.name}`)
    } catch (err) {
      toast('error', `Import failed: ${(err as Error).message}`)
    }
  }

  return (
    <>
      <button
        className="icon-btn"
        title="Export session (share a capture)"
        onClick={() => setExporting(true)}
        disabled={!device}
      >
        <FileDown size={15} />
      </button>
      <button className="icon-btn" title="Import session" onClick={doImport}>
        <FileUp size={15} />
      </button>
      {exporting && device && (
        <Modal
          title="Export session"
          onClose={() => setExporting(false)}
          footer={
            <>
              <button className="btn" onClick={() => setExporting(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={doExport}>
                <FileDown size={13} /> Export .{SESSION_EXTENSION}
              </button>
            </>
          }
        >
          <p style={{ margin: 0 }} className="dim">
            Saves everything captured from <strong>{device.summary.info.appName}</strong> as one file: requests,
            WebSockets, logs, errors, state actions, queries and performance. Anyone can open it with Import session.
          </p>
          <label className="row">
            <Switch on={redact} onChange={setRedact} label="Hide secrets" />
            <span className="col">
              <span>Hide secrets (recommended)</span>
              <span className="faint" style={{ fontSize: 12 }}>
                Masks credentials in requests and socket URLs and leaves out AsyncStorage. State, logs and query data
                are exported as captured.
              </span>
            </span>
          </label>
        </Modal>
      )}
    </>
  )
}
