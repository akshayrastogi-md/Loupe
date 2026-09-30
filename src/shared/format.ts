const KB = 1024
const MB = KB * 1024

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '—'
  if (bytes < KB) return `${bytes} B`
  if (bytes < MB) return `${(bytes / KB).toFixed(1)} kB`
  return `${(bytes / MB).toFixed(2)} MB`
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—'
  if (ms < 1) return `${ms.toFixed(2)} ms`
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export function formatTime(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`
}

/** Pretty-print a string if it parses as JSON; otherwise return it unchanged. */
export function prettyJson(text: string | undefined): string {
  if (!text) return ''
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

export function tryParseJson(text: string | undefined | null): { ok: true; value: unknown } | { ok: false } {
  if (text === undefined || text === null || text === '') return { ok: false }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

/** Render a console argument (already serialized) as a single-line preview. */
export function previewValue(value: unknown, max = 120): string {
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value
  let text: string
  try {
    text = JSON.stringify(value) ?? String(value)
  } catch {
    text = String(value)
  }
  return text.length > max ? `${text.slice(0, max)}…` : text
}
