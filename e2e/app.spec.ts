import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A dedicated port and profile keep the suite isolated from a running Loupe.
const PORT = 19494
const ROOT = join(__dirname, '..')

let app: ElectronApplication
let page: Page
let demo: ChildProcess | null = null
let userData: string

function startDemo(): ChildProcess {
  const child = spawn(process.execPath, ['demo/simulator.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (d) => process.stdout.write(`[demo] ${d}`))
  child.stderr?.on('data', (d) => process.stdout.write(`[demo:err] ${d}`))
  child.on('exit', (code, signal) => process.stdout.write(`[demo] exited code=${code} signal=${signal}\n`))
  return child
}

// The tests share one app + device session and build on each other.
test.describe.configure({ mode: 'serial' })

const nav = (label: string) => page.getByRole('button', { name: label, exact: true })

test.beforeAll(async () => {
  userData = mkdtempSync(join(tmpdir(), 'loupe-e2e-'))
  writeFileSync(
    join(userData, 'loupe-state.json'),
    JSON.stringify({
      settings: { port: PORT, allowLan: false, theme: 'dark', maxEntries: 5000, metroPort: 8081 },
      mocks: [],
      conditions: { offline: false, latencyMs: 0 }
    })
  )
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE')) as Record<
    string,
    string
  >
  app = await electron.launch({ args: [join(ROOT, 'out/main/index.js'), `--user-data-dir=${userData}`], env })
  page = await app.firstWindow()
  app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`))
  app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`))
  page.on('console', (m) => m.type() === 'error' && process.stdout.write(`[renderer] ${m.text()}\n`))
})

test.afterAll(async () => {
  demo?.kill()
  await app?.close()
  rmSync(userData, { recursive: true, force: true })
})

test('shows onboarding until a device connects', async () => {
  await expect(page.getByRole('heading', { name: 'Waiting for your React Native app' })).toBeVisible()
  await expect(page.getByText(`Listening on localhost:${PORT}`)).toBeVisible()
})

test('streams network traffic from a connected device', async () => {
  demo = startDemo()
  await expect(page.getByText('ShopFront').first()).toBeVisible()
  await expect(page.locator('.table-row').first()).toBeVisible()
  await page.locator('.table-row').first().click()
  await page.getByRole('tab', { name: 'Headers' }).click()
  await expect(page.getByText('Request URL')).toBeVisible()
})

test('inspects WebSocket frames and sends into a live socket', async () => {
  await nav('Network').click()
  await page.getByRole('button', { name: /WebSockets/ }).click()
  await expect(page.locator('.action-row', { hasText: '/v1/chat' })).toBeVisible()
  await expect(page.locator('.table-row', { hasText: 'subscribe' }).first()).toBeVisible()
  await page.getByPlaceholder(/Send a text frame/).fill('hello from e2e')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.locator('.table-row', { hasText: 'echo' }).first()).toBeVisible()
  await page.getByRole('button', { name: /^HTTP/ }).click()
})

test('inspects TanStack queries and runs cache actions', async () => {
  await nav('Queries').click()
  await expect(page.getByText('checkout › quote')).toBeVisible()
  await page.locator('.action-row', { hasText: 'orders › o_1' }).click()
  await page.getByRole('button', { name: 'Refetch', exact: true }).click()
  await expect(page.locator('.action-row', { hasText: 'orders › o_1' })).toContainText('FRESH')
  await page.locator('.action-row', { hasText: 'orders › o_1' }).click()
  await page.getByRole('button', { name: 'Invalidate all' }).click()
  await expect(page.locator('.action-row', { hasText: 'orders › o_1' })).toContainText('STALE')
})

test('creates a mock from a captured request', async () => {
  await nav('Network').click()
  // Close any open detail pane first: clicking a selected row toggles it off.
  await page.keyboard.press('Escape')
  await page
    .locator('.table-row:not(.selected)', { hasText: /^\s*200/ })
    .first()
    .click()
  await page.getByRole('button', { name: 'Mock', exact: true }).click()
  await expect(page.getByText('Mock created from request')).toBeVisible()
  await expect(page.locator('.action-row')).toHaveCount(1)
  await expect(page.getByText('1 active')).toBeVisible()
})

test('runs a custom command on the device', async () => {
  await nav('Device & Commands').click()
  const card = page.locator('.command-grid .card', { hasText: 'Seed cart' })
  await card.locator('input').fill('3')
  await card.getByRole('button', { name: 'Run' }).click()
  await expect(card.locator('.command-result')).toContainText('added')
})

test('shows state actions and storage from the device', async () => {
  await nav('State').click()
  await expect(page.getByText('Current state')).toBeVisible()
  await expect(page.locator('.action-row').nth(1)).toBeVisible()
  await nav('Storage').click()
  await expect(page.getByText('@auth/token')).toBeVisible()
})

test('exports a session and imports it as a read-only device', async () => {
  const file = join(userData, 'shared.loupe')
  // Stub the native dialogs in the main process to use a temp file.
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog
  }, file)
  await page.getByTitle('Export session (share a capture)').click()
  await page.getByRole('button', { name: /Export \.loupe/ }).click()
  await expect(page.getByText('Saved ')).toBeVisible()
  await page.getByTitle('Import session').click()
  await expect(page.getByText(/Imported session, captured/)).toBeVisible()
  await expect(page.locator('.device-trigger')).toContainText('(imported)')
  await nav('Network').click()
  await expect(page.locator('.table-row').first()).toBeVisible()
  // Switch back to the live device for the remaining tests.
  await page.locator('.device-trigger').click()
  await page.locator('.device-option', { hasText: 'LIVE' }).click()
})

test('marks the device offline when it disconnects', async () => {
  demo?.kill()
  demo = null
  await expect(page.getByText(/Device disconnected/)).toBeVisible()
})
