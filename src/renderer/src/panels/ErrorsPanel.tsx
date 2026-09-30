import { useMemo, useState } from 'react'
import { Bug, Copy, ExternalLink, Sparkles, Trash2 } from 'lucide-react'
import { formatTime } from '@shared/format'
import { isLibraryFrame, parseStack, shortFile } from '@shared/stack'
import type { StackFrame } from '@shared/types'
import { useAppStore, useSelectedDevice } from '../store/appStore'
import type { ErrorEntry } from '../store/deviceState'
import { EmptyState, Switch } from '../components/ui'
import { copyText, toast } from '../lib/actions'

interface ErrorGroup {
  key: string
  latest: ErrorEntry
  count: number
  fatal: boolean
}

function groupErrors(errors: ErrorEntry[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()
  errors.forEach((e) => {
    const key = `${e.name}:${e.message}`
    const existing = groups.get(key)
    groups.set(key, {
      key,
      latest: e,
      count: (existing?.count ?? 0) + 1,
      fatal: (existing?.fatal ?? false) || e.isFatal
    })
  })
  return Array.from(groups.values()).sort((a, b) => b.latest.timestamp - a.latest.timestamp)
}

function StackTrace({ error }: { error: ErrorEntry }) {
  const [symbolicated, setSymbolicated] = useState<StackFrame[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const raw = useMemo(() => parseStack(error.stack), [error.stack])
  const frames = symbolicated ?? raw
  const visible = showLibrary ? frames : frames.filter((f) => !isLibraryFrame(f))
  const hidden = frames.length - visible.length

  const symbolicate = async (): Promise<void> => {
    setLoading(true)
    const result = await window.loupe.symbolicate(raw).catch(() => null)
    setLoading(false)
    if (result) {
      setSymbolicated(result)
      toast('success', 'Stack symbolicated via Metro')
    } else toast('error', 'Symbolication failed. Is Metro running?')
  }

  const open = async (frame: StackFrame): Promise<void> => {
    if (frame.lineNumber === null) return
    const res = await window.loupe.openInEditor(frame.file, frame.lineNumber)
    if (!res.ok) toast('error', res.error ?? 'Could not open file')
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row">
        <span className="stat-label">Call stack</span>
        <span className="spacer" />
        <label className="row faint" style={{ fontSize: 12 }}>
          <Switch on={showLibrary} onChange={setShowLibrary} label="Show library frames" /> Library frames
        </label>
        <button className="btn sm" onClick={symbolicate} disabled={loading || !raw.length || Boolean(symbolicated)}>
          <Sparkles size={12} /> {symbolicated ? 'Symbolicated' : loading ? 'Symbolicating…' : 'Symbolicate'}
        </button>
        <button
          className="btn sm"
          title="Open React Native DevTools to set breakpoints"
          onClick={async () => {
            const res = await window.loupe.openDebugger('sources')
            if (!res.ok) toast('error', res.error ?? 'Could not open debugger')
          }}
        >
          <Bug size={12} /> Debug
        </button>
      </div>
      {frames.length === 0 ? (
        <pre className="code">{error.stack ?? 'No stack trace available'}</pre>
      ) : (
        <div className="frames">
          {visible.map((f, i) => (
            <button
              key={i}
              className={`frame${isLibraryFrame(f) ? ' library' : ''}`}
              onClick={() => open(f)}
              title="Open in editor (via Metro)"
            >
              <span className="mono frame-fn">{f.methodName}</span>
              <span className="mono faint ellipsis frame-file">
                {shortFile(f.file)}
                {f.lineNumber !== null && `:${f.lineNumber}:${f.column}`}
              </span>
              {f.lineNumber !== null && <ExternalLink size={12} className="faint frame-open" />}
            </button>
          ))}
          {hidden > 0 && !showLibrary && (
            <button className="frame faint" onClick={() => setShowLibrary(true)}>
              … {hidden} library frames hidden
            </button>
          )}
        </div>
      )}
      {error.componentStack && (
        <>
          <span className="stat-label">Component stack</span>
          <pre className="code">{error.componentStack.trim()}</pre>
        </>
      )}
    </div>
  )
}

export function ErrorsPanel() {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const groups = useMemo(() => groupErrors(device?.errors ?? []), [device?.errors])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const selected = groups.find((g) => g.key === selectedKey) ?? groups[0]

  if (!device || groups.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={<Bug size={22} />} title="No errors, nice">
          Uncaught JS exceptions (fatal and non-fatal) are captured automatically. Report caught errors and error
          boundaries with <code>loupe.reportError()</code>.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="panel-title">Errors</span>
        <span className="faint" style={{ fontSize: 12 }}>
          {device.errors.length} occurrences · {groups.length} unique
        </span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Clear errors (⌘K)"
          data-clear
          onClick={() => updateDevice(device.summary.id, (d) => ({ ...d, errors: [], unseenErrors: 0 }))}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="split">
        <div className="pane" style={{ width: 360, borderRight: '1px solid var(--border)' }}>
          <div className="scroll">
            {groups.map((g) => (
              <button
                key={g.key}
                className={`error-row${g.key === selected?.key ? ' selected' : ''}`}
                onClick={() => setSelectedKey(g.key)}
              >
                <div className="row">
                  <span className={`badge ${g.fatal ? 'red' : 'yellow'}`}>{g.fatal ? 'FATAL' : g.latest.name}</span>
                  <span className="spacer" />
                  {g.count > 1 && <span className="badge">×{g.count}</span>}
                  <span className="faint mono" style={{ fontSize: 11 }}>
                    {formatTime(g.latest.timestamp).slice(0, 8)}
                  </span>
                </div>
                <div className="error-message">{g.latest.message}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="pane fill">
          {selected && (
            <div className="scroll pad col" style={{ gap: 16 }}>
              <div className="col" style={{ gap: 6 }}>
                <div className="row">
                  <span className={`badge ${selected.fatal ? 'red' : 'yellow'}`}>
                    {selected.fatal ? 'FATAL' : 'NON-FATAL'}
                  </span>
                  <span className="mono dim">{selected.latest.name}</span>
                  <span className="spacer" />
                  <button
                    className="btn sm ghost"
                    onClick={() =>
                      copyText(
                        `${selected.latest.name}: ${selected.latest.message}\n${selected.latest.stack ?? ''}`,
                        'Error copied'
                      )
                    }
                  >
                    <Copy size={12} /> Copy
                  </button>
                </div>
                <h2 className="error-title selectable">{selected.latest.message}</h2>
              </div>
              <StackTrace key={selected.latest.id} error={selected.latest} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
