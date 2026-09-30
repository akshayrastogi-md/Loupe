import type { HttpHeaders, NetworkErrorPayload, NetworkRequestPayload, NetworkResponsePayload } from './protocol'

export interface NetworkEntry {
  id: string
  request: NetworkRequestPayload
  response?: NetworkResponsePayload
  error?: NetworkErrorPayload
}

export type ResourceKind = 'json' | 'html' | 'text' | 'image' | 'graphql' | 'media' | 'other'
export type EntryState = 'pending' | 'success' | 'redirect' | 'client-error' | 'server-error' | 'failed'

export function entryState(entry: NetworkEntry): EntryState {
  if (entry.error) return 'failed'
  if (!entry.response) return 'pending'
  const { status } = entry.response
  if (status >= 500) return 'server-error'
  if (status >= 400) return 'client-error'
  if (status >= 300) return 'redirect'
  if (status === 0) return 'failed'
  return 'success'
}

export function entryDuration(entry: NetworkEntry): number | undefined {
  const end = entry.response?.endedAt ?? entry.error?.endedAt
  return end === undefined ? undefined : Math.max(0, end - entry.request.startedAt)
}

export function contentType(headers: HttpHeaders | undefined): string {
  return (headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase()
}

export function resourceKind(entry: NetworkEntry): ResourceKind {
  if (isGraphQL(entry)) return 'graphql'
  const type = contentType(entry.response?.headers)
  if (type.includes('json')) return 'json'
  if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(entry.request.url)) return 'image'
  if (type.includes('html')) return 'html'
  if (type.startsWith('video/') || type.startsWith('audio/')) return 'media'
  if (type.startsWith('text/') || type.includes('xml') || type.includes('javascript')) return 'text'
  return 'other'
}

export function isGraphQL(entry: NetworkEntry): boolean {
  if (/graphql/i.test(entry.request.url)) return true
  const body = entry.request.body
  return typeof body === 'string' && /^\s*\{\s*"(query|operationName)"/.test(body)
}

/** Extracts the GraphQL operation name, if any. */
export function graphQLOperation(entry: NetworkEntry): string | undefined {
  const body = entry.request.body
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as { operationName?: string; query?: string }
    if (parsed.operationName) return parsed.operationName
    return parsed.query?.match(/(?:query|mutation|subscription)\s+(\w+)/)?.[1]
  } catch {
    return undefined
  }
}

export interface UrlParts {
  host: string
  path: string
  name: string
  query: Array<[string, string]>
}

export function splitUrl(url: string): UrlParts {
  try {
    const parsed = new URL(url)
    const segments = parsed.pathname.split('/').filter(Boolean)
    return {
      host: parsed.host,
      path: parsed.pathname + parsed.search,
      name: (segments.at(-1) ?? parsed.host) + parsed.search,
      query: Array.from(parsed.searchParams.entries())
    }
  } catch {
    return { host: '', path: url, name: url, query: [] }
  }
}

export interface NetworkFilter {
  text: string
  methods: readonly string[]
  kinds: readonly ResourceKind[]
  onlyErrors: boolean
  onlyMocked: boolean
}

export const EMPTY_FILTER: NetworkFilter = { text: '', methods: [], kinds: [], onlyErrors: false, onlyMocked: false }

export function matchesFilter(entry: NetworkEntry, filter: NetworkFilter): boolean {
  if (filter.methods.length && !filter.methods.includes(entry.request.method)) return false
  if (filter.kinds.length && !filter.kinds.includes(resourceKind(entry))) return false
  if (filter.onlyMocked && !entry.response?.mockedBy) return false
  if (filter.onlyErrors) {
    const state = entryState(entry)
    if (state !== 'failed' && state !== 'client-error' && state !== 'server-error') return false
  }
  const text = filter.text.trim().toLowerCase()
  if (!text) return true
  if (text.startsWith('status:')) return String(entry.response?.status ?? '').startsWith(text.slice(7))
  return (
    entry.request.url.toLowerCase().includes(text) || (graphQLOperation(entry)?.toLowerCase().includes(text) ?? false)
  )
}

const REASON_PHRASES: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a Teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout'
}

/**
 * "404 Not Found". Standard phrases win for known codes: React Native's XHR
 * omits statusText and iOS native fetch reports localized text like "no error".
 */
export function statusLine(status: number, statusText?: string): string {
  const phrase = REASON_PHRASES[status] || statusText?.trim() || ''
  return phrase ? `${status} ${phrase}` : String(status)
}
