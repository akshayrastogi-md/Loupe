import type { ClientMessage, HttpHeaders, MockRule, NetworkConditions, NetworkErrorPayload } from './protocol'
import { findMock } from './mocks'
import { normalizeHeaders, parseRawHeaders, serializeHeaders } from './headers'
import { clampBody, describeBody, MAX_BODY_BYTES } from './serialize'

export interface NetworkContext {
  send(message: ClientMessage): void
  getMocks(): readonly MockRule[]
  getConditions(): NetworkConditions
  nextId(): string
  /** URLs matching these substrings are never captured (e.g. Metro, symbolication). */
  ignoreUrls: readonly string[]
}

interface RequestMeta {
  id: string
  method: string
  url: string
  headers: HttpHeaders
  startedAt: number
  settled: boolean
  mocked: boolean
  aborted: boolean
}

type AnyXHR = XMLHttpRequest & { [META]?: RequestMeta }
const META = Symbol.for('prism.xhr.meta')

/**
 * Set only while the original fetch() runs synchronously. An XHR opened in that
 * window means fetch is the XHR-based polyfill (classic RN), so the XHR patch
 * captures it; otherwise fetch is native (newer RN/Expo) and is captured here.
 */
let fetchProbe: { usedXhr: boolean } | null = null

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
const TEXTUAL_TYPE = /json|text|xml|javascript|x-www-form-urlencoded|graphql/i

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

const shouldIgnore = (ctx: NetworkContext, url: string): boolean => ctx.ignoreUrls.some((p) => url.includes(p))

function reportRequest(ctx: NetworkContext, meta: RequestMeta, body: unknown, source: 'xhr' | 'fetch'): void {
  const described = describeBody(body)
  ctx.send({
    type: 'network.request',
    payload: {
      id: meta.id,
      url: meta.url,
      method: meta.method,
      headers: meta.headers,
      body: described === undefined ? undefined : clampBody(described).body,
      startedAt: meta.startedAt,
      source
    }
  })
}

function reportResponse(
  ctx: NetworkContext,
  id: string,
  res: { status: number; statusText: string; headers: HttpHeaders; body?: string; mockedBy?: string }
): void {
  const clamped = res.body === undefined ? undefined : clampBody(res.body)
  const lengthHeader = Number(res.headers['content-length'])
  ctx.send({
    type: 'network.response',
    payload: {
      id,
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      body: clamped?.body,
      truncated: clamped?.truncated,
      bodySize: Number.isFinite(lengthHeader) && lengthHeader > 0 ? lengthHeader : (res.body?.length ?? 0),
      endedAt: Date.now(),
      mockedBy: res.mockedBy
    }
  })
}

function reportError(ctx: NetworkContext, id: string, kind: NetworkErrorPayload['kind'], message: string): void {
  ctx.send({ type: 'network.error', payload: { id, kind, message, endedAt: Date.now() } })
}

function readXhrBody(xhr: XMLHttpRequest, headers: HttpHeaders): Promise<string | undefined> {
  const type = xhr.responseType
  if (type === '' || type === 'text') return Promise.resolve(xhr.responseText)
  if (type === 'json') return Promise.resolve(JSON.stringify(xhr.response))
  if (type === 'arraybuffer') return Promise.resolve('[Binary data]')
  const response = xhr.response as Blob | null
  if (type !== 'blob' || !response) return Promise.resolve(undefined)
  // RN's fetch uses blob responses for everything; only decode small textual ones.
  if (!TEXTUAL_TYPE.test(headers['content-type'] ?? '') || (response.size ?? 0) > MAX_BODY_BYTES) {
    return Promise.resolve('[Binary data]')
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.readAsText(response)
    })
  }
  return Promise.resolve(undefined)
}

function fireXhrEvent(xhr: XMLHttpRequest, type: string): void {
  const target = xhr as unknown as { dispatchEvent?: (e: unknown) => void } & Record<string, unknown>
  if (typeof target.dispatchEvent === 'function') {
    const event = typeof Event === 'function' ? new Event(type) : { type }
    target.dispatchEvent(event)
    return
  }
  const handler = target[`on${type}`]
  if (typeof handler === 'function') handler.call(xhr, { type })
}

function mockResponseValue(xhr: XMLHttpRequest, body: string): unknown {
  if (xhr.responseType === 'json') {
    try {
      return JSON.parse(body)
    } catch {
      return null
    }
  }
  if (xhr.responseType === 'blob' && typeof Blob !== 'undefined') return new Blob([body])
  return body
}

/** Make an XHR instance look like it received `rule`'s response. */
function fulfillXhrWithMock(xhr: XMLHttpRequest, rule: MockRule, url: string): void {
  const headers = normalizeHeaders(rule.headers)
  const define = (key: string, value: unknown): void => {
    // Writable so RN's XMLHttpRequest can still reset these on abort()/open().
    Object.defineProperty(xhr, key, { configurable: true, writable: true, value })
  }
  define('readyState', 4)
  define('status', rule.status)
  define('statusText', rule.status >= 400 ? 'Mocked Error' : 'OK')
  define('responseText', rule.body)
  define('response', mockResponseValue(xhr, rule.body))
  define('responseURL', url)
  Object.defineProperty(xhr, 'getAllResponseHeaders', { configurable: true, value: () => serializeHeaders(headers) })
  Object.defineProperty(xhr, 'getResponseHeader', {
    configurable: true,
    value: (name: string) => headers[name.toLowerCase()] ?? null
  })
  ;['readystatechange', 'load', 'loadend'].forEach((type) => fireXhrEvent(xhr, type))
}

function attachXhrListeners(ctx: NetworkContext, xhr: AnyXHR, meta: RequestMeta): void {
  const settle = (): boolean => {
    if (meta.settled || meta.mocked) return false
    meta.settled = true
    return true
  }
  xhr.addEventListener('load', () => {
    if (!settle()) return
    const status = xhr.status
    // React Native's XMLHttpRequest does not implement statusText.
    const statusText = typeof xhr.statusText === 'string' ? xhr.statusText : ''
    const headers = parseRawHeaders(xhr.getAllResponseHeaders())
    readXhrBody(xhr, headers)
      .catch(() => undefined)
      .then((body) => reportResponse(ctx, meta.id, { status, statusText, headers, body }))
  })
  xhr.addEventListener('error', () => settle() && reportError(ctx, meta.id, 'error', 'Network request failed'))
  xhr.addEventListener('timeout', () => settle() && reportError(ctx, meta.id, 'timeout', 'Request timed out'))
  xhr.addEventListener('abort', () => {
    meta.aborted = true
    if (settle()) reportError(ctx, meta.id, 'abort', 'Request aborted')
  })
}

function patchXhr(ctx: NetworkContext): () => void {
  const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest
  if (!XHR) return () => undefined
  const proto = XHR.prototype
  const originalOpen = proto.open
  const originalSend = proto.send
  const originalSetHeader = proto.setRequestHeader

  proto.open = function open(this: AnyXHR, method: string, url: string | URL, ...rest: unknown[]) {
    if (fetchProbe) fetchProbe.usedXhr = true
    const urlString = String(url)
    this[META] = shouldIgnore(ctx, urlString)
      ? undefined
      : {
          id: ctx.nextId(),
          method: String(method).toUpperCase(),
          url: urlString,
          headers: {},
          startedAt: 0,
          settled: false,
          mocked: false,
          aborted: false
        }
    return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof proto.open

  proto.setRequestHeader = function setRequestHeader(this: AnyXHR, name: string, value: string) {
    const meta = this[META]
    if (meta) meta.headers = { ...meta.headers, [name.toLowerCase()]: String(value) }
    return originalSetHeader.call(this, name, value)
  }

  proto.send = function send(this: AnyXHR, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this[META]
    if (!meta) return originalSend.call(this, body)
    meta.startedAt = Date.now()
    reportRequest(ctx, meta, body, 'xhr')
    attachXhrListeners(ctx, this, meta)

    const { offline, latencyMs } = ctx.getConditions()
    if (offline) {
      meta.settled = true
      reportError(ctx, meta.id, 'offline', 'Network request failed (offline simulation)')
      setTimeout(() => {
        Object.defineProperty(this, 'readyState', { configurable: true, writable: true, value: 4 })
        ;['readystatechange', 'error', 'loadend'].forEach((type) => fireXhrEvent(this, type))
      }, 0)
      return
    }

    const rule = findMock(ctx.getMocks(), meta.method, meta.url)
    if (rule) {
      meta.mocked = true
      void sleep(rule.delayMs + latencyMs).then(() => {
        if (meta.aborted) {
          reportError(ctx, meta.id, 'abort', 'Request aborted')
          return
        }
        reportResponse(ctx, meta.id, {
          status: rule.status,
          statusText: 'Mocked',
          headers: normalizeHeaders(rule.headers),
          body: rule.body,
          mockedBy: rule.name || rule.id
        })
        fulfillXhrWithMock(this, rule, meta.url)
      })
      return
    }

    if (latencyMs > 0) {
      setTimeout(() => {
        if (meta.aborted) return
        try {
          originalSend.call(this, body)
        } catch (err) {
          // Never let a deferred send throw from a timer inside the host app.
          meta.settled = true
          reportError(ctx, meta.id, 'error', String((err as Error)?.message ?? err))
          fireXhrEvent(this, 'error')
        }
      }, latencyMs)
      return
    }
    return originalSend.call(this, body)
  }

  return () => {
    proto.open = originalOpen
    proto.send = originalSend
    proto.setRequestHeader = originalSetHeader
  }
}

async function readFetchBody(res: Response): Promise<string | undefined> {
  const type = res.headers.get('content-type') ?? ''
  const length = Number(res.headers.get('content-length'))
  if (!TEXTUAL_TYPE.test(type) || (Number.isFinite(length) && length > MAX_BODY_BYTES)) {
    return type ? '[Binary data]' : undefined
  }
  try {
    return await res.clone().text()
  } catch {
    return undefined
  }
}

/** Capture a request made by a native (non-XHR) fetch implementation. */
function captureNativeFetch(
  ctx: NetworkContext,
  meta: RequestMeta,
  body: unknown,
  pending: Promise<Response>
): Promise<Response> {
  reportRequest(ctx, meta, body, 'fetch')
  return pending.then(
    (res) => {
      const headers = normalizeHeaders(res.headers)
      readFetchBody(res)
        .catch(() => undefined)
        .then((text) =>
          reportResponse(ctx, meta.id, { status: res.status, statusText: res.statusText ?? '', headers, body: text })
        )
      return res
    },
    (err: unknown) => {
      const aborted = (err as { name?: string })?.name === 'AbortError'
      reportError(ctx, meta.id, aborted ? 'abort' : 'error', String((err as Error)?.message ?? err))
      throw err
    }
  )
}

/**
 * Mocked and offline requests are answered here without touching the network.
 * Everything else goes to the original fetch; if that fetch is XHR-based the
 * XHR patch records it, otherwise it is captured as a native fetch.
 */
function patchFetch(ctx: NetworkContext): () => void {
  const g = globalThis as { fetch?: typeof fetch }
  const originalFetch = g.fetch
  if (!originalFetch) return () => undefined
  let fetchUsesXhr: boolean | undefined

  g.fetch = async function prismFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input as { url?: string; method?: string; headers?: unknown; signal?: AbortSignal }
    const url = typeof input === 'string' ? input : (request.url ?? String(input))
    if (shouldIgnore(ctx, url)) return originalFetch(input, init)
    const method = String(init?.method ?? request.method ?? 'GET').toUpperCase()
    const { offline, latencyMs } = ctx.getConditions()
    const rule = offline ? undefined : findMock(ctx.getMocks(), method, url)
    const meta: RequestMeta = {
      id: ctx.nextId(),
      method,
      url,
      headers: normalizeHeaders(init?.headers ?? request.headers),
      startedAt: Date.now(),
      settled: true,
      mocked: Boolean(rule),
      aborted: false
    }

    if (!offline && !rule) {
      // XHR-based fetch already applies latency in the XHR patch.
      if (latencyMs > 0 && fetchUsesXhr === false) await sleep(latencyMs)
      const probe = { usedXhr: false }
      fetchProbe = probe
      let pending: Promise<Response>
      try {
        pending = originalFetch(input, init)
      } finally {
        fetchProbe = null
      }
      fetchUsesXhr = probe.usedXhr
      if (probe.usedXhr) return pending
      meta.startedAt = Date.now()
      return captureNativeFetch(ctx, meta, init?.body, pending)
    }
    reportRequest(ctx, meta, init?.body, 'fetch')

    if (!rule) {
      reportError(ctx, meta.id, 'offline', 'Network request failed (offline simulation)')
      throw new TypeError('Network request failed')
    }
    const signal = init?.signal ?? request.signal
    await sleep(rule.delayMs + latencyMs)
    if (signal?.aborted) {
      reportError(ctx, meta.id, 'abort', 'Request aborted')
      throw abortError()
    }
    const headers = normalizeHeaders(rule.headers)
    reportResponse(ctx, meta.id, {
      status: rule.status,
      statusText: 'Mocked',
      headers,
      body: rule.body,
      mockedBy: rule.name || rule.id
    })
    const nullBody = NULL_BODY_STATUSES.has(rule.status)
    return new Response(nullBody ? null : rule.body, { status: rule.status, headers })
  } as typeof fetch

  return () => {
    g.fetch = originalFetch
  }
}

export function installNetwork(ctx: NetworkContext): () => void {
  const restoreXhr = patchXhr(ctx)
  const restoreFetch = patchFetch(ctx)
  return () => {
    restoreFetch()
    restoreXhr()
  }
}
