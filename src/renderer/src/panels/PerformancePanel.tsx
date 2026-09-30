import { useMemo } from 'react'
import { Activity, AlertTriangle, CheckCircle2, Trash2, XCircle } from 'lucide-react'
import { useAppStore, useSelectedDevice } from '../store/appStore'
import { EmptyState } from '../components/ui'
import { LineChart, type Point } from '../components/LineChart'

const FPS_GOOD = 55
const FPS_WARN = 40
const LAG_GOOD = 50
const LAG_WARN = 150
const WINDOW_SAMPLES = 120

type Health = 'good' | 'warning' | 'critical'

const HEALTH_META: Record<Health, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  good: { label: 'Smooth', className: 'green', icon: CheckCircle2 },
  warning: { label: 'Degraded', className: 'yellow', icon: AlertTriangle },
  critical: { label: 'Janky', className: 'red', icon: XCircle }
}

function HealthBadge({ health }: { health: Health }) {
  const meta = HEALTH_META[health]
  const Icon = meta.icon
  return (
    <span className={`badge ${meta.className}`}>
      <Icon size={11} /> {meta.label}
    </span>
  )
}

function StatTile({
  label,
  value,
  unit,
  hint,
  badge
}: {
  label: string
  value: string
  unit: string
  hint: string
  badge?: React.ReactNode
}) {
  return (
    <div className="card stat">
      <div className="row">
        <span className="stat-label">{label}</span>
        <span className="spacer" />
        {badge}
      </div>
      <div className="stat-value">
        {value}
        <span className="stat-unit">{unit}</span>
      </div>
      <div className="faint" style={{ fontSize: 11.5 }}>
        {hint}
      </div>
    </div>
  )
}

const avg = (values: number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)

export function PerformancePanel() {
  const device = useSelectedDevice()
  const updateDevice = useAppStore((s) => s.updateDevice)
  const samples = useMemo(() => (device?.perf ?? []).slice(-WINDOW_SAMPLES), [device?.perf])

  if (!device || samples.length === 0) {
    return (
      <div className="panel">
        <EmptyState icon={<Activity size={22} />} title="Waiting for performance samples">
          The SDK samples JS frame rate, event-loop lag and Hermes heap usage once per second while connected.
        </EmptyState>
      </div>
    )
  }

  const latest = samples[samples.length - 1]
  const fps: Point[] = samples.map((s) => ({ t: s.timestamp, v: s.fps }))
  const lag: Point[] = samples.map((s) => ({ t: s.timestamp, v: s.jsLagMs }))
  const memory: Point[] = samples
    .filter((s) => s.memoryMb !== undefined)
    .map((s) => ({ t: s.timestamp, v: s.memoryMb as number }))
  const fpsHealth: Health = latest.fps >= FPS_GOOD ? 'good' : latest.fps >= FPS_WARN ? 'warning' : 'critical'
  const lagHealth: Health = latest.jsLagMs <= LAG_GOOD ? 'good' : latest.jsLagMs <= LAG_WARN ? 'warning' : 'critical'
  const drops = samples.filter((s) => s.fps < FPS_WARN).length
  const peakMemory = Math.max(0, ...memory.map((p) => p.v))

  return (
    <div className="panel">
      <div className="toolbar">
        <span className="panel-title">Performance</span>
        <span className="faint" style={{ fontSize: 12 }}>
          Last {samples.length}s · JS thread
        </span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Reset samples (⌘K)"
          data-clear
          onClick={() => updateDevice(device.summary.id, (d) => ({ ...d, perf: [] }))}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <div className="scroll pad perf-grid">
        <div className="stat-row">
          <StatTile
            label="JS frame rate"
            value={String(latest.fps)}
            unit="fps"
            hint={`avg ${avg(fps.map((p) => p.v)).toFixed(0)} fps · ${drops} slow seconds`}
            badge={<HealthBadge health={fpsHealth} />}
          />
          <StatTile
            label="Event-loop lag"
            value={String(Math.round(latest.jsLagMs))}
            unit="ms"
            hint={`peak ${Math.round(Math.max(...lag.map((p) => p.v)))} ms`}
            badge={<HealthBadge health={lagHealth} />}
          />
          <StatTile
            label="JS heap"
            value={latest.memoryMb !== undefined ? latest.memoryMb.toFixed(1) : '—'}
            unit="MB"
            hint={memory.length ? `peak ${peakMemory.toFixed(1)} MB` : 'Available on Hermes'}
          />
        </div>
        <div className="card">
          <div className="card-head">
            JS frame rate{' '}
            <span className="faint" style={{ fontWeight: 400 }}>
              frames per second
            </span>
          </div>
          <div className="card-body">
            <LineChart points={fps} unit="fps" max={80} reference={{ value: 60, label: '60 fps target' }} />
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            Event-loop lag{' '}
            <span className="faint" style={{ fontWeight: 400 }}>
              worst delay per second, ms
            </span>
          </div>
          <div className="card-body">
            <LineChart points={lag} unit="ms" reference={{ value: LAG_GOOD, label: `${LAG_GOOD} ms budget` }} />
          </div>
        </div>
        {memory.length > 0 && (
          <div className="card">
            <div className="card-head">
              JS heap{' '}
              <span className="faint" style={{ fontWeight: 400 }}>
                MB allocated
              </span>
            </div>
            <div className="card-body">
              <LineChart points={memory} unit="MB" format={(v) => v.toFixed(v < 10 ? 1 : 0)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
