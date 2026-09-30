import type {
  CommandDescriptor,
  CommandResultPayload,
  ConsolePayload,
  ErrorPayload,
  PerfSamplePayload,
  QuerySnapshotPayload,
  SocketFramePayload,
  SocketStatus,
  StateActionPayload
} from '@shared/protocol'
import type { NetworkEntry } from '@shared/network'
import type { DeviceSummary, HubEvent } from '@shared/types'

export const MAX_PERF_SAMPLES = 300
export const MAX_COMMAND_RESULTS = 100
export const MAX_SOCKETS = 200
export const MAX_FRAMES_PER_SOCKET = 2000

export interface SocketFrame extends Omit<SocketFramePayload, 'id'> {
  seq: number
}

export interface SocketEntry {
  id: string
  url: string
  protocols?: string[]
  openedAt: number
  status: 'connecting' | SocketStatus
  closedAt?: number
  code?: number
  reason?: string
  frames: SocketFrame[]
  /** Frames dropped because the per-socket cap was reached. */
  droppedFrames: number
}

export interface LogEntry extends ConsolePayload {
  id: string
  /** Synthetic entries inserted by Loupe itself (e.g. "App reloaded"). */
  system?: boolean
}
export interface ErrorEntry extends ErrorPayload {
  id: string
}
export interface ActionEntry extends StateActionPayload {
  id: string
}

export interface DeviceState {
  summary: DeviceSummary
  connected: boolean
  disconnectedAt?: number
  network: { order: string[]; byId: Record<string, NetworkEntry> }
  sockets: { order: string[]; byId: Record<string, SocketEntry> }
  /** Latest TanStack Query cache snapshot per tracked client. */
  queries: Record<string, QuerySnapshotPayload>
  logs: LogEntry[]
  errors: ErrorEntry[]
  actions: ActionEntry[]
  stores: Record<string, unknown>
  storage: Array<[string, string | null]> | null
  perf: PerfSamplePayload[]
  commands: CommandDescriptor[]
  commandResults: Record<string, CommandResultPayload>
  unseenErrors: number
}

export type DevicesMap = Record<string, DeviceState>

let seq = 0
const nextId = (): string => `${Date.now().toString(36)}-${(seq++).toString(36)}`

export function createDeviceState(summary: DeviceSummary): DeviceState {
  return {
    summary,
    connected: true,
    network: { order: [], byId: {} },
    sockets: { order: [], byId: {} },
    queries: {},
    logs: [],
    errors: [],
    actions: [],
    stores: {},
    storage: null,
    perf: [],
    commands: [],
    commandResults: {},
    unseenErrors: 0
  }
}

/** Identity used to carry history across app reloads (each reload is a new connection). */
export const deviceIdentity = (s: DeviceSummary): string =>
  [s.info.appName, s.info.platform, s.info.deviceName ?? '', s.remoteAddress].join('|')

const capTail = <T>(items: T[], max: number): T[] => (items.length > max ? items.slice(items.length - max) : items)

function capNetwork(network: DeviceState['network'], max: number): DeviceState['network'] {
  if (network.order.length <= max) return network
  const dropped = network.order.slice(0, network.order.length - max)
  const byId = { ...network.byId }
  dropped.forEach((id) => delete byId[id])
  return { order: network.order.slice(-max), byId }
}

/** Mutable working copy used only inside a single reducer pass. */
interface Draft {
  device: DeviceState
  touched: Set<keyof DeviceState>
}

function touch<K extends keyof DeviceState>(draft: Draft, key: K): DeviceState[K] {
  if (!draft.touched.has(key)) {
    const value = draft.device[key]
    draft.device[key] = (Array.isArray(value) ? [...value] : { ...(value as object) }) as DeviceState[K]
    draft.touched.add(key)
  }
  return draft.device[key]
}

function applyMessage(draft: Draft, event: Extract<HubEvent, { kind: 'message' }>): void {
  const { message } = event
  switch (message.type) {
    case 'network.request': {
      const network = touch(draft, 'network')
      const { id } = message.payload
      if (!Object.hasOwn(network.byId, id)) network.order = [...network.order, id]
      network.byId = { ...network.byId, [id]: { id, request: message.payload } }
      return
    }
    case 'network.response':
    case 'network.error': {
      const network = touch(draft, 'network')
      const existing = Object.hasOwn(network.byId, message.payload.id) ? network.byId[message.payload.id] : undefined
      if (!existing) return
      const patch = message.type === 'network.response' ? { response: message.payload } : { error: message.payload }
      network.byId = { ...network.byId, [existing.id]: { ...existing, ...patch } }
      return
    }
    case 'ws.open': {
      const sockets = touch(draft, 'sockets')
      const { id, url, protocols, timestamp } = message.payload
      if (!Object.hasOwn(sockets.byId, id)) sockets.order = [...sockets.order, id]
      sockets.byId = {
        ...sockets.byId,
        [id]: { id, url, protocols, openedAt: timestamp, status: 'connecting', frames: [], droppedFrames: 0 }
      }
      return
    }
    case 'ws.status': {
      const sockets = touch(draft, 'sockets')
      const { id, status, code, reason, timestamp } = message.payload
      const existing = Object.hasOwn(sockets.byId, id) ? sockets.byId[id] : undefined
      if (!existing) return
      const closed = status === 'closed'
      sockets.byId = {
        ...sockets.byId,
        [id]: { ...existing, status, ...(closed ? { closedAt: timestamp, code, reason } : {}) }
      }
      return
    }
    case 'ws.frame': {
      const sockets = touch(draft, 'sockets')
      const { id, ...frame } = message.payload
      const existing = Object.hasOwn(sockets.byId, id) ? sockets.byId[id] : undefined
      if (!existing) return
      const seq = existing.frames.length + existing.droppedFrames
      const frames = [...existing.frames, { ...frame, seq }]
      const overflow = frames.length - MAX_FRAMES_PER_SOCKET
      sockets.byId = {
        ...sockets.byId,
        [id]: {
          ...existing,
          frames: overflow > 0 ? frames.slice(overflow) : frames,
          droppedFrames: existing.droppedFrames + Math.max(0, overflow)
        }
      }
      return
    }
    case 'query.snapshot':
      draft.device.queries = { ...draft.device.queries, [message.payload.client]: message.payload }
      return
    case 'console':
      ;(touch(draft, 'logs') as LogEntry[]).push({ ...message.payload, id: nextId() })
      return
    case 'error':
      ;(touch(draft, 'errors') as ErrorEntry[]).push({ ...message.payload, id: nextId() })
      draft.device.unseenErrors += 1
      return
    case 'state.action':
      ;(touch(draft, 'actions') as ActionEntry[]).push({ ...message.payload, id: nextId() })
      ;(touch(draft, 'stores') as Record<string, unknown>)[message.payload.store] = message.payload.nextState
      return
    case 'state.snapshot':
      ;(touch(draft, 'stores') as Record<string, unknown>)[message.payload.store] = message.payload.state
      return
    case 'storage.snapshot':
      draft.device.storage = message.payload.entries
      return
    case 'perf.sample':
      ;(touch(draft, 'perf') as PerfSamplePayload[]).push(message.payload)
      return
    case 'commands.register':
      draft.device.commands = message.payload.commands
      return
    case 'command.result':
      ;(touch(draft, 'commandResults') as Record<string, CommandResultPayload>)[message.payload.runId] = message.payload
      return
    case 'hello':
      return
  }
}

function carryOverHistory(previous: DeviceState, next: DeviceState): DeviceState {
  const divider: LogEntry = {
    id: nextId(),
    level: 'info',
    args: ['App reloaded, new session started'],
    timestamp: next.summary.connectedAt,
    system: true
  }
  return {
    ...next,
    network: previous.network,
    sockets: previous.sockets,
    logs: [...previous.logs, divider],
    errors: previous.errors,
    actions: previous.actions,
    perf: previous.perf,
    unseenErrors: previous.unseenErrors
  }
}

export interface ReduceResult {
  devices: DevicesMap
  /** Device ids replaced by a reconnecting session: old id → new id. */
  replaced: Record<string, string>
}

/** Pure reducer: fold a batch of hub events into the devices map. */
export function reduceHubEvents(devices: DevicesMap, events: readonly HubEvent[], maxEntries: number): ReduceResult {
  const next: DevicesMap = { ...devices }
  const drafts = new Map<string, Draft>()
  const replaced: Record<string, string> = {}

  const draftFor = (id: string): Draft | undefined => {
    const existing = drafts.get(id)
    if (existing) return existing
    const device = next[id]
    if (!device) return undefined
    const draft: Draft = { device: { ...device }, touched: new Set() }
    drafts.set(id, draft)
    next[id] = draft.device
    return draft
  }

  for (const event of events) {
    if (event.kind === 'device.connected') {
      const identity = deviceIdentity(event.device)
      const previous = Object.values(next).find((d) => !d.connected && deviceIdentity(d.summary) === identity)
      let fresh = createDeviceState(event.device)
      if (previous) {
        fresh = carryOverHistory(previous, fresh)
        delete next[previous.summary.id]
        drafts.delete(previous.summary.id)
        replaced[previous.summary.id] = event.device.id
      }
      next[event.device.id] = fresh
      continue
    }
    const draft = draftFor(event.deviceId)
    if (!draft) continue
    if (event.kind === 'device.disconnected') {
      draft.device.connected = false
      draft.device.disconnectedAt = Date.now()
      continue
    }
    applyMessage(draft, event)
  }

  drafts.forEach((draft) => {
    const d = draft.device
    if (draft.touched.has('network')) d.network = capNetwork(d.network, maxEntries)
    if (draft.touched.has('sockets') && d.sockets.order.length > MAX_SOCKETS) {
      const dropped = d.sockets.order.slice(0, d.sockets.order.length - MAX_SOCKETS)
      const byId = { ...d.sockets.byId }
      dropped.forEach((id) => delete byId[id])
      d.sockets = { order: d.sockets.order.slice(-MAX_SOCKETS), byId }
    }
    if (draft.touched.has('logs')) d.logs = capTail(d.logs, maxEntries)
    if (draft.touched.has('errors')) d.errors = capTail(d.errors, maxEntries)
    if (draft.touched.has('actions')) d.actions = capTail(d.actions, maxEntries)
    if (draft.touched.has('perf')) d.perf = capTail(d.perf, MAX_PERF_SAMPLES)
    if (draft.touched.has('commandResults')) {
      const entries = Object.entries(d.commandResults)
      if (entries.length > MAX_COMMAND_RESULTS)
        d.commandResults = Object.fromEntries(entries.slice(-MAX_COMMAND_RESULTS))
    }
  })

  return { devices: next, replaced }
}
