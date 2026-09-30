import { useState } from 'react'
import { Cable, Menu, Play, RefreshCw, Smartphone, TerminalSquare, Zap } from 'lucide-react'
import type { CommandDescriptor } from '@shared/protocol'
import { formatTime, previewValue } from '@shared/format'
import type { CommandResult } from '@shared/types'
import { useSelectedDevice } from '../store/appStore'
import { EmptyState, KeyValue } from '../components/ui'
import { JsonTree } from '../components/JsonTree'
import { PlatformIcon } from '../components/Shell'
import { sendToSelected, toast } from '../lib/actions'

let runSeq = 0

function CommandCard({
  command,
  lastResult
}: {
  command: CommandDescriptor
  lastResult?: { ok: boolean; result?: unknown; error?: string }
}) {
  const [args, setArgs] = useState<Record<string, unknown>>({})
  const run = (): void => {
    const runId = `run-${Date.now()}-${runSeq++}`
    void sendToSelected({ type: 'command.run', payload: { commandId: command.id, runId, args } })
  }
  return (
    <div className="card">
      <div className="card-head">
        <Zap size={13} color="var(--accent-strong)" />
        {command.title}
        <span className="spacer" />
        <button className="btn sm primary" onClick={run}>
          <Play size={11} /> Run
        </button>
      </div>
      <div className="card-body col" style={{ gap: 10 }}>
        {command.description && (
          <div className="dim" style={{ fontSize: 12.5 }}>
            {command.description}
          </div>
        )}
        {(command.args ?? []).map((arg) => (
          <label key={arg.name} className="field">
            <span>
              {arg.name} <span className="faint">({arg.type})</span>
            </span>
            {arg.type === 'boolean' ? (
              <select
                className="select"
                value={String(args[arg.name] ?? 'false')}
                onChange={(e) => setArgs({ ...args, [arg.name]: e.target.value === 'true' })}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : (
              <input
                className="input mono"
                type={arg.type === 'number' ? 'number' : 'text'}
                value={String(args[arg.name] ?? '')}
                onChange={(e) => setArgs({ ...args, [arg.name]: e.target.value })}
              />
            )}
          </label>
        ))}
        {lastResult && (
          <div className={`command-result ${lastResult.ok ? 'ok' : 'fail'}`}>
            {lastResult.ok ? (
              typeof lastResult.result === 'object' && lastResult.result !== null ? (
                <JsonTree data={lastResult.result} expandDepth={1} />
              ) : (
                <span className="mono">
                  {lastResult.result === undefined ? 'Done' : previewValue(lastResult.result, 400)}
                </span>
              )
            ) : (
              <span className="mono">{lastResult.error}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolButton({
  icon,
  label,
  hint,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button className="tool-btn" onClick={onClick} disabled={disabled}>
      <span className="tool-icon">{icon}</span>
      <span className="col" style={{ alignItems: 'flex-start', minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="sub">{hint}</span>
      </span>
    </button>
  )
}

const report = (res: CommandResult): void =>
  res.ok ? toast('success', res.output || 'Done') : toast('error', res.error ?? 'Failed')

export function DevicePanel() {
  const device = useSelectedDevice()
  const [adbOutput, setAdbOutput] = useState<string | null>(null)

  if (!device) {
    return (
      <div className="panel">
        <EmptyState icon={<Smartphone size={22} />} title="No device selected" />
      </div>
    )
  }

  const { info } = device.summary
  const results = device.commandResults
  const lastResultFor = (id: string): (typeof results)[string] | undefined =>
    Object.values(results)
      .filter((r) => r.commandId === id)
      .at(-1)

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="panel-title">Device & Commands</span>
      </div>
      <div className="scroll pad device-grid">
        <div className="card">
          <div className="card-head">
            <PlatformIcon platform={info.platform} />
            <div className="col">
              <span>{info.appName}</span>
              <span className="sub" style={{ fontWeight: 400 }}>
                {info.deviceName ?? device.summary.remoteAddress}
              </span>
            </div>
            <span className="spacer" />
            <span className={`badge ${device.connected ? 'green' : ''}`}>
              {device.connected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>
          </div>
          <div className="card-body">
            <KeyValue
              entries={[
                ['Platform', `${info.platform} ${info.osVersion ?? ''}`],
                ['React Native', info.rnVersion ?? '—'],
                ['JS engine', info.hermes ? 'Hermes' : 'JSC / other'],
                ['Emulator', info.isEmulator ? 'Yes' : 'No / unknown'],
                [
                  'Screen',
                  info.screen
                    ? `${Math.round(info.screen.width)}×${Math.round(info.screen.height)} @${info.screen.scale}x`
                    : '—'
                ],
                ['Remote address', device.summary.remoteAddress],
                ['Connected at', formatTime(device.summary.connectedAt)],
                ['Bundle URL', info.bundleUrl ?? '—'],
                ['SDK', info.sdkVersion ?? '—']
              ]}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">App controls</div>
          <div className="card-body tool-grid">
            <ToolButton
              icon={<RefreshCw size={16} />}
              label="Reload app"
              hint="DevSettings.reload()"
              disabled={!device.connected}
              onClick={() => sendToSelected({ type: 'app.reload', payload: {} })}
            />
            <ToolButton
              icon={<Menu size={16} />}
              label="Open dev menu"
              hint="On the device"
              disabled={!device.connected}
              onClick={() => sendToSelected({ type: 'app.devMenu', payload: {} })}
            />
            <ToolButton
              icon={<RefreshCw size={16} />}
              label="Reload via Metro"
              hint="All apps on Metro"
              onClick={async () => report(await window.loupe.metroCommand('reload'))}
            />
            <ToolButton
              icon={<Menu size={16} />}
              label="Dev menu via Metro"
              hint="All apps on Metro"
              onClick={async () => report(await window.loupe.metroCommand('devMenu'))}
            />
            <ToolButton
              icon={<Cable size={16} />}
              label="adb reverse"
              hint="Forward Loupe + Metro ports"
              onClick={async () => report(await window.loupe.adbReverse())}
            />
            <ToolButton
              icon={<TerminalSquare size={16} />}
              label="adb devices"
              hint="List Android devices"
              onClick={async () => {
                const res = await window.loupe.adbDevices()
                setAdbOutput(res.ok ? res.output || '(none)' : (res.error ?? 'Failed'))
              }}
            />
          </div>
          {adbOutput && (
            <pre className="code" style={{ margin: '0 14px 14px' }}>
              {adbOutput}
            </pre>
          )}
        </div>

        <div className="col" style={{ gap: 12, gridColumn: '1 / -1' }}>
          <div className="row">
            <span className="stat-label">Custom commands</span>
            <span className="faint" style={{ fontSize: 12 }}>
              registered by the app with loupe.registerCommand()
            </span>
          </div>
          {device.commands.length === 0 ? (
            <div className="card card-body faint" style={{ fontSize: 12.5 }}>
              No commands registered. Expose actions like "Log out", "Reset onboarding" or "Seed test data":
              <pre className="code" style={{ marginTop: 10 }}>{`loupe.registerCommand({
  id: 'logout',
  title: 'Log out',
  handler: () => store.dispatch(logout()),
})`}</pre>
            </div>
          ) : (
            <div className="command-grid">
              {device.commands.map((c) => (
                <CommandCard key={c.id} command={c} lastResult={lastResultFor(c.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
