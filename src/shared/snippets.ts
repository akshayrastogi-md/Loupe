import type { HttpHeaders } from './protocol'

export interface RequestLike {
  url: string
  method: string
  headers: HttpHeaders
  body?: string
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** Produce a copy-pasteable POSIX shell cURL command. */
export function toCurl(req: RequestLike): string {
  const parts = [`curl ${shellQuote(req.url)}`]
  if (req.method.toUpperCase() !== 'GET') parts.push(`-X ${req.method.toUpperCase()}`)
  Object.entries(req.headers).forEach(([k, v]) => parts.push(`-H ${shellQuote(`${k}: ${v}`)}`))
  if (req.body !== undefined && req.body !== '') parts.push(`--data-raw ${shellQuote(req.body)}`)
  return parts.join(' \\\n  ')
}

/** Produce a JS fetch() snippet equivalent to the request. */
export function toFetch(req: RequestLike): string {
  const init: Record<string, unknown> = { method: req.method.toUpperCase() }
  if (Object.keys(req.headers).length) init.headers = req.headers
  if (req.body !== undefined && req.body !== '') init.body = req.body
  return `fetch(${JSON.stringify(req.url)}, ${JSON.stringify(init, null, 2)})`
}
