import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { ServerMessage } from '@shared/protocol'
import type { DeviceHub } from './server/hub'
import { conditionsSchema, mockRuleSchema, settingsSchema, type Persistence } from './persistence'
import { adbDevices, adbReverse, metroCommand, openDebugger, openInEditor, replayRequest, symbolicate } from './tools'

const SERVER_MESSAGE_TYPES = [
  'state.request',
  'state.dispatch',
  'state.restore',
  'storage.request',
  'storage.set',
  'storage.remove',
  'storage.clear',
  'command.run',
  'network.resend',
  'ws.send',
  'app.reload',
  'app.devMenu'
] as const

const sendSchema = z.object({
  deviceId: z.string().uuid(),
  message: z.object({ type: z.enum(SERVER_MESSAGE_TYPES), payload: z.record(z.string(), z.unknown()) })
})

const resendSchema = z.object({
  url: z
    .string()
    .max(65_536)
    .refine((u) => /^https?:\/\//i.test(u), 'Only http(s) URLs can be sent'),
  method: z.string().min(1).max(16),
  headers: z.record(z.string(), z.string()),
  body: z.string().max(5_000_000).optional()
})

const wsSendSchema = z.object({ id: z.string().min(1).max(512), data: z.string().max(1_000_000) })

const replaySchema = z.object({
  url: z.string().max(65_536),
  method: z.string().max(16),
  headers: z.record(z.string(), z.string()),
  body: z.string().optional()
})

const frameSchema = z.object({
  methodName: z.string(),
  file: z.string(),
  lineNumber: z.number().nullable(),
  column: z.number().nullable()
})

interface IpcDeps {
  hub: DeviceHub
  persistence: Persistence
  getWindow: () => BrowserWindow | null
}

/** Parse renderer input, throwing a readable error the renderer can surface. */
function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`Invalid ${what}: ${result.error.issues[0]?.message ?? 'unknown error'}`)
  return result.data
}

export function registerIpc({ hub, persistence, getWindow }: IpcDeps): void {
  const metroPort = (): number => persistence.get().settings.metroPort

  ipcMain.handle(IPC.getInitialState, () => ({
    ...persistence.get(),
    status: hub.getStatus(),
    devices: hub.listDevices(),
    appVersion: app.getVersion()
  }))

  ipcMain.handle(IPC.sendToDevice, (_e, deviceId: unknown, message: unknown) => {
    const input = parse(sendSchema, { deviceId, message }, 'device message')
    if (input.message.type === 'network.resend') parse(resendSchema, input.message.payload, 'request')
    if (input.message.type === 'ws.send') parse(wsSendSchema, input.message.payload, 'socket message')
    return hub.send(input.deviceId, input.message as ServerMessage)
  })

  ipcMain.handle(IPC.updateSettings, async (_e, value: unknown) => {
    const next = parse(settingsSchema, value, 'settings')
    const previous = persistence.get().settings
    const needsRestart =
      previous.port !== next.port || previous.allowLan !== next.allowLan || !hub.getStatus().listening
    if (!needsRestart) {
      persistence.update({ settings: next })
      return hub.getStatus()
    }
    const status = await hub.start(next.port, next.allowLan)
    if (status.listening) {
      persistence.update({ settings: next })
      return status
    }
    // Roll back to the last working configuration so devices can still connect.
    await hub.start(previous.port, previous.allowLan)
    return status
  })

  ipcMain.handle(IPC.updateMocks, (_e, value: unknown) => {
    const mocks = parse(z.array(mockRuleSchema), value, 'mock rules')
    persistence.update({ mocks })
    hub.broadcast({ type: 'mocks.update', payload: { mocks } })
  })

  ipcMain.handle(IPC.updateConditions, (_e, value: unknown) => {
    const conditions = parse(conditionsSchema, value, 'network conditions')
    persistence.update({ conditions })
    hub.broadcast({ type: 'network.conditions', payload: conditions })
  })

  ipcMain.handle(IPC.replayRequest, (_e, value: unknown) => replayRequest(parse(replaySchema, value, 'request')))

  ipcMain.handle(IPC.saveFile, async (_e, defaultName: unknown, content: unknown) => {
    const name = parse(z.string().max(255), defaultName, 'file name')
    const data = parse(z.string(), content, 'file content')
    const win = getWindow()
    const options = { defaultPath: name }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return false
    await fs.writeFile(result.filePath, data, 'utf8')
    return true
  })

  ipcMain.handle(IPC.symbolicate, (_e, frames: unknown) =>
    symbolicate(metroPort(), parse(z.array(frameSchema).max(500), frames, 'stack frames'))
  )

  ipcMain.handle(IPC.metroCommand, (_e, command: unknown) =>
    metroCommand(metroPort(), parse(z.enum(['reload', 'devMenu']), command, 'metro command'))
  )

  ipcMain.handle(IPC.openDebugger, (_e, panel: unknown) =>
    openDebugger(
      metroPort(),
      parse(z.enum(['console', 'sources', 'memory', 'timeline']).optional(), panel ?? undefined, 'debugger panel')
    )
  )

  ipcMain.handle(IPC.adbReverse, () => adbReverse([persistence.get().settings.port, metroPort()]))
  ipcMain.handle(IPC.adbDevices, () => adbDevices())

  ipcMain.handle(IPC.openInEditor, (_e, file: unknown, lineNumber: unknown) =>
    openInEditor(metroPort(), parse(z.string().max(4096), file, 'file'), parse(z.number().int(), lineNumber, 'line'))
  )
}
