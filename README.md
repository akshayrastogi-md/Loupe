# Loupe

A desktop debugger for React Native. It shows network traffic, logs, state, storage, performance and errors for any RN app, and lets you mock APIs and throttle the network. It runs on macOS, Windows and Linux.

## Features

| Panel | What you get |
|---|---|
| **Network** | Every `fetch`/XHR/axios request (native fetch and the XHR polyfill), with status, method, host, type, size, time and a waterfall. You can filter by text, `status:404`, type, method, failed-only or mocked-only. The detail pane shows headers, query params, payload, a searchable JSON tree of the response, image preview and timing. Copy as **cURL** or **fetch()**, **Replay** a request, **Mock** it from the captured response, or **Export HAR**. GraphQL operation names are detected. **WebSockets:** connections and frames in both directions, and you can send frames into a live socket. **Edit & resend** from the device or desktop, and **Export HAR** with secrets hidden. |
| **Console** | Streams `console.*` output with level filters, search, expandable objects and collapsible long lines. History is kept across app reloads. |
| **Queries** | TanStack Query cache: fresh, fetching, stale, inactive and error states, data and details, plus refetch, invalidate, reset or remove per query or for all. |
| **State** | Redux, Zustand or any store: an action log with timings, **diffs**, **dispatch** from the desktop, and **time travel**. |
| **Storage** | View, edit, add, delete and clear AsyncStorage keys. The view refreshes automatically when the app writes. |
| **Performance** | Live JS frame rate, event-loop lag and Hermes heap. |
| **Errors** | Grouped JS errors with a parsed stack, **Metro symbolication**, **open in editor**, and the component stack. |
| **Mocks & Throttling** | Mock rules by URL (contains, equals or regex) plus method, with status, headers, body and delay. Also **offline simulation** and latency presets. |
| **Device & Commands** | Device info. Reload the app or open the dev menu, through the SDK or Metro. `adb reverse`. **Custom commands** your app registers appear as buttons. |

It also supports multiple devices at once, pausing capture, dark, light or system theme, and keyboard shortcuts (`⌘1–9`, `⌘K` to clear, `⌘F` to filter, `⌘,` for settings).

## Get started

1. **Install the desktop app** from the Releases page, or build it yourself (see below).
2. **Add the SDK** to your React Native app. The full guide is in [client/README.md](client/README.md).

   ```bash
   npm install --save-dev loupe-rn
   ```

   ```ts
   import AsyncStorage from '@react-native-async-storage/async-storage'
   import createLoupe from 'loupe-rn'

   export const loupe = createLoupe({ appName: 'My App', asyncStorage: AsyncStorage }).connect()
   ```

   The SDK does nothing in release builds (`enabled` defaults to `__DEV__`).
3. **Run your app.** Simulators and emulators connect automatically. For physical devices over Wi‑Fi, turn on **Allow LAN connections** in Settings.

Try it without an app: run `npm run demo` in this repo to connect a simulated device. There's also a real Expo app in `examples/expo-example`.

## Build from source

```bash
npm install
npm run dev          # development, with hot reload
npm run dist:dir     # unpacked app for this OS, in release/<version>/
npm run dist         # installers: dmg/zip on macOS, NSIS on Windows, AppImage/deb on Linux
```

Unsigned local builds work. For distribution, set the signing and notarization variables described in [CONTRIBUTING.md](CONTRIBUTING.md#releasing), or push a `v*` tag to run the release workflow. To turn on auto-updates, fill in `publish` in `electron-builder.yml`.

Logs are written to `~/Library/Logs/Loupe` on macOS and `%APPDATA%\Loupe\logs` on Windows. You can also use Help → Open Logs Folder.

## Quality

| Command | What it checks |
|---|---|
| `npm run verify` | ESLint, TypeScript (main, renderer and SDK), unit tests with enforced coverage thresholds (currently about 84% of statements), and the SDK build. |
| `npm run test:e2e` | Playwright drives the real Electron app with a simulated device: onboarding, network capture, mocking, commands, state/storage, disconnect. |
| CI | All of the above, plus packaging on macOS, Windows and Linux. |

The SDK has also been tested in a real Expo SDK 57 / React Native 0.86 app on the iOS simulator. That testing found the React Native-specific fixes now covered by tests: native-fetch capture, the missing XHR `statusText`, and falling back to `localhost` when Metro serves over the LAN IP.

## Architecture

```
client/        React Native SDK (no runtime deps). client/src/protocol.ts is the wire protocol.
src/main/      Electron main: WebSocket hub, IPC, persistence, Metro/adb/replay tools, logging, updater, menu
src/preload/   contextBridge API (sandboxed)
src/renderer/  React UI: pure reducer + zustand store + panels
src/shared/    Pure helpers: HAR, snippets, diff, stack parsing, filters, formatting
e2e/           Playwright end-to-end tests
demo/          Simulated app that speaks the real protocol
```

See [SECURITY.md](SECURITY.md) for the threat model and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

MIT
