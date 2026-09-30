import type { ServerMessage } from '@shared/protocol'
import { useAppStore } from '../store/appStore'

const toast = (kind: 'success' | 'error' | 'info', message: string): void =>
  useAppStore.getState().pushToast(kind, message)

/** Send a message to the selected device, surfacing failures as a toast. */
export async function sendToSelected(message: ServerMessage): Promise<boolean> {
  const { selectedDeviceId, devices } = useAppStore.getState()
  const device = selectedDeviceId ? devices[selectedDeviceId] : undefined
  if (!device?.connected) {
    toast('error', 'No connected device selected')
    return false
  }
  try {
    const ok = await window.loupe.sendToDevice(device.summary.id, message)
    if (!ok) toast('error', 'Device is no longer connected')
    return ok
  } catch (err) {
    toast('error', (err as Error).message)
    return false
  }
}

export async function copyText(text: string, label = 'Copied to clipboard'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast('success', label)
  } catch {
    toast('error', 'Clipboard is unavailable')
  }
}

export async function saveFile(name: string, content: string): Promise<void> {
  try {
    const saved = await window.loupe.saveFile(name, content)
    if (saved) toast('success', `Saved ${name}`)
  } catch (err) {
    toast('error', `Save failed: ${(err as Error).message}`)
  }
}

export { toast }
