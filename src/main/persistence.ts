import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { DEFAULT_SETTINGS, type PersistedState } from '@shared/types'
import { log } from './logger'

export const settingsSchema = z.object({
  port: z.number().int().min(1024).max(65535),
  allowLan: z.boolean(),
  theme: z.enum(['dark', 'light', 'system']),
  maxEntries: z.number().int().min(100).max(100_000),
  metroPort: z.number().int().min(1).max(65535)
})

export const mockRuleSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(256),
  enabled: z.boolean(),
  method: z.string().max(16),
  matchType: z.enum(['contains', 'exact', 'regex']),
  urlPattern: z.string().max(4096),
  status: z.number().int().min(200).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string().max(5_000_000),
  delayMs: z.number().int().min(0).max(120_000)
})

export const conditionsSchema = z.object({
  offline: z.boolean(),
  latencyMs: z.number().int().min(0).max(60_000)
})

const DEFAULT_STATE: PersistedState = {
  settings: DEFAULT_SETTINGS,
  mocks: [],
  conditions: { offline: false, latencyMs: 0 }
}

export class Persistence {
  private readonly file: string
  private state: PersistedState = DEFAULT_STATE
  private writeChain: Promise<void> = Promise.resolve()

  constructor(directory: string) {
    this.file = join(directory, 'loupe-state.json')
  }

  async load(): Promise<PersistedState> {
    let raw: Partial<Record<keyof PersistedState, unknown>>
    try {
      raw = JSON.parse(await fs.readFile(this.file, 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        log.error('Failed to read state, backing it up:', err)
        await fs.copyFile(this.file, `${this.file}.corrupt`).catch(() => undefined)
      }
      this.state = DEFAULT_STATE
      return this.state
    }
    // Validate each section on its own so one bad field never wipes everything.
    const settings = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(raw.settings as object) })
    const mocks = Array.isArray(raw.mocks)
      ? raw.mocks.flatMap((m) => {
          const parsed = mockRuleSchema.safeParse(m)
          return parsed.success ? [parsed.data] : []
        })
      : []
    const latency = conditionsSchema.shape.latencyMs.safeParse((raw.conditions as { latencyMs?: unknown })?.latencyMs)
    this.state = {
      settings: settings.success ? settings.data : DEFAULT_SETTINGS,
      mocks,
      // Offline simulation is deliberately not restored across launches.
      conditions: { offline: false, latencyMs: latency.success ? latency.data : 0 }
    }
    return this.state
  }

  /** Resolves once every queued write has hit the disk. */
  flush(): Promise<void> {
    return this.writeChain
  }

  get(): PersistedState {
    return this.state
  }

  update(patch: Partial<PersistedState>): PersistedState {
    this.state = { ...this.state, ...patch }
    const snapshot = JSON.stringify(this.state, null, 2)
    this.writeChain = this.writeChain
      .then(async () => {
        const tmp = `${this.file}.tmp`
        await fs.writeFile(tmp, snapshot, 'utf8')
        await fs.rename(tmp, this.file)
      })
      .catch((err) => log.error('Failed to persist state:', err))
    return this.state
  }
}
