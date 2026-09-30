export const IPC = {
  getInitialState: 'loupe:get-initial-state',
  hubEvents: 'loupe:hub-events',
  serverStatus: 'loupe:server-status',
  sendToDevice: 'loupe:send-to-device',
  updateSettings: 'loupe:update-settings',
  updateMocks: 'loupe:update-mocks',
  updateConditions: 'loupe:update-conditions',
  replayRequest: 'loupe:replay-request',
  saveFile: 'loupe:save-file',
  symbolicate: 'loupe:symbolicate',
  metroCommand: 'loupe:metro-command',
  adbReverse: 'loupe:adb-reverse',
  adbDevices: 'loupe:adb-devices',
  openInEditor: 'loupe:open-in-editor',
  openDebugger: 'loupe:open-debugger'
} as const
