import { describe, expect, it } from 'vitest'
import { reduceHubEvents, type DevicesMap } from './deviceState'
import type { DeviceSummary, HubEvent } from '@shared/types'
import type { ClientMessage } from '@shared/protocol'

const summary = (id: string): DeviceSummary => ({
  id,
  info: { appName: 'App', platform: 'ios', deviceName: 'iPhone' },
  connectedAt: 1,
  remoteAddress: '127.0.0.1'
})

const msg = (deviceId: string, message: ClientMessage): HubEvent => ({
  kind: 'message',
  deviceId,
  message,
  receivedAt: 1
})

const request = (id: string): ClientMessage => ({
  type: 'network.request',
  payload: { id, url: `https://x/${id}`, method: 'GET', headers: {}, startedAt: 1, source: 'xhr' }
})

describe('reduceHubEvents', () => {
  it('adds devices and merges network request/response', () => {
    const { devices } = reduceHubEvents(
      {},
      [
        { kind: 'device.connected', device: summary('d1') },
        msg('d1', request('r1')),
        msg('d1', {
          type: 'network.response',
          payload: { id: 'r1', status: 200, statusText: 'OK', headers: {}, bodySize: 0, endedAt: 5 }
        }),
        msg('d1', { type: 'network.error', payload: { id: 'unknown', message: 'x', endedAt: 1, kind: 'error' } })
      ],
      100
    )
    const device = devices.d1
    expect(device.network.order).toEqual(['r1'])
    expect(device.network.byId.r1.response?.status).toBe(200)
  })

  it('does not mutate the previous state', () => {
    const first = reduceHubEvents({}, [{ kind: 'device.connected', device: summary('d1') }], 100).devices
    const frozen = JSON.stringify(first)
    const second = reduceHubEvents(
      first,
      [msg('d1', request('r1')), msg('d1', { type: 'console', payload: { level: 'log', args: [1], timestamp: 1 } })],
      100
    ).devices
    expect(JSON.stringify(first)).toBe(frozen)
    expect(second.d1).not.toBe(first.d1)
    expect(second.d1.logs).toHaveLength(1)
  })

  it('tracks logs, errors, state, storage, perf and commands', () => {
    const { devices } = reduceHubEvents(
      {},
      [
        { kind: 'device.connected', device: summary('d1') },
        msg('d1', { type: 'error', payload: { name: 'E', message: 'm', isFatal: false, timestamp: 1 } }),
        msg('d1', {
          type: 'state.action',
          payload: { store: 's', action: { type: 'a' }, nextState: { n: 1 }, timestamp: 1 }
        }),
        msg('d1', { type: 'state.snapshot', payload: { store: 't', state: { x: 1 } } }),
        msg('d1', { type: 'storage.snapshot', payload: { entries: [['k', 'v']] } }),
        msg('d1', { type: 'perf.sample', payload: { timestamp: 1, fps: 60, jsLagMs: 2 } }),
        msg('d1', { type: 'commands.register', payload: { commands: [{ id: 'c', title: 'C' }] } }),
        msg('d1', { type: 'command.result', payload: { commandId: 'c', runId: 'r', ok: true } })
      ],
      100
    )
    const d = devices.d1
    expect(d.errors).toHaveLength(1)
    expect(d.unseenErrors).toBe(1)
    expect(d.actions).toHaveLength(1)
    expect(d.stores).toEqual({ s: { n: 1 }, t: { x: 1 } })
    expect(d.storage).toEqual([['k', 'v']])
    expect(d.perf).toHaveLength(1)
    expect(d.commands).toHaveLength(1)
    expect(d.commandResults.r.ok).toBe(true)
  })

  it('caps collections to maxEntries', () => {
    const events: HubEvent[] = [{ kind: 'device.connected', device: summary('d1') }]
    for (let i = 0; i < 5; i++) {
      events.push(msg('d1', request(`r${i}`)))
      events.push(msg('d1', { type: 'console', payload: { level: 'log', args: [i], timestamp: i } }))
    }
    const d = reduceHubEvents({}, events, 3).devices.d1
    expect(d.network.order).toEqual(['r2', 'r3', 'r4'])
    expect(Object.keys(d.network.byId)).toHaveLength(3)
    expect(d.logs.map((l) => l.args[0])).toEqual([2, 3, 4])
  })

  it('carries history over when the same app reconnects', () => {
    let devices: DevicesMap = reduceHubEvents(
      {},
      [
        { kind: 'device.connected', device: summary('d1') },
        msg('d1', request('r1')),
        { kind: 'device.disconnected', deviceId: 'd1' }
      ],
      100
    ).devices
    expect(devices.d1.connected).toBe(false)
    const result = reduceHubEvents(devices, [{ kind: 'device.connected', device: summary('d2') }], 100)
    devices = result.devices
    expect(result.replaced).toEqual({ d1: 'd2' })
    expect(devices.d1).toBeUndefined()
    expect(devices.d2.network.order).toEqual(['r1'])
    expect(devices.d2.logs.at(-1)?.system).toBe(true)
  })

  it('ignores events for unknown devices', () => {
    expect(reduceHubEvents({}, [msg('nope', request('r'))], 10).devices).toEqual({})
  })
})
