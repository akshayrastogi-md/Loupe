import { useEffect, useState } from 'react'
import { Copy, FlaskConical, Plus, Save, Trash2, WifiOff } from 'lucide-react'
import type { MockMatchType, MockRule } from '@shared/protocol'
import { ruleMatches } from '@shared/mocks'
import { headersToText, textToHeaders } from '@shared/headerText'
import { useAppStore } from '../store/appStore'
import { EmptyState, Switch } from '../components/ui'
import { blankMock, saveConditions, saveMocks, useMockSelection } from '../lib/mocks'
import { toast } from '../lib/actions'

const LATENCY_PRESETS: ReadonlyArray<{ label: string; value: number }> = [
  { label: 'None', value: 0 },
  { label: 'Fast 4G', value: 150 },
  { label: 'Slow 4G', value: 400 },
  { label: '3G', value: 1000 },
  { label: 'Slow 3G', value: 2000 }
]

const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function NetworkConditionsCard() {
  const conditions = useAppStore((s) => s.conditions)
  return (
    <div className="card" style={{ margin: 12 }}>
      <div className="card-head">
        <WifiOff size={14} /> Network conditions
        <span className="faint" style={{ fontWeight: 400 }}>
          applies to all connected apps
        </span>
      </div>
      <div className="card-body col" style={{ gap: 12 }}>
        <label className="row">
          <Switch
            on={conditions.offline}
            onChange={(offline) => saveConditions({ ...conditions, offline })}
            label="Offline"
          />
          <span>Simulate offline</span>
          <span className="faint" style={{ fontSize: 12 }}>
            every request fails like a dropped connection
          </span>
        </label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="dim" style={{ width: 90 }}>
            Added latency
          </span>
          <div className="chips">
            {LATENCY_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`chip${conditions.latencyMs === p.value ? ' active' : ''}`}
                onClick={() => saveConditions({ ...conditions, latencyMs: p.value })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            className="input mono"
            type="number"
            min={0}
            max={60000}
            style={{ width: 90 }}
            value={conditions.latencyMs}
            onChange={(e) =>
              saveConditions({ ...conditions, latencyMs: Math.max(0, Math.min(60000, Number(e.target.value) || 0)) })
            }
            aria-label="Latency in ms"
          />
          <span className="faint">ms</span>
        </div>
      </div>
    </div>
  )
}

function MockEditor({
  rule,
  onSave,
  onDelete,
  onDuplicate
}: {
  rule: MockRule
  onSave: (r: MockRule) => void
  onDelete: () => void
  onDuplicate: () => void
}) {
  const [draft, setDraft] = useState(rule)
  const [headersText, setHeadersText] = useState(headersToText(rule.headers))
  const [testUrl, setTestUrl] = useState('')

  useEffect(() => {
    setDraft(rule)
    setHeadersText(headersToText(rule.headers))
  }, [rule])

  const set = <K extends keyof MockRule>(key: K, value: MockRule[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const dirty = JSON.stringify({ ...draft, headers: textToHeaders(headersText) }) !== JSON.stringify(rule)
  const regexInvalid =
    draft.matchType === 'regex' &&
    (() => {
      try {
        new RegExp(draft.urlPattern)
        return false
      } catch {
        return true
      }
    })()
  const testResult = testUrl
    ? ruleMatches({ ...draft, enabled: true }, draft.method === 'ANY' ? 'GET' : draft.method, testUrl)
    : null

  const save = (): void => {
    if (!draft.urlPattern.trim()) return toast('error', 'URL pattern is required')
    if (regexInvalid) return toast('error', 'Invalid regular expression')
    onSave({ ...draft, headers: textToHeaders(headersText) })
  }

  return (
    <div className="panel">
      <div className="toolbar">
        <input
          className="input"
          style={{ width: 280, fontWeight: 600 }}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          aria-label="Mock name"
        />
        <span className="spacer" />
        <button className="btn sm ghost" onClick={onDuplicate}>
          <Copy size={12} /> Duplicate
        </button>
        <button className="btn sm danger" onClick={onDelete}>
          <Trash2 size={12} /> Delete
        </button>
        <button className="btn sm primary" onClick={save} disabled={!dirty}>
          <Save size={12} /> Save
        </button>
      </div>
      <div className="scroll pad col" style={{ gap: 16, maxWidth: 900 }}>
        <div className="form-grid">
          <label className="field">
            <span>Method</span>
            <select className="select" value={draft.method} onChange={(e) => set('method', e.target.value)}>
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Match</span>
            <select
              className="select"
              value={draft.matchType}
              onChange={(e) => set('matchType', e.target.value as MockMatchType)}
            >
              <option value="contains">URL contains</option>
              <option value="exact">URL equals</option>
              <option value="regex">URL matches regex</option>
            </select>
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}>
            <span>URL pattern</span>
            <input
              className="input mono"
              value={draft.urlPattern}
              onChange={(e) => set('urlPattern', e.target.value)}
              placeholder={draft.matchType === 'regex' ? '/api/users/\\d+' : '/api/users'}
              style={regexInvalid ? { borderColor: 'var(--red)' } : undefined}
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Status</span>
            <input
              className="input mono"
              type="number"
              min={200}
              max={599}
              value={draft.status}
              onChange={(e) => set('status', Math.min(599, Math.max(200, Number(e.target.value) || 200)))}
            />
          </label>
          <label className="field">
            <span>Delay (ms)</span>
            <input
              className="input mono"
              type="number"
              min={0}
              max={120000}
              value={draft.delayMs}
              onChange={(e) => set('delayMs', Math.max(0, Number(e.target.value) || 0))}
            />
          </label>
        </div>
        <label className="field">
          <span>Test a URL against this rule</span>
          <div className="row">
            <input
              className="input mono grow"
              value={testUrl}
              onChange={(e) => setTestUrl(e.target.value)}
              placeholder="https://api.example.com/users/42"
              spellCheck={false}
            />
            {testResult !== null && (
              <span className={`badge ${testResult ? 'green' : 'red'}`}>{testResult ? 'MATCHES' : 'NO MATCH'}</span>
            )}
          </div>
        </label>
        <label className="field">
          <span>Response headers</span>
          <textarea
            className="textarea"
            rows={3}
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            placeholder="content-type: application/json"
            spellCheck={false}
          />
        </label>
        <label className="field">
          <span>Response body</span>
          <textarea
            className="textarea"
            rows={14}
            value={draft.body}
            onChange={(e) => set('body', e.target.value)}
            spellCheck={false}
          />
        </label>
      </div>
    </div>
  )
}

export function MocksPanel() {
  const mocks = useAppStore((s) => s.mocks)
  const { selectedId, select } = useMockSelection()
  const selected = mocks.find((m) => m.id === selectedId) ?? mocks[0]

  const add = async (): Promise<void> => {
    const rule = blankMock()
    if (await saveMocks([...mocks, rule])) select(rule.id)
  }

  const update = (rule: MockRule): void => {
    void saveMocks(mocks.map((m) => (m.id === rule.id ? rule : m))).then((ok) => ok && toast('success', 'Mock saved'))
  }

  return (
    <div className="panel">
      <div className="split">
        <div className="pane" style={{ width: 380, borderRight: '1px solid var(--border)' }}>
          <NetworkConditionsCard />
          <div className="list-head row">
            <span className="stat-label">Mock rules</span>
            <span className="faint" style={{ fontSize: 12 }}>
              {mocks.filter((m) => m.enabled).length} active
            </span>
            <span className="spacer" />
            <button className="btn sm" onClick={add}>
              <Plus size={12} /> New rule
            </button>
          </div>
          <div className="scroll">
            {mocks.length === 0 && (
              <div className="faint pad" style={{ fontSize: 12.5 }}>
                No rules yet. Create one, or click "Mock" on any request in the Network panel.
              </div>
            )}
            {mocks.map((m) => (
              <div
                key={m.id}
                className={`action-row${m.id === selected?.id ? ' selected' : ''}`}
                onClick={() => select(m.id)}
                role="button"
                tabIndex={0}
              >
                <Switch
                  on={m.enabled}
                  onChange={(enabled) => saveMocks(mocks.map((x) => (x.id === m.id ? { ...x, enabled } : x)))}
                  label="Enabled"
                />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis" style={{ fontWeight: 500, opacity: m.enabled ? 1 : 0.5 }}>
                    {m.name}
                  </div>
                  <div className="sub ellipsis mono">
                    <span className={`method method-${m.method}`}>{m.method}</span> {m.urlPattern || '(no pattern)'}
                  </div>
                </div>
                <span className={`badge ${m.status < 400 ? 'green' : 'red'}`}>{m.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="pane fill">
          {selected ? (
            <MockEditor
              key={selected.id}
              rule={selected}
              onSave={update}
              onDelete={() => saveMocks(mocks.filter((m) => m.id !== selected.id))}
              onDuplicate={async () => {
                const copy = { ...selected, id: blankMock().id, name: `${selected.name} (copy)` }
                if (await saveMocks([...mocks, copy])) select(copy.id)
              }}
            />
          ) : (
            <EmptyState icon={<FlaskConical size={22} />} title="Mock any API response">
              Rules intercept matching requests inside the app and return your response, status and delay without
              touching the server. Great for edge cases, error states and backend work in progress.
            </EmptyState>
          )}
        </div>
      </div>
    </div>
  )
}
