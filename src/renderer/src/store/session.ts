import { z } from 'zod'
import type { NetworkEntry } from '@shared/network'
import { redactEntry, redactUrl } from '@shared/redact'
import type { DeviceState } from './deviceState'

export const SESSION_FORMAT = 'loupe-session'
export const SESSION_VERSION = 1
/** Imported files larger than this are rejected before parsing. */
export const MAX_SESSION_BYTES = 200 * 1024 * 1024

type Captured = Omit<DeviceState, 'connected' | 'disconnectedAt' | 'commandResults' | 'unseenErrors'>

export interface SessionFile {
  format: typeof SESSION_FORMAT
  version: typeof SESSION_VERSION
  exportedAt: string
  appVersion: string
  redacted: boolean
  device: Captured
}

function redactNetwork(network: DeviceState['network']): DeviceState['network'] {
  const byId: Record<string, NetworkEntry> = {}
  network.order.forEach((id) => {
    byId[id] = redactEntry(network.byId[id])
  })
  return { order: network.order, byId }
}

function redactSockets(sockets: DeviceState['sockets']): DeviceState['sockets'] {
  return {
    order: sockets.order,
    byId: Object.fromEntries(
      sockets.order.map((id) => [id, { ...sockets.byId[id], url: redactUrl(sockets.byId[id].url) }])
    )
  }
}

/** Serialize one device's capture. Redaction masks credentials in HTTP traffic and socket URLs. */
export function exportSession(device: DeviceState, appVersion: string, redact: boolean): string {
  const captured: Captured = {
    summary: device.summary,
    network: redact ? redactNetwork(device.network) : device.network,
    sockets: redact ? redactSockets(device.sockets) : device.sockets,
    queries: device.queries,
    logs: device.logs,
    errors: device.errors,
    actions: device.actions,
    stores: device.stores,
    storage: redact ? null : device.storage,
    perf: device.perf,
    commands: device.commands
  }
  const file: SessionFile = {
    format: SESSION_FORMAT,
    version: SESSION_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion,
    redacted: redact,
    device: captured
  }
  return JSON.stringify(file)
}

// Structural validation: enough to guarantee the UI can render the file safely.
const recordOf = <T extends z.ZodTypeAny>(schema: T) => z.record(z.string(), schema)
const sessionSchema = z.object({
  format: z.literal(SESSION_FORMAT),
  version: z.literal(SESSION_VERSION),
  exportedAt: z.string(),
  appVersion: z.string(),
  redacted: z.boolean(),
  device: z.object({
    summary: z.object({
      id: z.string(),
      info: z.object({ appName: z.string(), platform: z.enum(['ios', 'android', 'web', 'unknown']) }).passthrough(),
      connectedAt: z.number(),
      remoteAddress: z.string()
    }),
    network: z.object({
      order: z.array(z.string()),
      byId: recordOf(
        z
          .object({ id: z.string(), request: z.object({ url: z.string(), method: z.string() }).passthrough() })
          .passthrough()
      )
    }),
    sockets: z.object({
      order: z.array(z.string()),
      byId: recordOf(z.object({ frames: z.array(z.unknown()) }).passthrough())
    }),
    queries: recordOf(z.object({ queries: z.array(z.unknown()) }).passthrough()),
    logs: z.array(z.object({ id: z.string(), level: z.string(), args: z.array(z.unknown()) }).passthrough()),
    errors: z.array(z.object({ id: z.string(), message: z.string() }).passthrough()),
    actions: z.array(z.object({ id: z.string(), store: z.string() }).passthrough()),
    stores: recordOf(z.unknown()),
    storage: z.array(z.tuple([z.string(), z.string().nullable()])).nullable(),
    perf: z.array(z.object({ timestamp: z.number(), fps: z.number() }).passthrough()),
    commands: z.array(z.unknown())
  })
})

export type ImportResult =
  { ok: true; device: DeviceState; meta: Pick<SessionFile, 'exportedAt' | 'redacted'> } | { ok: false; error: string }

/**
 * Parse a session file into an offline, read-only device. It gets a fresh id so
 * importing the same file twice (or alongside the live app) never collides.
 */
export function importSession(text: string): ImportResult {
  if (text.length > MAX_SESSION_BYTES) return { ok: false, error: 'File is too large to import' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Not a Loupe session file (invalid JSON)' }
  }
  const parsed = sessionSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: `Not a valid Loupe session: ${issue?.path.join('.') || 'file'} ${issue?.message ?? ''}`.trim()
    }
  }
  const { device, exportedAt, redacted } = parsed.data as unknown as SessionFile
  const id = `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  return {
    ok: true,
    meta: { exportedAt, redacted },
    device: {
      ...device,
      summary: {
        ...device.summary,
        id,
        remoteAddress: 'imported',
        info: { ...device.summary.info, appName: `${device.summary.info.appName} (imported)` }
      },
      connected: false,
      disconnectedAt: Date.parse(exportedAt) || Date.now(),
      commandResults: {},
      unseenErrors: 0
    }
  }
}
