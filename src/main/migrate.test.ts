import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./logger', () => ({ log: { info: vi.fn(), warn: vi.fn() } }))

const { migrateLegacyData } = await import('./migrate')

describe('migrateLegacyData', () => {
  let root: string
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const setup = (): { appData: string; userData: string; legacy: string } => {
    root = mkdtempSync(join(tmpdir(), 'loupe-migrate-'))
    const legacy = join(root, 'Prism DevTools')
    mkdirSync(legacy)
    return { appData: root, userData: join(root, 'Loupe'), legacy }
  }

  it('copies legacy state into the new folder once', () => {
    const { appData, userData, legacy } = setup()
    writeFileSync(join(legacy, 'prism-state.json'), '{"old":true}')
    writeFileSync(join(legacy, 'window-state.json'), '{"w":1}')
    expect(migrateLegacyData(appData, userData)).toEqual(['loupe-state.json', 'window-state.json'])
    expect(readFileSync(join(userData, 'loupe-state.json'), 'utf8')).toBe('{"old":true}')
    expect(migrateLegacyData(appData, userData)).toEqual([])
  })

  it('never overwrites newer data', () => {
    const { appData, userData, legacy } = setup()
    writeFileSync(join(legacy, 'prism-state.json'), '{"old":true}')
    mkdirSync(userData)
    writeFileSync(join(userData, 'loupe-state.json'), '{"new":true}')
    expect(migrateLegacyData(appData, userData)).toEqual([])
    expect(readFileSync(join(userData, 'loupe-state.json'), 'utf8')).toBe('{"new":true}')
  })

  it('does nothing without a legacy folder', () => {
    root = mkdtempSync(join(tmpdir(), 'loupe-migrate-'))
    expect(migrateLegacyData(root, join(root, 'Loupe'))).toEqual([])
  })
})
