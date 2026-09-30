import { app, dialog, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import { log } from './logger'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * Updates are only active in packaged builds that were published with a
 * `publish` provider (electron-builder then writes app-update.yml).
 */
export function isUpdaterConfigured(): boolean {
  return app.isPackaged && existsSync(join(process.resourcesPath, 'app-update.yml'))
}

export function initAutoUpdates(getWindow: () => BrowserWindow | null): void {
  if (!isUpdaterConfigured()) {
    log.info('Auto-update disabled (not packaged or no publish config)')
    return
  }
  const { autoUpdater } = electronUpdater
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (err) => log.warn('Auto-update error', err))
  autoUpdater.on('update-downloaded', async (info) => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      message: `Prism DevTools ${info.version} is ready to install`,
      detail: 'Restart to finish updating.'
    }
    const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 0) autoUpdater.quitAndInstall()
  })
  const check = (): void => {
    autoUpdater.checkForUpdates().catch((err) => log.warn('Update check failed', err))
  }
  check()
  setInterval(check, CHECK_INTERVAL_MS).unref()
}

export async function checkForUpdatesManually(getWindow: () => BrowserWindow | null): Promise<void> {
  const win = getWindow()
  const show = (message: string): Promise<unknown> =>
    win ? dialog.showMessageBox(win, { message }) : dialog.showMessageBox({ message })
  if (!isUpdaterConfigured()) {
    await show('Automatic updates are not configured for this build.')
    return
  }
  try {
    const result = await electronUpdater.autoUpdater.checkForUpdates()
    if (!result?.isUpdateAvailable) await show(`You're up to date (v${app.getVersion()}).`)
  } catch (err) {
    log.warn('Manual update check failed', err)
    await show(`Could not check for updates: ${(err as Error).message}`)
  }
}
