import { useEffect, useMemo, useRef, useState } from 'react'

export interface Point {
  t: number
  v: number
}

interface LineChartProps {
  points: Point[]
  height?: number
  unit: string
  /** Fixed y-domain max; otherwise derived from data. */
  max?: number
  /** Optional dashed reference line (e.g. 60fps target). */
  reference?: { value: number; label: string }
  format?: (v: number) => string
}

const PAD = { top: 10, right: 12, bottom: 20, left: 38 }

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

/** Single-series time chart with recessive grid and a crosshair tooltip. */
export function LineChart({
  points,
  height = 150,
  unit,
  max,
  reference,
  format = (v) => String(Math.round(v))
}: LineChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => {
    const innerW = width - PAD.left - PAD.right
    const innerH = height - PAD.top - PAD.bottom
    const yMax = max ?? niceMax(Math.max(1, ...points.map((p) => p.v), reference?.value ?? 0) * 1.1)
    const t0 = points[0]?.t ?? 0
    const t1 = points.at(-1)?.t ?? 1
    const span = Math.max(1, t1 - t0)
    const x = (t: number): number => PAD.left + ((t - t0) / span) * innerW
    const y = (v: number): number => PAD.top + innerH - (Math.min(v, yMax) / yMax) * innerH
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    const area = points.length ? `${path}L${x(t1)},${PAD.top + innerH}L${x(t0)},${PAD.top + innerH}Z` : ''
    return { innerW, innerH, yMax, x, y, path, area, t0, span }
  }, [points, width, height, max, reference])

  const onMove = (e: React.MouseEvent<SVGSVGElement>): void => {
    if (!points.length) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left - PAD.left) / geometry.innerW
    const target = geometry.t0 + ratio * geometry.span
    let best = 0
    points.forEach((p, i) => {
      if (Math.abs(p.t - target) < Math.abs(points[best].t - target)) best = i
    })
    setHover(best)
  }

  const hovered = hover !== null ? points[hover] : undefined
  // 4 or 5 divisions, whichever gives round tick values.
  const divisions = geometry.yMax % 4 === 0 ? 4 : 5
  const ticks = Array.from({ length: divisions + 1 }, (_, i) => (geometry.yMax / divisions) * i)
  const secondsAgo = hovered ? Math.round(((points.at(-1)?.t ?? 0) - hovered.t) / 1000) : 0

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              className="chart-grid"
            />
            <text x={PAD.left - 6} y={geometry.y(tick) + 3} className="chart-axis" textAnchor="end">
              {format(tick)}
            </text>
          </g>
        ))}
        {reference && (
          <g>
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(reference.value)}
              y2={geometry.y(reference.value)}
              className="chart-ref"
            />
            <text x={width - PAD.right} y={geometry.y(reference.value) - 4} className="chart-axis" textAnchor="end">
              {reference.label}
            </text>
          </g>
        )}
        <text x={PAD.left} y={height - 4} className="chart-axis">
          {points.length ? `${Math.round(geometry.span / 1000)}s ago` : ''}
        </text>
        <text x={width - PAD.right} y={height - 4} className="chart-axis" textAnchor="end">
          now
        </text>
        <path d={geometry.area} className="chart-area" />
        <path d={geometry.path} className="chart-line" />
        {hovered && (
          <g>
            <line
              x1={geometry.x(hovered.t)}
              x2={geometry.x(hovered.t)}
              y1={PAD.top}
              y2={PAD.top + geometry.innerH}
              className="chart-crosshair"
            />
            <circle cx={geometry.x(hovered.t)} cy={geometry.y(hovered.v)} r={4} className="chart-dot" />
          </g>
        )}
      </svg>
      {hovered && (
        <div
          className="chart-tooltip"
          style={{ left: Math.min(width - 120, Math.max(0, geometry.x(hovered.t) + 10)), top: PAD.top }}
        >
          <strong>
            {format(hovered.v)} {unit}
          </strong>
          <span className="faint">{secondsAgo === 0 ? 'now' : `${secondsAgo}s ago`}</span>
        </div>
      )}
    </div>
  )
}
