import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { HubEvent, LoupeBridge, ServerStatus } from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const bridge: LoupeBridge = {
  platform: process.platform,
  getInitialState: () => ipcRenderer.invoke(IPC.getInitialState),
  onHubEvents: (listener) => subscribe<HubEvent[]>(IPC.hubEvents, listener),
  onServerStatus: (listener) => subscribe<ServerStatus>(IPC.serverStatus, listener),
  sendToDevice: (deviceId, message) => ipcRenderer.invoke(IPC.sendToDevice, deviceId, message),
  updateSettings: (settings) => ipcRenderer.invoke(IPC.updateSettings, settings),
  updateMocks: (mocks) => ipcRenderer.invoke(IPC.updateMocks, mocks),
  updateConditions: (conditions) => ipcRenderer.invoke(IPC.updateConditions, conditions),
  replayRequest: (request) => ipcRenderer.invoke(IPC.replayRequest, request),
  saveFile: (defaultName, content) => ipcRenderer.invoke(IPC.saveFile, defaultName, content),
  symbolicate: (frames) => ipcRenderer.invoke(IPC.symbolicate, frames),
  metroCommand: (command) => ipcRenderer.invoke(IPC.metroCommand, command),
  adbReverse: () => ipcRenderer.invoke(IPC.adbReverse),
  adbDevices: () => ipcRenderer.invoke(IPC.adbDevices),
  openInEditor: (file, lineNumber) => ipcRenderer.invoke(IPC.openInEditor, file, lineNumber),
  openDebugger: (panel) => ipcRenderer.invoke(IPC.openDebugger, panel)
}

contextBridge.exposeInMainWorld('loupe', bridge)
