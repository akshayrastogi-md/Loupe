import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { DeviceHub, isAllowedOrigin } from './hub'
import { parseClientMessage } from './validate'
import type { HubEvent } from '@shared/types'

const PORT = 19393

const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('parseClientMessage', () => {
  it('accepts valid messages and strips unknown fields', () => {
    const result = parseClientMessage(
      JSON.stringify({ type: 'hello', payload: { appName: 'A', platform: 'ios', evil: 'x' } })
    )
    expect(result).toEqual({ ok: true, message: { type: 'hello', payload: { appName: 'A', platform: 'ios' } } })
  })

  it('rejects bad JSON, unknown types and invalid payloads', () => {
    expect(parseClientMessage('{')).toEqual({ ok: false, reason: 'invalid JSON' })
    expect(parseClientMessage('{"type":"rm -rf","payload":{}}').ok).toBe(false)
    expect(parseClientMessage('null').ok).toBe(false)
    const bad = parseClientMessage(JSON.stringify({ type: 'perf.sample', payload: { fps: 'fast' } }))
    expect(bad.ok).toBe(false)
  })

  it('accepts responses without statusText (React Native omits it)', () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: 'network.response',
        payload: { id: 'r1', status: 200, headers: {}, bodySize: 0, endedAt: 1 }
      })
    )
    expect(result.ok && result.message.type === 'network.response' && result.message.payload.statusText).toBe('')
  })

  it('never throws on prototype keys used as message types or ids', () => {
    for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(parseClientMessage(JSON.stringify({ type, payload: {} })).ok).toBe(false)
    }
    const reserved = parseClientMessage(
      JSON.stringify({ type: 'state.snapshot', payload: { store: '__proto__', state: {} } })
    )
    expect(reserved.ok).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('accepts native clients and rejects browser pages', () => {
    expect(isAllowedOrigin(undefined, 'localhost:9393')).toBe(true)
    expect(isAllowedOrigin('http://localhost:9393', 'localhost:9393')).toBe(true)
    expect(isAllowedOrigin('https://evil.example', 'localhost:9393')).toBe(false)
    expect(isAllowedOrigin('null', 'localhost:9393')).toBe(false)
    expect(isAllowedOrigin('not a url', 'localhost:9393')).toBe(false)
  })
})

describe('DeviceHub', () => {
  let hub: DeviceHub | null = null
  let events: HubEvent[] = []

  const createHub = (): DeviceHub =>
    new DeviceHub({
      getWelcome: () => ({ mocks: [], conditions: { offline: false, latencyMs: 0 } }),
      onEvents: (batch) => {
        events = [...events, ...batch]
      },
      flushIntervalMs: 5,
      helloTimeoutMs: 100
    })

  afterEach(async () => {
    await hub?.stop()
    hub = null
    events = []
  })

  it('handshakes, forwards messages and reports disconnects', async () => {
    hub = createHub()
    const status = await hub.start(PORT, false)
    expect(status).toMatchObject({ listening: true, host: '127.0.0.1', port: PORT })

    const client = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const received: Array<{ type: string; payload: { deviceId?: string } }> = []
    client.on('message', (d) => received.push(JSON.parse(d.toString())))
    await new Promise((r) => client.once('open', r))

    client.send(JSON.stringify({ type: 'console', payload: { level: 'log', args: ['early'], timestamp: 1 } }))
    client.send(JSON.stringify({ type: 'hello', payload: { appName: 'Demo', platform: 'android' } }))
    client.send(JSON.stringify({ type: 'console', payload: { level: 'log', args: ['hi'], timestamp: 2 } }))
    client.send('garbage')

    await waitFor(() => events.length >= 2)
    expect(received[0].type).toBe('welcome')
    const connected = events.find((e) => e.kind === 'device.connected')
    expect(connected && connected.kind === 'device.connected' && connected.device.info.appName).toBe('Demo')
    const messages = events.filter((e) => e.kind === 'message')
    expect(messages).toHaveLength(1) // pre-handshake and garbage messages dropped

    const deviceId = hub.listDevices()[0].id
    expect(deviceId).toBe(received[0].payload.deviceId)
    expect(hub.send(deviceId, { type: 'app.reload', payload: {} })).toBe(true)
    expect(hub.send('missing', { type: 'app.reload', payload: {} })).toBe(false)
    await waitFor(() => received.length === 2)
    expect(received[1].type).toBe('app.reload')

    client.close()
    await waitFor(() => events.some((e) => e.kind === 'device.disconnected'))
    expect(hub.listDevices()).toHaveLength(0)
  })

  it('closes sockets that never say hello', async () => {
    hub = createHub()
    await hub.start(PORT, false)
    const client = new WebSocket(`ws://127.0.0.1:${PORT}`)
    const code = await new Promise<number>((resolve) => client.once('close', (c) => resolve(c)))
    expect(code).toBe(4000)
  })

  it('rejects connections from browser origins', async () => {
    hub = createHub()
    await hub.start(PORT, false)
    const client = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { origin: 'https://evil.example' } })
    const failed = await new Promise<boolean>((resolve) => {
      client.once('open', () => resolve(false))
      client.once('error', () => resolve(true))
    })
    expect(failed).toBe(true)
  })

  it('serializes concurrent restarts', async () => {
    hub = createHub()
    const [a, b] = await Promise.all([hub.start(PORT, false), hub.start(PORT, false)])
    expect(a.listening).toBe(true)
    expect(b.listening).toBe(true)
  })

  it('reports port conflicts', async () => {
    hub = createHub()
    await hub.start(PORT, false)
    const other = createHub()
    const status = await other.start(PORT, false)
    expect(status.listening).toBe(false)
    expect(status.error).toContain('already in use')
    await other.stop()
  })
})
