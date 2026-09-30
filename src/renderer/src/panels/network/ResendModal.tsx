import { useState } from 'react'
import { Monitor, Send, Smartphone } from 'lucide-react'
import type { ResendRequest } from '@shared/protocol'
import type { ReplayResult } from '@shared/types'
import { headersToText, textToHeaders } from '@shared/headerText'
import { Modal } from '../../components/ui'
import { sendToSelected, toast } from '../../lib/actions'
import { useSelectedDevice } from '../../store/appStore'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
const BODYLESS = new Set(['GET', 'HEAD'])

interface Props {
  initial: ResendRequest
  onClose: () => void
  /** Called with the result when the request was sent from the desktop. */
  onDesktopResult: (result: ReplayResult) => void
}

/** Edit a captured request, then send it from the device (captured normally) or the desktop. */
export function ResendModal({ initial, onClose, onDesktopResult }: Props) {
  const device = useSelectedDevice()
  const [method, setMethod] = useState(initial.method.toUpperCase())
  const [url, setUrl] = useState(initial.url)
  const [headersText, setHeadersText] = useState(headersToText(initial.headers))
  const [body, setBody] = useState(initial.body ?? '')
  const [busy, setBusy] = useState(false)

  const isHttpUrl = /^https?:\/\//i.test(url.trim())
  const build = (): ResendRequest => ({
    url: url.trim(),
    method,
    headers: textToHeaders(headersText),
    body: BODYLESS.has(method) ? undefined : body
  })

  const sendFromDevice = async (): Promise<void> => {
    setBusy(true)
    const ok = await sendToSelected({ type: 'network.resend', payload: build() })
    setBusy(false)
    if (!ok) return
    toast('success', 'Sent from the device. It appears in the request list.')
    onClose()
  }

  const sendFromDesktop = async (): Promise<void> => {
    setBusy(true)
    try {
      onDesktopResult(await window.loupe.replayRequest(build()))
      onClose()
    } catch (err) {
      toast('error', (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Edit & resend"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="faint" style={{ fontSize: 12, marginRight: 'auto' }}>
            Device requests go through the app&apos;s own networking, mocks and throttling.
          </span>
          <button className="btn" onClick={sendFromDesktop} disabled={busy || !isHttpUrl}>
            <Monitor size={13} /> Send from desktop
          </button>
          <button
            className="btn primary"
            onClick={sendFromDevice}
            disabled={busy || !isHttpUrl || !device?.connected}
            title={device?.connected ? undefined : 'No connected device'}
          >
            <Smartphone size={13} /> Send from device
          </button>
        </>
      }
    >
      <div className="row">
        <select className="select mono" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
          {METHODS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <input
          className="input mono grow"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          aria-label="URL"
          style={isHttpUrl ? undefined : { borderColor: 'var(--red)' }}
        />
      </div>
      <label className="field">
        <span>Headers</span>
        <textarea
          className="textarea"
          rows={6}
          value={headersText}
          onChange={(e) => setHeadersText(e.target.value)}
          spellCheck={false}
        />
      </label>
      <label className="field">
        <span>Body {BODYLESS.has(method) && <span className="faint">(not sent with {method})</span>}</span>
        <textarea
          className="textarea"
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          spellCheck={false}
          disabled={BODYLESS.has(method)}
        />
      </label>
      <div className="faint" style={{ fontSize: 12 }}>
        <Send size={11} /> Tip: edit an auth header or payload to test error handling without changing app code.
      </div>
    </Modal>
  )
}
