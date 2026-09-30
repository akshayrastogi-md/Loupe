import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Apple,
  Bug,
  CheckCircle2,
  ChevronDown,
  Database,
  FlaskConical,
  Globe,
  Info,
  Layers,
  Pause,
  Play,
  Settings,
  Smartphone,
  SquareTerminal,
  WifiOff,
  X,
  XCircle
} from 'lucide-react'
import type { Platform } from '@shared/protocol'
import { useAppStore, useSelectedDevice, type PanelId } from '../store/appStore'
import type { DeviceState } from '../store/deviceState'

export const PANELS: ReadonlyArray<{ id: PanelId; label: string; icon: typeof Globe }> = [
  { id: 'network', label: 'Network', icon: Globe },
  { id: 'console', label: 'Console', icon: SquareTerminal },
  { id: 'state', label: 'State', icon: Layers },
  { id: 'storage', label: 'Storage', icon: Database },
  { id: 'performance', label: 'Performance', icon: Activity },
  { id: 'errors', label: 'Errors', icon: Bug },
  { id: 'mocks', label: 'Mocks & Throttling', icon: FlaskConical },
  { id: 'device', label: 'Device & Commands', icon: Smartphone }
]

const modKey = (): string => (window.prism?.platform === 'darwin' ? '⌘' : 'Ctrl+')

export function PlatformIcon({ platform, size = 14 }: { platform: Platform; size?: number }) {
  return (
    <span className={`platform-icon ${platform}`}>
      {platform === 'ios' ? <Apple size={size} /> : <Smartphone size={size} />}
    </span>
  )
}

const deviceSubtitle = (d: DeviceState): string =>
  [
    d.summary.info.deviceName,
    d.summary.info.platform === 'unknown' ? null : `${d.summary.info.platform} ${d.summary.info.osVersion ?? ''}`.trim()
  ]
    .filter(Boolean)
    .join(' · ')

function DevicePicker() {
  const devices = useAppStore((s) => s.devices)
  const selectDevice = useAppStore((s) => s.selectDevice)
  const removeDevice = useAppStore((s) => s.removeDevice)
  const selected = useSelectedDevice()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const list = Object.values(devices).sort((a, b) => b.summary.connectedAt - a.summary.connectedAt)

  return (
    <div className="device-picker no-drag" ref={ref}>
      <button className="device-trigger" onClick={() => setOpen(!open)} disabled={!list.length}>
        {selected ? (
          <>
            <span className={`dot ${selected.connected ? 'ok' : ''}`} />
            <span className="grow ellipsis" style={{ textAlign: 'left' }}>
              <strong style={{ fontWeight: 600 }}>{selected.summary.info.appName}</strong>
              <span className="faint"> · {deviceSubtitle(selected) || selected.summary.remoteAddress}</span>
            </span>
          </>
        ) : (
          <span className="grow faint" style={{ textAlign: 'left' }}>
            Waiting for a device…
          </span>
        )}
        <ChevronDown size={14} className="faint" />
      </button>
      {open && (
        <div className="device-menu">
          {list.map((d) => (
            <div key={d.summary.id} className="row">
              <button
                className={`device-option${d.summary.id === selected?.summary.id ? ' active' : ''}`}
                onClick={() => {
                  selectDevice(d.summary.id)
                  setOpen(false)
                }}
              >
                <PlatformIcon platform={d.summary.info.platform} />
                <span className="grow">
                  <div className="ellipsis" style={{ fontWeight: 500 }}>
                    {d.summary.info.appName}
                  </div>
                  <div className="sub ellipsis">{deviceSubtitle(d) || d.summary.remoteAddress}</div>
                </span>
                <span className={`badge ${d.connected ? 'green' : ''}`}>{d.connected ? 'LIVE' : 'OFFLINE'}</span>
              </button>
              {!d.connected && (
                <button className="icon-btn sm" title="Remove device" onClick={() => removeDevice(d.summary.id)}>
                  <X size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function TitleBar() {
  const paused = useAppStore((s) => s.paused)
  const setPaused = useAppStore((s) => s.setPaused)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const conditions = useAppStore((s) => s.conditions)
  const activeMocks = useAppStore((s) => s.mocks.filter((m) => m.enabled).length)
  const setPanel = useAppStore((s) => s.setPanel)
  const isMac = window.prism?.platform === 'darwin'

  return (
    <header className={`titlebar drag${isMac ? ' mac' : ''}`}>
      <div className="brand">
        <span className="brand-mark" />
        Prism
      </div>
      <DevicePicker />
      <span className="spacer" />
      <div className="row no-drag">
        {conditions.offline && (
          <button className="badge red" style={{ border: 0 }} onClick={() => setPanel('mocks')}>
            <WifiOff size={11} /> OFFLINE SIM
          </button>
        )}
        {!conditions.offline && conditions.latencyMs > 0 && (
          <button className="badge yellow" style={{ border: 0 }} onClick={() => setPanel('mocks')}>
            +{conditions.latencyMs}ms LATENCY
          </button>
        )}
        {activeMocks > 0 && (
          <button className="badge accent" style={{ border: 0 }} onClick={() => setPanel('mocks')}>
            <FlaskConical size={11} /> {activeMocks} MOCK{activeMocks > 1 ? 'S' : ''}
          </button>
        )}
        <button
          className={`icon-btn${paused ? ' active' : ''}`}
          title={paused ? 'Resume capturing' : 'Pause capturing'}
          onClick={() => setPaused(!paused)}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
        <button className="icon-btn" title={`Settings (${modKey()},)`} onClick={() => setSettingsOpen(true)}>
          <Settings size={15} />
        </button>
      </div>
    </header>
  )
}

export function Sidebar() {
  const panel = useAppStore((s) => s.panel)
  const setPanel = useAppStore((s) => s.setPanel)
  const device = useSelectedDevice()
  const mod = modKey()

  return (
    <nav className="sidebar" aria-label="Panels">
      {PANELS.map((p, i) => {
        const Icon = p.icon
        const badge = p.id === 'errors' ? (device?.unseenErrors ?? 0) : 0
        return (
          <button
            key={p.id}
            className={`nav-item${panel === p.id ? ' active' : ''}`}
            onClick={() => setPanel(p.id)}
            aria-label={p.label}
          >
            <Icon size={18} strokeWidth={1.8} />
            {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
            <span className="nav-tooltip">
              {p.label}
              <kbd>
                {mod}
                {i + 1}
              </kbd>
            </span>
          </button>
        )
      })}
    </nav>
  )
}

export function StatusBar() {
  const status = useAppStore((s) => s.status)
  const devices = useAppStore((s) => s.devices)
  const paused = useAppStore((s) => s.paused)
  const device = useSelectedDevice()
  const connectedCount = Object.values(devices).filter((d) => d.connected).length

  return (
    <footer className="statusbar">
      <span className="item" title={status.error}>
        <span className={`dot ${status.listening ? 'ok' : 'bad'}`} />
        {status.listening
          ? `Listening on ${status.host === '0.0.0.0' ? 'all interfaces' : 'localhost'}:${status.port}`
          : status.error || 'Server stopped'}
      </span>
      <span className="item">
        {connectedCount} device{connectedCount === 1 ? '' : 's'} connected
      </span>
      {paused && (
        <span className="item" style={{ color: 'var(--yellow)' }}>
          <Pause size={11} /> Capture paused
        </span>
      )}
      <span className="spacer" />
      {device && (
        <>
          <span className="item">{device.network.order.length} requests</span>
          <span className="item">{device.logs.length} logs</span>
          {device.summary.info.rnVersion && <span className="item">RN {device.summary.info.rnVersion}</span>}
          {device.summary.info.hermes && <span className="item">Hermes</span>}
        </>
      )}
    </footer>
  )
}

export function Toasts() {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismissToast)
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' ? (
            <CheckCircle2 size={15} />
          ) : t.kind === 'error' ? (
            <XCircle size={15} />
          ) : (
            <Info size={15} />
          )}
          <span className="grow">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
