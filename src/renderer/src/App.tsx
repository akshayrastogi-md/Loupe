import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import type { DevicesMap } from './store/deviceState'
import { createDeviceState, useAppStore, useSelectedDevice } from './store/appStore'
import { PANELS, Sidebar, StatusBar, TitleBar, Toasts } from './components/Shell'
import { NetworkPanel } from './panels/network/NetworkPanel'
import { ConsolePanel } from './panels/ConsolePanel'
import { StatePanel } from './panels/StatePanel'
import { QueriesPanel } from './panels/QueriesPanel'
import { StoragePanel } from './panels/StoragePanel'
import { PerformancePanel } from './panels/PerformancePanel'
import { ErrorsPanel } from './panels/ErrorsPanel'
import { MocksPanel } from './panels/MocksPanel'
import { DevicePanel } from './panels/DevicePanel'
import { Welcome } from './panels/Welcome'
import { SettingsDialog } from './panels/SettingsDialog'
import { toast } from './lib/actions'
import { ErrorBoundary } from './components/ErrorBoundary'

function useBootstrap(): void {
  useEffect(() => {
    const store = useAppStore.getState()
    let disposed = false
    window.loupe
      .getInitialState()
      .then((initial) => {
        if (disposed) return
        const devices: DevicesMap = Object.fromEntries(initial.devices.map((d) => [d.id, createDeviceState(d)]))
        store.initialize({
          appVersion: initial.appVersion,
          settings: initial.settings,
          status: initial.status,
          mocks: initial.mocks,
          conditions: initial.conditions,
          devices
        })
        if (!initial.status.listening) toast('error', `Server not running: ${initial.status.error ?? 'unknown error'}`)
      })
      .catch((err: Error) => toast('error', `Failed to initialize: ${err.message}`))
    const offEvents = window.loupe.onHubEvents((events) => useAppStore.getState().applyHubEvents(events))
    const offStatus = window.loupe.onServerStatus((status) => useAppStore.getState().setStatus(status))
    return () => {
      disposed = true
      offEvents()
      offStatus()
    }
  }, [])
}

function useTheme(): void {
  const theme = useAppStore((s) => s.settings.theme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme
      document.documentElement.dataset.theme = resolved
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      const store = useAppStore.getState()
      const index = Number(e.key) - 1
      if (index >= 0 && index < PANELS.length) {
        e.preventDefault()
        store.setPanel(PANELS[index].id)
      } else if (e.key === ',') {
        e.preventDefault()
        store.setSettingsOpen(true)
      } else if (e.key === 'k') {
        e.preventDefault()
        document.querySelector<HTMLButtonElement>('.main [data-clear]')?.click()
      } else if (e.key === 'f') {
        const input = document.querySelector<HTMLInputElement>('.main [data-search]')
        if (input) {
          e.preventDefault()
          input.focus()
          input.select()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function ActivePanel() {
  const panel = useAppStore((s) => s.panel)
  const device = useSelectedDevice()
  if (panel === 'mocks') return <MocksPanel />
  if (!device) return <Welcome />
  switch (panel) {
    case 'network':
      return <NetworkPanel />
    case 'console':
      return <ConsolePanel />
    case 'state':
      return <StatePanel />
    case 'queries':
      return <QueriesPanel />
    case 'storage':
      return <StoragePanel />
    case 'performance':
      return <PerformancePanel />
    case 'errors':
      return <ErrorsPanel />
    case 'device':
      return <DevicePanel />
  }
}

export function App() {
  useBootstrap()
  useTheme()
  useShortcuts()
  const ready = useAppStore((s) => s.ready)
  const panel = useAppStore((s) => s.panel)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const device = useSelectedDevice()

  return (
    <div className="app">
      <TitleBar />
      <Sidebar />
      <main className="main">
        {device && !device.connected && device.summary.remoteAddress === 'imported' && (
          <div className="banner info">
            Imported session, captured {new Date(device.disconnectedAt ?? 0).toLocaleString()}. Read-only.
          </div>
        )}
        {device && !device.connected && device.summary.remoteAddress !== 'imported' && (
          <div className="banner">
            Device disconnected. Showing captured history. It will resume automatically when the app reconnects.
          </div>
        )}
        {ready ? (
          <ErrorBoundary resetKey={`${panel}:${device?.summary.id ?? ''}`}>
            <ActivePanel />
          </ErrorBoundary>
        ) : (
          <div className="empty">
            <Loader2 className="spin" size={20} />
          </div>
        )}
      </main>
      <StatusBar />
      <Toasts />
      {settingsOpen && <SettingsDialog />}
    </div>
  )
}
