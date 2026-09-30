import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { log } from './logger'
import { checkForUpdatesManually } from './updater'
import pkg from '../../package.json'

// Links come from package.json ("homepage", "bugs.url") and are omitted until set.
const DOCS_URL = (pkg as { homepage?: string }).homepage
const ISSUES_URL = (pkg as { bugs?: { url?: string } }).bugs?.url

const linkItem = (label: string, url: string | undefined): MenuItemConstructorOptions[] =>
  url ? [{ label, click: () => void shell.openExternal(url) }] : []

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'
  const openLogs = (): void => {
    void shell.openPath(app.getPath('logs')).then((err) => err && log.warn('Could not open logs folder', err))
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { label: 'Check for Updates…', click: () => void checkForUpdatesManually(getWindow) },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        ...linkItem('Documentation', DOCS_URL),
        ...linkItem('Report an Issue', ISSUES_URL),
        ...(DOCS_URL || ISSUES_URL ? [{ type: 'separator' } satisfies MenuItemConstructorOptions] : []),
        { label: 'Open Logs Folder', click: openLogs },
        ...(isMac ? [] : [{ label: 'Check for Updates…', click: () => void checkForUpdatesManually(getWindow) }])
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
