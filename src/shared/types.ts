import type {
  ClientMessage,
  CommandDescriptor,
  DeviceInfo,
  HttpHeaders,
  MockRule,
  NetworkConditions,
  ServerMessage
} from './protocol'

export interface AppSettings {
  port: number
  allowLan: boolean
  theme: 'dark' | 'light' | 'system'
  maxEntries: number
  metroPort: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  port: 9393,
  allowLan: false,
  theme: 'dark',
  maxEntries: 5000,
  metroPort: 8081
}

export interface ServerStatus {
  listening: boolean
  port: number
  host: string
  addresses: string[]
  error?: string
}

export interface DeviceSummary {
  id: string
  info: DeviceInfo
  connectedAt: number
  remoteAddress: string
}

/** Events pushed from the main process to the renderer. */
export type HubEvent =
  | { kind: 'device.connected'; device: DeviceSummary }
  | { kind: 'device.disconnected'; deviceId: string }
  | { kind: 'message'; deviceId: string; message: ClientMessage; receivedAt: number }

export interface ReplayRequest {
  url: string
  method: string
  headers: HttpHeaders
  body?: string
}

export interface ReplayResult {
  ok: boolean
  status?: number
  statusText?: string
  headers?: HttpHeaders
  body?: string
  durationMs: number
  error?: string
}

export interface StackFrame {
  methodName: string
  file: string
  lineNumber: number | null
  column: number | null
}

export interface CommandResult {
  ok: boolean
  output?: string
  error?: string
}

export interface PersistedState {
  settings: AppSettings
  mocks: MockRule[]
  conditions: NetworkConditions
}

/** The API exposed to the renderer through the preload bridge. */
export interface LoupeBridge {
  platform: string
  getInitialState(): Promise<PersistedState & { status: ServerStatus; devices: DeviceSummary[]; appVersion: string }>
  onHubEvents(listener: (events: HubEvent[]) => void): () => void
  onServerStatus(listener: (status: ServerStatus) => void): () => void
  sendToDevice(deviceId: string, message: ServerMessage): Promise<boolean>
  updateSettings(settings: AppSettings): Promise<ServerStatus>
  updateMocks(mocks: MockRule[]): Promise<void>
  updateConditions(conditions: NetworkConditions): Promise<void>
  replayRequest(request: ReplayRequest): Promise<ReplayResult>
  saveFile(defaultName: string, content: string): Promise<boolean>
  /** Pick and read a text file; null when cancelled. */
  openFile(extensions: string[]): Promise<{ name: string; content: string } | null>
  symbolicate(frames: StackFrame[]): Promise<StackFrame[] | null>
  metroCommand(command: 'reload' | 'devMenu'): Promise<CommandResult>
  adbReverse(): Promise<CommandResult>
  adbDevices(): Promise<CommandResult>
  openInEditor(file: string, lineNumber: number): Promise<CommandResult>
  openDebugger(panel?: 'console' | 'sources' | 'memory' | 'timeline'): Promise<CommandResult>
  openDeepLink(url: string, platform: 'ios' | 'android'): Promise<CommandResult>
}

export type { CommandDescriptor }
