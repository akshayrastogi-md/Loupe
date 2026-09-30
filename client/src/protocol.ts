/**
 * Loupe wire protocol. This file is the single source of truth for messages
 * exchanged between the React Native client SDK and the desktop app.
 */

export const PROTOCOL_VERSION = 1
export const DEFAULT_PORT = 9393

export type Platform = 'ios' | 'android' | 'web' | 'unknown'

export interface DeviceInfo {
  appName: string
  platform: Platform
  osVersion?: string
  deviceName?: string
  rnVersion?: string
  sdkVersion?: string
  isEmulator?: boolean
  hermes?: boolean
  bundleUrl?: string
  screen?: { width: number; height: number; scale: number }
  protocolVersion?: number
}

export type HttpHeaders = Record<string, string>

export interface NetworkRequestPayload {
  id: string
  url: string
  method: string
  headers: HttpHeaders
  body?: string
  startedAt: number
  source: 'xhr' | 'fetch'
}

export interface NetworkResponsePayload {
  id: string
  status: number
  statusText: string
  headers: HttpHeaders
  body?: string
  bodySize: number
  truncated?: boolean
  endedAt: number
  mockedBy?: string
}

export interface NetworkErrorPayload {
  id: string
  message: string
  endedAt: number
  kind: 'error' | 'timeout' | 'abort' | 'offline'
}

export interface SocketOpenPayload {
  id: string
  url: string
  protocols?: string[]
  timestamp: number
}

export type SocketStatus = 'open' | 'closing' | 'closed' | 'error'

export interface SocketStatusPayload {
  id: string
  status: SocketStatus
  code?: number
  reason?: string
  timestamp: number
}

export interface SocketFramePayload {
  id: string
  direction: 'sent' | 'received'
  data: string
  binary: boolean
  size: number
  truncated?: boolean
  timestamp: number
}

export type LogLevel = 'debug' | 'log' | 'info' | 'warn' | 'error'

export interface ConsolePayload {
  level: LogLevel
  args: unknown[]
  timestamp: number
  tag?: string
}

export interface ErrorPayload {
  name: string
  message: string
  stack?: string
  componentStack?: string
  isFatal: boolean
  timestamp: number
}

export interface StateActionPayload {
  store: string
  action: unknown
  nextState: unknown
  durationMs?: number
  timestamp: number
}

export interface StateSnapshotPayload {
  store: string
  state: unknown
}

export interface StorageSnapshotPayload {
  entries: Array<[string, string | null]>
}

export interface PerfSamplePayload {
  timestamp: number
  fps: number
  jsLagMs: number
  memoryMb?: number
}

export type CommandArgType = 'string' | 'number' | 'boolean'

export interface CommandArg {
  name: string
  type: CommandArgType
}

export interface CommandDescriptor {
  id: string
  title: string
  description?: string
  args?: CommandArg[]
}

export interface CommandResultPayload {
  commandId: string
  runId: string
  ok: boolean
  result?: unknown
  error?: string
}

export type MockMatchType = 'contains' | 'exact' | 'regex'

export interface MockRule {
  id: string
  name: string
  enabled: boolean
  method: string // 'ANY' or an HTTP verb
  matchType: MockMatchType
  urlPattern: string
  status: number
  headers: HttpHeaders
  body: string
  delayMs: number
}

export interface NetworkConditions {
  offline: boolean
  latencyMs: number
}

/** A request the desktop asks the app to send through its own networking. */
export interface ResendRequest {
  url: string
  method: string
  headers: HttpHeaders
  body?: string
}

export type ClientMessage =
  | { type: 'hello'; payload: DeviceInfo }
  | { type: 'network.request'; payload: NetworkRequestPayload }
  | { type: 'network.response'; payload: NetworkResponsePayload }
  | { type: 'network.error'; payload: NetworkErrorPayload }
  | { type: 'ws.open'; payload: SocketOpenPayload }
  | { type: 'ws.status'; payload: SocketStatusPayload }
  | { type: 'ws.frame'; payload: SocketFramePayload }
  | { type: 'console'; payload: ConsolePayload }
  | { type: 'error'; payload: ErrorPayload }
  | { type: 'state.action'; payload: StateActionPayload }
  | { type: 'state.snapshot'; payload: StateSnapshotPayload }
  | { type: 'storage.snapshot'; payload: StorageSnapshotPayload }
  | { type: 'perf.sample'; payload: PerfSamplePayload }
  | { type: 'commands.register'; payload: { commands: CommandDescriptor[] } }
  | { type: 'command.result'; payload: CommandResultPayload }

export type ServerMessage =
  | { type: 'welcome'; payload: { deviceId: string; mocks: MockRule[]; conditions: NetworkConditions } }
  | { type: 'state.request'; payload: { store?: string } }
  | { type: 'state.dispatch'; payload: { store: string; action: unknown } }
  | { type: 'state.restore'; payload: { store: string; state: unknown } }
  | { type: 'storage.request'; payload: Record<string, never> }
  | { type: 'storage.set'; payload: { key: string; value: string } }
  | { type: 'storage.remove'; payload: { key: string } }
  | { type: 'storage.clear'; payload: Record<string, never> }
  | { type: 'mocks.update'; payload: { mocks: MockRule[] } }
  | { type: 'network.conditions'; payload: NetworkConditions }
  | { type: 'command.run'; payload: { commandId: string; runId: string; args: Record<string, unknown> } }
  | { type: 'network.resend'; payload: ResendRequest }
  | { type: 'ws.send'; payload: { id: string; data: string } }
  | { type: 'app.reload'; payload: Record<string, never> }
  | { type: 'app.devMenu'; payload: Record<string, never> }

export type ClientMessageType = ClientMessage['type']
export type ServerMessageType = ServerMessage['type']
