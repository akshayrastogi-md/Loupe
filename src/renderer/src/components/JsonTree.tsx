import { memo, useState, type ReactNode } from 'react'
import { ChevronRight, Copy } from 'lucide-react'
import { copyText } from '../lib/actions'

interface JsonTreeProps {
  data: unknown
  /** Nodes shallower than this depth start expanded. */
  expandDepth?: number
  search?: string
  rootLabel?: string
}

const MAX_CHILDREN = 500

const isContainer = (v: unknown): v is Record<string, unknown> | unknown[] => typeof v === 'object' && v !== null

function Highlight({ text, search }: { text: string; search?: string }): ReactNode {
  if (!search) return text
  const idx = text.toLowerCase().indexOf(search.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="json-match" style={{ color: 'inherit', background: undefined }}>
        {text.slice(idx, idx + search.length)}
      </mark>
      {text.slice(idx + search.length)}
    </>
  )
}

function Primitive({ value, search }: { value: unknown; search?: string }): ReactNode {
  if (value === null) return <span className="json-null">null</span>
  switch (typeof value) {
    case 'string':
      return (
        <span className="json-string">
          "<Highlight text={value} search={search} />"
        </span>
      )
    case 'number':
      return <span className="json-number">{String(value)}</span>
    case 'boolean':
      return <span className="json-boolean">{String(value)}</span>
    default:
      return <span className="json-null">{String(value)}</span>
  }
}

function summarize(value: Record<string, unknown> | unknown[]): string {
  if (Array.isArray(value)) return `Array(${value.length})`
  const keys = Object.keys(value)
  const preview = keys.slice(0, 3).join(', ')
  return `{${preview}${keys.length > 3 ? ', …' : ''}}`
}

function containsMatch(value: unknown, search: string, depth = 0): boolean {
  if (depth > 12) return false
  if (!isContainer(value)) return String(value).toLowerCase().includes(search)
  return Object.entries(value).some(([k, v]) => k.toLowerCase().includes(search) || containsMatch(v, search, depth + 1))
}

interface NodeProps {
  name: string | null
  value: unknown
  depth: number
  path: string
  expandDepth: number
  search?: string
}

const JsonNode = memo(function JsonNode({ name, value, depth, path, expandDepth, search }: NodeProps) {
  const searchLower = search?.toLowerCase()
  const autoOpen = depth < expandDepth || (searchLower ? containsMatch(value, searchLower) : false)
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? autoOpen
  const indent = { paddingLeft: depth * 14 }

  const label =
    name !== null ? (
      <>
        <span className="json-key">
          <Highlight text={name} search={search} />
        </span>
        <span className="json-meta">:&nbsp;</span>
      </>
    ) : null

  const actions = (
    <span className="json-actions">
      <button
        className="icon-btn sm"
        title={`Copy ${path || 'value'}`}
        onClick={(e) => {
          e.stopPropagation()
          void copyText(typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'Value copied')
        }}
      >
        <Copy size={12} />
      </button>
    </span>
  )

  if (!isContainer(value)) {
    return (
      <div className="json-row" style={indent}>
        <span className="json-toggle" />
        <span className="grow">
          {label}
          <Primitive value={value} search={search} />
        </span>
        {actions}
      </div>
    )
  }

  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value)
  const isArray = Array.isArray(value)

  return (
    <>
      <div className="json-row" style={indent} onClick={() => setOpen(!isOpen)}>
        <button className={`json-toggle${isOpen ? ' open' : ''}`} aria-label={isOpen ? 'Collapse' : 'Expand'}>
          <ChevronRight size={12} />
        </button>
        <span className="grow">
          {label}
          <span className="json-meta">
            {isOpen ? (isArray ? `Array(${entries.length})` : `{${entries.length}}`) : summarize(value)}
          </span>
        </span>
        {actions}
      </div>
      {isOpen &&
        entries
          .slice(0, MAX_CHILDREN)
          .map(([key, child]) => (
            <JsonNode
              key={key}
              name={key}
              value={child}
              depth={depth + 1}
              path={isArray ? `${path}[${key}]` : path ? `${path}.${key}` : key}
              expandDepth={expandDepth}
              search={search}
            />
          ))}
      {isOpen && entries.length > MAX_CHILDREN && (
        <div className="json-row json-meta" style={{ paddingLeft: (depth + 1) * 14 + 16 }}>
          … {entries.length - MAX_CHILDREN} more
        </div>
      )}
    </>
  )
})

export function JsonTree({ data, expandDepth = 1, search, rootLabel }: JsonTreeProps) {
  return (
    <div className="json">
      <JsonNode
        name={rootLabel ?? null}
        value={data}
        depth={0}
        path=""
        expandDepth={expandDepth}
        search={search || undefined}
      />
    </div>
  )
}
