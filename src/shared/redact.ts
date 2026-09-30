import type { HttpHeaders } from './protocol'
import type { NetworkEntry } from './network'

export const REDACTED = '[REDACTED]'

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token'
])

// Matches keys like password, accessToken, refresh_token, client_secret, apiKey, otp, pin.
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|api[-_]?key|authorization|session|cookie|otp|^pin$|signature|credential/i

const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key)

export function redactHeaders(headers: HttpHeaders): HttpHeaders {
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, SENSITIVE_HEADERS.has(k.toLowerCase()) ? REDACTED : v])
  )
}

export function redactUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  let changed = false
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (isSensitiveKey(key)) {
      parsed.searchParams.set(key, REDACTED)
      changed = true
    }
  }
  if (parsed.username || parsed.password) {
    parsed.username = parsed.username ? REDACTED : ''
    parsed.password = ''
    changed = true
  }
  return changed ? parsed.toString() : url
}

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 20 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      isSensitiveKey(k) && (typeof v === 'string' || typeof v === 'number') ? REDACTED : redactValue(v, depth + 1)
    ])
  )
}

/** Redacts sensitive fields in JSON or form-encoded bodies; other bodies are returned unchanged. */
export function redactBody(body: string | undefined): string | undefined {
  if (!body) return body
  try {
    return JSON.stringify(redactValue(JSON.parse(body)))
  } catch {
    // Not JSON: try application/x-www-form-urlencoded.
  }
  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body)) {
    const params = new URLSearchParams(body)
    let changed = false
    for (const key of Array.from(params.keys())) {
      if (isSensitiveKey(key)) {
        params.set(key, REDACTED)
        changed = true
      }
    }
    return changed ? params.toString() : body
  }
  return body
}

/** A copy of the entry with credentials and secrets masked, for sharing. */
export function redactEntry(entry: NetworkEntry): NetworkEntry {
  return {
    ...entry,
    request: {
      ...entry.request,
      url: redactUrl(entry.request.url),
      headers: redactHeaders(entry.request.headers),
      body: redactBody(entry.request.body)
    },
    response: entry.response && {
      ...entry.response,
      headers: redactHeaders(entry.response.headers),
      body: redactBody(entry.response.body)
    }
  }
}
