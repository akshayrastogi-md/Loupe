import type { HttpHeaders } from './protocol'

/** Parse the raw string returned by XMLHttpRequest.getAllResponseHeaders(). */
export function parseRawHeaders(raw: string | null | undefined): HttpHeaders {
  if (!raw) return {}
  return raw
    .trim()
    .split(/[\r\n]+/)
    .reduce<HttpHeaders>((acc, line) => {
      const idx = line.indexOf(':')
      if (idx <= 0) return acc
      const key = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      return { ...acc, [key]: acc[key] ? `${acc[key]}, ${value}` : value }
    }, {})
}

/** Normalize any header container (Headers, array pairs, object) into a plain object. */
export function normalizeHeaders(input: unknown): HttpHeaders {
  if (!input) return {}
  const maybeHeaders = input as { forEach?: (cb: (v: string, k: string) => void) => void }
  if (typeof maybeHeaders.forEach === 'function' && !Array.isArray(input)) {
    const out: HttpHeaders = {}
    maybeHeaders.forEach((v, k) => {
      out[k.toLowerCase()] = String(v)
    })
    return out
  }
  if (Array.isArray(input)) {
    return Object.fromEntries(input.map(([k, v]) => [String(k).toLowerCase(), String(v)]))
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([k, v]) => [k.toLowerCase(), String(v)])
  )
}

export function serializeHeaders(headers: HttpHeaders): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')
}
