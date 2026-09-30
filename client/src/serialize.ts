/**
 * Converts arbitrary JS values into JSON-safe structures so they can cross
 * the wire. Handles cycles, functions, errors, symbols, bigint, Map/Set,
 * Dates and deep/wide structures without throwing.
 */

export const MAX_DEPTH = 8
export const MAX_KEYS = 200
export const MAX_STRING = 10_000
export const MAX_BODY_BYTES = 1_000_000

export interface SerializeOptions {
  maxDepth?: number
  maxKeys?: number
  maxString?: number
}

const truncate = (s: string, max: number): string =>
  s.length > max ? `${s.slice(0, max)}… [${s.length - max} more chars]` : s

export function serialize(value: unknown, options: SerializeOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? MAX_DEPTH
  const maxKeys = options.maxKeys ?? MAX_KEYS
  const maxString = options.maxString ?? MAX_STRING
  const seen = new WeakSet<object>()

  const walkObject = (obj: object, depth: number): unknown => {
    if (Array.isArray(obj)) {
      const items = obj.slice(0, maxKeys).map((item) => walk(item, depth + 1))
      return obj.length > maxKeys ? [...items, `… ${obj.length - maxKeys} more items`] : items
    }
    if (obj instanceof Map) return { '[Map]': walk(Array.from(obj.entries()), depth + 1) }
    if (obj instanceof Set) return { '[Set]': walk(Array.from(obj.values()), depth + 1) }
    const out: Record<string, unknown> = {}
    const keys = Object.keys(obj)
    for (const key of keys.slice(0, maxKeys)) {
      let child: unknown
      try {
        child = (obj as Record<string, unknown>)[key]
      } catch (err) {
        child = `[Getter threw: ${(err as Error)?.message ?? 'unknown'}]`
      }
      out[key] = walk(child, depth + 1)
    }
    if (keys.length > maxKeys) out['…'] = `${keys.length - maxKeys} more keys`
    return out
  }

  const walk = (v: unknown, depth: number): unknown => {
    if (v === null) return null
    switch (typeof v) {
      case 'undefined':
        return '[undefined]'
      case 'string':
        return truncate(v, maxString)
      case 'number':
        return Number.isFinite(v) ? v : String(v)
      case 'boolean':
        return v
      case 'bigint':
        return `${v.toString()}n`
      case 'symbol':
        return v.toString()
      case 'function':
        return `[Function ${v.name || 'anonymous'}]`
    }
    const obj = v as object
    if (seen.has(obj)) return '[Circular]'
    if (obj instanceof Error) return { name: obj.name, message: obj.message, stack: obj.stack }
    if (obj instanceof Date) return obj.toISOString()
    if (depth >= maxDepth) return Array.isArray(obj) ? `[Array(${obj.length})]` : '[Object]'

    seen.add(obj)
    try {
      return walkObject(obj, depth)
    } finally {
      seen.delete(obj)
    }
  }

  return walk(value, 0)
}

/** Clamp a body string to the max wire size. */
export function clampBody(body: string, max = MAX_BODY_BYTES): { body: string; truncated: boolean } {
  if (body.length <= max) return { body, truncated: false }
  return { body: body.slice(0, max), truncated: true }
}

/** Turn a request body of unknown type into a displayable string. */
export function describeBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return body
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString()
  const ctorName = (body as object)?.constructor?.name
  if (ctorName === 'FormData') {
    const parts = (body as { _parts?: Array<[string, unknown]> })._parts
    if (Array.isArray(parts)) {
      return JSON.stringify(Object.fromEntries(parts.map(([k, v]) => [k, typeof v === 'string' ? v : '[File]'])))
    }
    return '[FormData]'
  }
  if (ctorName === 'Blob') return `[Blob ${(body as { size?: number }).size ?? '?'} bytes]`
  if (ctorName === 'ArrayBuffer' || ArrayBuffer.isView?.(body)) return '[Binary data]'
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}
