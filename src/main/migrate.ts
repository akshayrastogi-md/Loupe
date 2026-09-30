import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './logger'

/** The app was called "Prism DevTools" before 0.2; its data lived under that name. */
const LEGACY_DIR_NAME = 'Prism DevTools'
const LEGACY_FILES: ReadonlyArray<readonly [from: string, to: string]> = [
  ['prism-state.json', 'loupe-state.json'],
  ['window-state.json', 'window-state.json']
]

/**
 * Copy settings, mocks and window state from the legacy data folder once.
 * Never overwrites newer data and never deletes the legacy folder.
 */
export function migrateLegacyData(appDataDir: string, userDataDir: string): string[] {
  const legacyDir = join(appDataDir, LEGACY_DIR_NAME)
  if (legacyDir === userDataDir || !existsSync(legacyDir)) return []
  const migrated: string[] = []
  for (const [from, to] of LEGACY_FILES) {
    const source = join(legacyDir, from)
    const target = join(userDataDir, to)
    if (!existsSync(source) || existsSync(target)) continue
    try {
      mkdirSync(userDataDir, { recursive: true })
      copyFileSync(source, target)
      migrated.push(to)
    } catch (err) {
      log.warn(`Could not migrate ${from}`, err)
    }
  }
  if (migrated.length) log.info(`Migrated legacy data from ${legacyDir}: ${migrated.join(', ')}`)
  return migrated
}
