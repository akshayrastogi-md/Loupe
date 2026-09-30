/* Test doubles shared by SDK tests. Not exported from the package entry. */
import type { WebSocketLike } from './transport'

export class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: string[] = []
  onopen: ((ev?: unknown) => void) | null = null
  onclose: ((ev?: unknown) => void) | null = null
  onerror: ((ev?: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  open(): void {
    this.readyState = 1
    this.onopen?.()
  }

  send(data: string): void {
    this.sent.push(data)
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  close(): void {
    this.readyState = 3
    this.onclose?.()
  }

  messages<T = { type: string; payload: Record<string, unknown> }>(): T[] {
    return this.sent.map((s) => JSON.parse(s) as T)
  }
}

type Listener = (ev: { type: string }) => void

/** Minimal XMLHttpRequest emulation with EventTarget semantics. */
export class FakeXHR {
  static nextResponse: { status: number; body: string; headers: string } = { status: 200, body: '', headers: '' }
  static sendCount = 0
  readyState = 0
  status = 0
  statusText = ''
  responseText = ''
  responseType = ''
  response: unknown = ''
  onload: Listener | null = null
  private listeners = new Map<string, Listener[]>()
  private rawHeaders = ''

  open(): void {
    this.readyState = 1
  }

  setRequestHeader(): void {}

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }

  dispatchEvent(ev: { type: string }): void {
    ;(this.listeners.get(ev.type) ?? []).forEach((fn) => fn(ev))
    const attr = (this as unknown as Record<string, unknown>)[`on${ev.type}`]
    if (typeof attr === 'function') (attr as Listener)(ev)
  }

  getAllResponseHeaders(): string {
    return this.rawHeaders
  }

  send(): void {
    FakeXHR.sendCount += 1
    const { status, body, headers } = FakeXHR.nextResponse
    setTimeout(() => {
      this.readyState = 4
      this.status = status
      this.statusText = 'OK'
      this.responseText = body
      this.response = body
      this.rawHeaders = headers
      this.dispatchEvent({ type: 'load' })
    }, 0)
  }
}

export const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
