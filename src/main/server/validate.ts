import { z } from 'zod'
import type { ClientMessage } from '@shared/protocol'

const headers = z.record(z.string(), z.string())
const timestamp = z.number().finite()
const shortString = z.string().max(4096)
// Keys used as object/map keys on the desktop must not collide with Object.prototype.
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const safeKey = z
  .string()
  .min(1)
  .max(512)
  .refine((k) => !RESERVED_KEYS.has(k), 'reserved key')

const deviceInfo = z
  .object({
    appName: shortString,
    platform: z.enum(['ios', 'android', 'web', 'unknown']),
    osVersion: shortString.optional(),
    deviceName: shortString.optional(),
    rnVersion: shortString.optional(),
    sdkVersion: shortString.optional(),
    isEmulator: z.boolean().optional(),
    hermes: z.boolean().optional(),
    bundleUrl: shortString.optional(),
    screen: z.object({ width: z.number(), height: z.number(), scale: z.number() }).optional(),
    protocolVersion: z.number().optional()
  })
  .strip()

const schemas = {
  hello: deviceInfo,
  'network.request': z.object({
    id: safeKey,
    url: z.string().max(65_536),
    method: shortString,
    headers,
    body: z.string().optional(),
    startedAt: timestamp,
    source: z.enum(['xhr', 'fetch'])
  }),
  'network.response': z.object({
    id: safeKey,
    status: z.number().int(),
    statusText: z.string().optional().default(''),
    headers,
    body: z.string().optional(),
    bodySize: z.number(),
    truncated: z.boolean().optional(),
    endedAt: timestamp,
    mockedBy: shortString.optional()
  }),
  'network.error': z.object({
    id: safeKey,
    message: z.string(),
    endedAt: timestamp,
    kind: z.enum(['error', 'timeout', 'abort', 'offline'])
  }),
  'ws.open': z.object({
    id: safeKey,
    url: z.string().max(65_536),
    protocols: z.array(shortString).max(32).optional(),
    timestamp
  }),
  'ws.status': z.object({
    id: safeKey,
    status: z.enum(['open', 'closing', 'closed', 'error']),
    code: z.number().int().optional(),
    reason: shortString.optional(),
    timestamp
  }),
  'ws.frame': z.object({
    id: safeKey,
    direction: z.enum(['sent', 'received']),
    data: z.string().max(70_000),
    binary: z.boolean(),
    size: z.number().nonnegative(),
    truncated: z.boolean().optional(),
    timestamp
  }),
  console: z.object({
    level: z.enum(['debug', 'log', 'info', 'warn', 'error']),
    args: z.array(z.unknown()),
    timestamp,
    tag: shortString.optional()
  }),
  error: z.object({
    name: z.string(),
    message: z.string(),
    stack: z.string().optional(),
    componentStack: z.string().optional(),
    isFatal: z.boolean(),
    timestamp
  }),
  'state.action': z.object({
    store: safeKey,
    action: z.unknown(),
    nextState: z.unknown(),
    durationMs: z.number().optional(),
    timestamp
  }),
  'state.snapshot': z.object({ store: safeKey, state: z.unknown() }),
  'storage.snapshot': z.object({ entries: z.array(z.tuple([z.string(), z.string().nullable()])) }),
  'perf.sample': z.object({ timestamp, fps: z.number(), jsLagMs: z.number(), memoryMb: z.number().optional() }),
  'commands.register': z.object({
    commands: z.array(
      z.object({
        id: safeKey,
        title: shortString,
        description: shortString.optional(),
        args: z.array(z.object({ name: shortString, type: z.enum(['string', 'number', 'boolean']) })).optional()
      })
    )
  }),
  'command.result': z.object({
    commandId: safeKey,
    runId: safeKey,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional()
  })
} as const

type SchemaKey = keyof typeof schemas

const isKnownType = (type: unknown): type is SchemaKey => typeof type === 'string' && Object.hasOwn(schemas, type)

export type ParseResult = { ok: true; message: ClientMessage } | { ok: false; reason: string }

/** Parse and validate one raw frame from a device. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid JSON' }
  }
  const envelope = data as { type?: unknown; payload?: unknown }
  if (!envelope || typeof envelope !== 'object' || !isKnownType(envelope.type)) {
    return { ok: false, reason: `unknown message type: ${String(envelope?.type)}` }
  }
  const result = schemas[envelope.type].safeParse(envelope.payload)
  if (!result.success) {
    return { ok: false, reason: `invalid ${envelope.type} payload: ${result.error.issues[0]?.message ?? 'unknown'}` }
  }
  return { ok: true, message: { type: envelope.type, payload: result.data } as ClientMessage }
}
