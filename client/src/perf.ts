import type { ClientMessage } from './protocol'

export const SAMPLE_INTERVAL_MS = 1000
const LAG_PROBE_MS = 100
const BYTES_PER_MB = 1024 * 1024

interface HermesStats {
  js_heapSize?: number
  js_allocatedBytes?: number
}

function readMemoryMb(): number | undefined {
  const hermes = (globalThis as { HermesInternal?: { getInstrumentedStats?: () => HermesStats } }).HermesInternal
  const stats = hermes?.getInstrumentedStats?.()
  const bytes = stats?.js_allocatedBytes ?? stats?.js_heapSize
  if (typeof bytes === 'number') return Math.round((bytes / BYTES_PER_MB) * 10) / 10
  const perfMemory = (globalThis as { performance?: { memory?: { usedJSHeapSize?: number } } }).performance?.memory
  if (typeof perfMemory?.usedJSHeapSize === 'number') {
    return Math.round((perfMemory.usedJSHeapSize / BYTES_PER_MB) * 10) / 10
  }
  return undefined
}

/**
 * Samples JS-thread frame rate (via requestAnimationFrame), event-loop lag and
 * Hermes heap usage once per second.
 */
export function installPerformance(send: (message: ClientMessage) => void): () => void {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame
  const caf = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame
  let frames = 0
  let maxLag = 0
  let rafId: number | null = null
  let running = true

  const onFrame = (): void => {
    if (!running || !raf) return
    frames += 1
    rafId = raf(onFrame)
  }
  if (raf) rafId = raf(onFrame)

  let expected = Date.now() + LAG_PROBE_MS
  const lagTimer = setInterval(() => {
    const t = Date.now()
    maxLag = Math.max(maxLag, t - expected)
    expected = t + LAG_PROBE_MS
  }, LAG_PROBE_MS)

  let windowStart = Date.now()
  const sampleTimer = setInterval(() => {
    const t = Date.now()
    const elapsed = (t - windowStart) / 1000
    const fps = raf && elapsed > 0 ? Math.min(120, Math.round(frames / elapsed)) : 0
    send({
      type: 'perf.sample',
      payload: { timestamp: t, fps, jsLagMs: Math.max(0, maxLag), memoryMb: readMemoryMb() }
    })
    frames = 0
    maxLag = 0
    windowStart = t
  }, SAMPLE_INTERVAL_MS)

  return () => {
    running = false
    clearInterval(lagTimer)
    clearInterval(sampleTimer)
    if (rafId !== null && caf) caf(rafId)
  }
}
