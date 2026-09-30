export type DiffKind = 'added' | 'removed' | 'changed'

export interface DiffEntry {
  path: string
  kind: DiffKind
  before?: unknown
  after?: unknown
}

export const MAX_DIFF_ENTRIES = 500

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const joinPath = (base: string, key: string, isArray: boolean): string =>
  isArray ? `${base}[${key}]` : base ? `${base}.${key}` : key

/** Structural diff of two JSON-like values, reported as flat path entries. */
export function diff(before: unknown, after: unknown, limit = MAX_DIFF_ENTRIES): DiffEntry[] {
  const out: DiffEntry[] = []

  const walk = (a: unknown, b: unknown, path: string): void => {
    if (out.length >= limit || Object.is(a, b)) return
    if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) {
      out.push({ path: path || '(root)', kind: 'changed', before: a, after: b })
      return
    }
    const isArray = Array.isArray(a)
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      const childPath = joinPath(path, key, isArray)
      const inA = Object.prototype.hasOwnProperty.call(a, key)
      const inB = Object.prototype.hasOwnProperty.call(b, key)
      if (!inA) out.push({ path: childPath, kind: 'added', after: b[key] })
      else if (!inB) out.push({ path: childPath, kind: 'removed', before: a[key] })
      else walk(a[key], b[key], childPath)
      if (out.length >= limit) return
    }
  }

  walk(before, after, '')
  return out
}
