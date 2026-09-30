export const IPC = {
  getInitialState: 'prism:get-initial-state',
  hubEvents: 'prism:hub-events',
  serverStatus: 'prism:server-status',
  sendToDevice: 'prism:send-to-device',
  updateSettings: 'prism:update-settings',
  updateMocks: 'prism:update-mocks',
  updateConditions: 'prism:update-conditions',
  replayRequest: 'prism:replay-request',
  saveFile: 'prism:save-file',
  symbolicate: 'prism:symbolicate',
  metroCommand: 'prism:metro-command',
  adbReverse: 'prism:adb-reverse',
  adbDevices: 'prism:adb-devices',
  openInEditor: 'prism:open-in-editor'
} as const
