import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { promises as fs, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from './logger'

export interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const DEFAULT_SIZE = { width: 1440, height: 900 }
const SAVE_DEBOUNCE_MS = 400

function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    return overlapX > 100 && overlapY > 100
  })
}

/** Restore the last window size/position, falling back if the display is gone. */
export function loadWindowState(directory: string): Partial<WindowState> & { width: number; height: number } {
  try {
    const saved = JSON.parse(readFileSync(join(directory, 'window-state.json'), 'utf8')) as WindowState
    if (saved?.bounds && isVisibleOnSomeDisplay(saved.bounds)) {
      return { ...saved, width: saved.bounds.width, height: saved.bounds.height }
    }
  } catch {
    // First launch or unreadable file: use defaults.
  }
  return DEFAULT_SIZE
}

export function trackWindowState(win: BrowserWindow, directory: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (win.isDestroyed()) return
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    fs.writeFile(join(directory, 'window-state.json'), JSON.stringify(state)).catch((err) =>
      log.warn('Failed to save window state', err)
    )
  }
  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, SAVE_DEBOUNCE_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('close', save)
}
