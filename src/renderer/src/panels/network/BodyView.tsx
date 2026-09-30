import { useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import { prettyJson, tryParseJson } from '@shared/format'
import { JsonTree } from '../../components/JsonTree'
import { SearchInput } from '../../components/ui'
import { copyText } from '../../lib/actions'

type Mode = 'tree' | 'raw' | 'preview'

interface Props {
  body: string | undefined
  truncated?: boolean
  imageUrl?: string
  emptyLabel: string
}

/** Displays a request/response body as a JSON tree, raw text or image preview. */
export function BodyView({ body, truncated, imageUrl, emptyLabel }: Props) {
  const parsed = useMemo(() => tryParseJson(body), [body])
  const [mode, setMode] = useState<Mode>(imageUrl ? 'preview' : parsed.ok ? 'tree' : 'raw')
  const [search, setSearch] = useState('')

  if (!body && !imageUrl) return <div className="empty faint">{emptyLabel}</div>

  const modes: Array<{ id: Mode; label: string }> = [
    ...(parsed.ok ? [{ id: 'tree' as const, label: 'Pretty' }] : []),
    { id: 'raw', label: 'Raw' },
    ...(imageUrl ? [{ id: 'preview' as const, label: 'Preview' }] : [])
  ]
  const active = modes.some((m) => m.id === mode) ? mode : modes[0].id

  return (
    <div className="col" style={{ gap: 10, minHeight: 0, flex: 1 }}>
      <div className="row">
        <div className="chips">
          {modes.map((m) => (
            <button key={m.id} className={`chip${active === m.id ? ' active' : ''}`} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        {active === 'tree' && (
          <SearchInput value={search} onChange={setSearch} placeholder="Search keys & values" width={200} />
        )}
        <span className="spacer" />
        {truncated && <span className="badge yellow">TRUNCATED</span>}
        {body && (
          <button className="btn ghost sm" onClick={() => copyText(prettyJson(body), 'Body copied')}>
            <Copy size={12} /> Copy
          </button>
        )}
      </div>
      {active === 'tree' && parsed.ok && <JsonTree data={parsed.value} expandDepth={2} search={search} />}
      {active === 'raw' && <pre className="code">{prettyJson(body)}</pre>}
      {active === 'preview' && imageUrl && (
        <div className="image-preview">
          <img src={imageUrl} alt="Response preview" />
        </div>
      )}
    </div>
  )
}
