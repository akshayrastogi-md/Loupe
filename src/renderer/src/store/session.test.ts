import { describe, expect, it } from 'vitest'
import { reduceHubEvents } from './deviceState'
import { exportSession, importSession, SESSION_FORMAT } from './session'
import { REDACTED } from '@shared/redact'
import type { DeviceSummary, HubEvent } from '@shared/types'
import type { ClientMessage } from '@shared/protocol'

const summary: DeviceSummary = {
  id: 'd1',
  info: { appName: 'Shop', platform: 'ios' },
  connectedAt: 1,
  remoteAddress: '127.0.0.1'
}
const msg = (message: ClientMessage): HubEvent => ({ kind: 'message', deviceId: 'd1', message, receivedAt: 1 })

function capturedDevice() {
  return reduceHubEvents(
    {},
    [
      { kind: 'device.connected', device: summary },
      msg({
        type: 'network.request',
        payload: {
          id: 'r1',
          url: 'https://api/x?token=abc',
          method: 'POST',
          headers: { authorization: 'Bearer t' },
          body: '{"password":"p","name":"n"}',
          startedAt: 1,
          source: 'fetch'
        }
      }),
      msg({ type: 'console', payload: { level: 'log', args: ['hello'], timestamp: 2 } }),
      msg({ type: 'storage.snapshot', payload: { entries: [['token', 'secret']] } }),
      msg({ type: 'ws.open', payload: { id: 's1', url: 'wss://rt/socket?access_token=xyz', timestamp: 3 } })
    ],
    100
  ).devices.d1
}

describe('session export/import', () => {
  it('round-trips a capture as an offline, read-only device with a fresh id', () => {
    const device = capturedDevice()
    const result = importSession(exportSession(device, '0.2.0', false))
    if (!result.ok) throw new Error(result.error)
    expect(result.device.summary.id).not.toBe('d1')
    expect(result.device.summary.info.appName).toBe('Shop (imported)')
    expect(result.device.summary.remoteAddress).toBe('imported')
    expect(result.device.connected).toBe(false)
    expect(result.device.network.byId.r1.request.headers.authorization).toBe('Bearer t')
    expect(result.device.logs[0].args).toEqual(['hello'])
    expect(result.device.storage).toEqual([['token', 'secret']])
    expect(result.meta.redacted).toBe(false)
  })

  it('hides secrets when redacting and leaves out AsyncStorage', () => {
    const result = importSession(exportSession(capturedDevice(), '0.2.0', true))
    if (!result.ok) throw new Error(result.error)
    const request = result.device.network.byId.r1.request
    expect(request.headers.authorization).toBe(REDACTED)
    expect(request.url).toContain(encodeURIComponent(REDACTED))
    expect(JSON.parse(request.body as string)).toEqual({ password: REDACTED, name: 'n' })
    expect(result.device.sockets.byId.s1.url).not.toContain('xyz')
    expect(result.device.storage).toBeNull()
    expect(result.meta.redacted).toBe(true)
  })

  it('gives each import a distinct id', () => {
    const text = exportSession(capturedDevice(), '0.2.0', true)
    const a = importSession(text)
    const b = importSession(text)
    expect(a.ok && b.ok && a.device.summary.id !== b.device.summary.id).toBe(true)
  })

  it('rejects invalid and foreign files', () => {
    expect(importSession('not json')).toEqual({ ok: false, error: 'Not a Loupe session file (invalid JSON)' })
    expect(importSession(JSON.stringify({ log: { version: '1.2' } })).ok).toBe(false)
    const tampered = JSON.parse(exportSession(capturedDevice(), '0.2.0', true))
    tampered.device.logs = 'nope'
    const result = importSession(JSON.stringify(tampered))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('device.logs')
    expect(importSession(JSON.stringify({ ...tampered, format: SESSION_FORMAT, version: 99 })).ok).toBe(false)
  })
})
