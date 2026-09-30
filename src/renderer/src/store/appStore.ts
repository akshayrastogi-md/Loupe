import { create } from 'zustand'
import type { MockRule, NetworkConditions } from '@shared/protocol'
import { DEFAULT_SETTINGS, type AppSettings, type HubEvent, type ServerStatus } from '@shared/types'
import { createDeviceState, reduceHubEvents, type DeviceState, type DevicesMap } from './deviceState'

export type PanelId =
  'network' | 'console' | 'state' | 'queries' | 'storage' | 'performance' | 'errors' | 'mocks' | 'device'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}

interface AppState {
  ready: boolean
  appVersion: string
  devices: DevicesMap
  selectedDeviceId: string | null
  panel: PanelId
  settings: AppSettings
  status: ServerStatus
  mocks: MockRule[]
  conditions: NetworkConditions
  settingsOpen: boolean
  toasts: Toast[]
  paused: boolean

  initialize(input: {
    appVersion: string
    settings: AppSettings
    status: ServerStatus
    mocks: MockRule[]
    conditions: NetworkConditions
    devices: DevicesMap
  }): void
  applyHubEvents(events: HubEvent[]): void
  setStatus(status: ServerStatus): void
  setSettings(settings: AppSettings): void
  setMocks(mocks: MockRule[]): void
  setConditions(conditions: NetworkConditions): void
  selectDevice(id: string | null): void
  setPanel(panel: PanelId): void
  setSettingsOpen(open: boolean): void
  setPaused(paused: boolean): void
  updateDevice(id: string, update: (device: DeviceState) => DeviceState): void
  removeDevice(id: string): void
  addDevice(device: DeviceState): void
  pushToast(kind: Toast['kind'], message: string): void
  dismissToast(id: number): void
}

let toastSeq = 0
const TOAST_TTL_MS = 3500

function pickSelected(devices: DevicesMap, current: string | null): string | null {
  if (current && devices[current]) return current
  const list = Object.values(devices)
  const connected = list.filter((d) => d.connected)
  const candidate = (connected.length ? connected : list).sort(
    (a, b) => b.summary.connectedAt - a.summary.connectedAt
  )[0]
  return candidate?.summary.id ?? null
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  appVersion: '',
  devices: {},
  selectedDeviceId: null,
  panel: 'network',
  settings: DEFAULT_SETTINGS,
  status: { listening: false, port: DEFAULT_SETTINGS.port, host: '', addresses: [] },
  mocks: [],
  conditions: { offline: false, latencyMs: 0 },
  settingsOpen: false,
  toasts: [],
  paused: false,

  initialize: (input) => set({ ...input, ready: true, selectedDeviceId: pickSelected(input.devices, null) }),

  applyHubEvents: (events) => {
    const { devices, selectedDeviceId, settings, paused } = get()
    // While paused, keep connection bookkeeping but drop captured traffic.
    const relevant = paused ? events.filter((e) => e.kind !== 'message') : events
    if (!relevant.length) return
    const result = reduceHubEvents(devices, relevant, settings.maxEntries)
    const redirected = selectedDeviceId ? (result.replaced[selectedDeviceId] ?? selectedDeviceId) : null
    set({ devices: result.devices, selectedDeviceId: pickSelected(result.devices, redirected) })
  },

  setStatus: (status) => set({ status }),
  setSettings: (settings) => set({ settings }),
  setMocks: (mocks) => set({ mocks }),
  setConditions: (conditions) => set({ conditions }),
  selectDevice: (id) => set({ selectedDeviceId: id }),
  setPanel: (panel) => {
    set({ panel })
    const id = get().selectedDeviceId
    if (panel === 'errors' && id) get().updateDevice(id, (d) => ({ ...d, unseenErrors: 0 }))
  },
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setPaused: (paused) => set({ paused }),

  updateDevice: (id, update) => {
    const device = get().devices[id]
    if (!device) return
    set({ devices: { ...get().devices, [id]: update(device) } })
  },

  addDevice: (device) =>
    set({ devices: { ...get().devices, [device.summary.id]: device }, selectedDeviceId: device.summary.id }),

  removeDevice: (id) => {
    const devices = Object.fromEntries(Object.entries(get().devices).filter(([key]) => key !== id))
    set({ devices, selectedDeviceId: pickSelected(devices, get().selectedDeviceId) })
  },

  pushToast: (kind, message) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, kind, message }] })
    setTimeout(() => get().dismissToast(id), TOAST_TTL_MS)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

export const useSelectedDevice = (): DeviceState | null =>
  useAppStore((s) => (s.selectedDeviceId ? (s.devices[s.selectedDeviceId] ?? null) : null))

export { createDeviceState }
