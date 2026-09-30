import { app, BrowserWindow, dialog, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { initLogging, log } from './logger'
import { DeviceHub } from './server/hub'
import { Persistence } from './persistence'
import { registerIpc } from './ipc'
import { buildMenu } from './menu'
import { loadWindowState, trackWindowState } from './windowState'
import { initAutoUpdates } from './updater'
import { migrateLegacyData } from './migrate'

initLogging()

// A second instance would fight over the device port; focus the first instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const RENDERER_RELOAD_LIMIT = 3

let mainWindow: BrowserWindow | null = null
let rendererCrashes = 0

const persistence = new Persistence(app.getPath('userData'))

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

const hub = new DeviceHub({
  getWelcome: () => {
    const { mocks, conditions } = persistence.get()
    return { mocks, conditions }
  },
  onEvents: (events) => sendToRenderer(IPC.hubEvents, events),
  onStatus: (status) => sendToRenderer(IPC.serverStatus, status),
  onWarning: (message) => log.warn(message)
})

function isSafeExternalUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function loadRenderer(win: BrowserWindow): void {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devServer) {
    void win.loadURL(devServer)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  const userData = app.getPath('userData')
  const saved = loadWindowState(userData)
  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.bounds?.x,
    y: saved.bounds?.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Loupe',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })
  mainWindow = win
  trackWindowState(win, userData)

  win.once('ready-to-show', () => {
    if (saved.maximized) win.maximize()
    win.show()
  })
  win.on('closed', () => {
    mainWindow = null
  })

  // Never let the renderer navigate away or open new Electron windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  // Recover from renderer crashes a few times before giving up.
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone', details)
    if (details.reason === 'clean-exit') return
    rendererCrashes += 1
    if (rendererCrashes <= RENDERER_RELOAD_LIMIT) {
      loadRenderer(win)
      return
    }
    dialog.showErrorBox(
      'Loupe crashed',
      `The window crashed repeatedly (${details.reason}). Logs: ${app.getPath('logs')}`
    )
  })

  loadRenderer(win)
}

app.on('second-instance', () => {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
})

app
  .whenReady()
  .then(async () => {
    log.info(`Loupe ${app.getVersion()} starting (electron ${process.versions.electron})`)
    migrateLegacyData(app.getPath('appData'), app.getPath('userData'))
    const state = await persistence.load()
    registerIpc({ hub, persistence, getWindow: () => mainWindow })
    buildMenu(() => mainWindow)
    const status = await hub.start(state.settings.port, state.settings.allowLan)
    if (!status.listening) log.error(`Server failed to start: ${status.error}`)
    createWindow()
    initAutoUpdates(() => mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((err: Error) => {
    log.error('Fatal startup error', err)
    dialog.showErrorBox('Loupe failed to start', err.message)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

let shuttingDown = false
app.on('will-quit', (event) => {
  if (shuttingDown) return
  shuttingDown = true
  event.preventDefault()
  // Let pending settings/mock writes finish before exiting.
  void Promise.allSettled([hub.stop(), persistence.flush()]).then(() => app.exit(0))
})
