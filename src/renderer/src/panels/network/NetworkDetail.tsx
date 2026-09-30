import { useState } from 'react'
import { Braces, Copy, FlaskConical, Link, RotateCw, Terminal, X } from 'lucide-react'
import {
  contentType,
  entryDuration,
  entryState,
  resourceKind,
  splitUrl,
  statusLine,
  type NetworkEntry
} from '@shared/network'
import { formatBytes, formatDuration, formatTime } from '@shared/format'
import { toCurl, toFetch } from '@shared/snippets'
import type { ReplayResult } from '@shared/types'
import { KeyValue, Modal, Section, Tabs } from '../../components/ui'
import { copyText, toast } from '../../lib/actions'
import { createMockFromEntry } from '../../lib/mocks'
import { BodyView } from './BodyView'

type TabId = 'headers' | 'payload' | 'response' | 'timing'

const sortedHeaders = (headers: Record<string, string> | undefined): Array<readonly [string, string]> =>
  Object.entries(headers ?? {}).sort(([a], [b]) => a.localeCompare(b))

function StatusBadge({ entry }: { entry: NetworkEntry }) {
  const state = entryState(entry)
  const color =
    state === 'success'
      ? 'green'
      : state === 'redirect'
        ? 'blue'
        : state === 'client-error'
          ? 'yellow'
          : state === 'pending'
            ? ''
            : 'red'
  const label = entry.error
    ? entry.error.kind.toUpperCase()
    : entry.response
      ? statusLine(entry.response.status, entry.response.statusText)
      : 'PENDING'
  return <span className={`badge ${color}`}>{label}</span>
}

function ReplayModal({ result, onClose }: { result: ReplayResult; onClose: () => void }) {
  return (
    <Modal title="Replay result" onClose={onClose} width={720}>
      {result.ok ? (
        <>
          <div className="row">
            <span className={`badge ${(result.status ?? 0) < 400 ? 'green' : 'red'}`}>
              {statusLine(result.status ?? 0, result.statusText)}
            </span>
            <span className="dim">{formatDuration(result.durationMs)}</span>
            <span className="faint">(sent from desktop, not from the device)</span>
          </div>
          <Section title="Response headers" count={Object.keys(result.headers ?? {}).length} defaultOpen={false}>
            <KeyValue entries={sortedHeaders(result.headers)} />
          </Section>
          <BodyView body={result.body} emptyLabel="Empty response body" />
        </>
      ) : (
        <div className="badge red" style={{ height: 'auto', padding: 10 }}>
          {result.error}
        </div>
      )}
    </Modal>
  )
}

export function NetworkDetail({ entry, onClose }: { entry: NetworkEntry; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('headers')
  const [replay, setReplay] = useState<ReplayResult | null>(null)
  const [replaying, setReplaying] = useState(false)
  const { request, response, error } = entry
  const url = splitUrl(request.url)
  const duration = entryDuration(entry)
  const isImage = resourceKind(entry) === 'image'

  const doReplay = async (): Promise<void> => {
    setReplaying(true)
    try {
      setReplay(
        await window.loupe.replayRequest({
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.body
        })
      )
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="panel detail">
      <div className="detail-head">
        <div className="row" style={{ gap: 8, minWidth: 0 }}>
          <span className={`method method-${request.method}`}>{request.method}</span>
          <StatusBadge entry={entry} />
          {response?.mockedBy && (
            <span className="badge accent">
              <FlaskConical size={10} /> {response.mockedBy}
            </span>
          )}
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={15} />
          </button>
        </div>
        <div className="detail-url mono selectable" title={request.url}>
          {request.url}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <button className="btn sm ghost" onClick={() => copyText(request.url, 'URL copied')}>
            <Link size={12} /> URL
          </button>
          <button className="btn sm ghost" onClick={() => copyText(toCurl(request), 'cURL copied')}>
            <Terminal size={12} /> cURL
          </button>
          <button className="btn sm ghost" onClick={() => copyText(toFetch(request), 'fetch() copied')}>
            <Braces size={12} /> fetch
          </button>
          {response?.body && (
            <button className="btn sm ghost" onClick={() => copyText(response.body ?? '', 'Response copied')}>
              <Copy size={12} /> Response
            </button>
          )}
          <span className="spacer" />
          <button className="btn sm" onClick={doReplay} disabled={replaying}>
            <RotateCw size={12} className={replaying ? 'spin' : undefined} /> Replay
          </button>
          <button className="btn sm" onClick={() => createMockFromEntry(entry)} disabled={!response}>
            <FlaskConical size={12} /> Mock
          </button>
        </div>
      </div>

      <Tabs<TabId>
        tabs={[
          { id: 'headers', label: 'Headers' },
          { id: 'payload', label: 'Payload' },
          { id: 'response', label: 'Response' },
          { id: 'timing', label: 'Timing' }
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="scroll">
        {tab === 'headers' && (
          <>
            <Section title="General">
              <KeyValue
                entries={[
                  ['Request URL', request.url],
                  ['Method', request.method],
                  [
                    'Status',
                    response ? statusLine(response.status, response.statusText) : error ? error.message : 'Pending'
                  ],
                  ['Captured via', request.source],
                  ['Content type', contentType(response?.headers) || '—'],
                  ...(response?.mockedBy ? [['Mocked by', response.mockedBy] as const] : [])
                ]}
              />
            </Section>
            {url.query.length > 0 && (
              <Section title="Query parameters" count={url.query.length}>
                <KeyValue entries={url.query} />
              </Section>
            )}
            <Section title="Response headers" count={Object.keys(response?.headers ?? {}).length}>
              <KeyValue
                entries={sortedHeaders(response?.headers)}
                empty={response ? 'No headers' : 'Waiting for response…'}
              />
            </Section>
            <Section title="Request headers" count={Object.keys(request.headers).length}>
              <KeyValue entries={sortedHeaders(request.headers)} />
            </Section>
          </>
        )}
        {tab === 'payload' && (
          <div className="pad col" style={{ minHeight: '100%' }}>
            <BodyView key={`${entry.id}-req`} body={request.body} emptyLabel="This request has no body" />
          </div>
        )}
        {tab === 'response' && (
          <div className="pad col" style={{ minHeight: '100%' }}>
            {error ? (
              <div className="badge red" style={{ height: 'auto', padding: 10 }}>
                {error.message}
              </div>
            ) : (
              <BodyView
                key={`${entry.id}-res`}
                body={response?.body}
                truncated={response?.truncated}
                imageUrl={isImage ? request.url : undefined}
                emptyLabel={response ? 'Empty response body' : 'Waiting for response…'}
              />
            )}
          </div>
        )}
        {tab === 'timing' && (
          <div className="pad col" style={{ gap: 16 }}>
            <KeyValue
              entries={[
                ['Started', formatTime(request.startedAt)],
                ['Finished', response || error ? formatTime((response?.endedAt ?? error?.endedAt) as number) : '—'],
                ['Duration', formatDuration(duration)],
                ['Response size', formatBytes(response?.bodySize)],
                ['Request size', formatBytes(request.body?.length ?? 0)]
              ]}
            />
            {duration !== undefined && (
              <div className="timing-bar">
                <div className="timing-fill" style={{ width: '100%' }} />
                <span className="mono">{formatDuration(duration)}</span>
              </div>
            )}
          </div>
        )}
      </div>
      {replay && <ReplayModal result={replay} onClose={() => setReplay(null)} />}
    </div>
  )
}
