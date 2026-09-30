# loupe-rn

The React Native SDK for [Loupe](../README.md), a desktop debugger for React Native. It sends your app's network traffic, logs, errors, state, AsyncStorage and performance data to the Loupe app. From Loupe you can mock APIs, simulate offline mode or slow networks, and run commands in your app.

- It has no runtime dependencies and is about 44 kB.
- It works with bare React Native and Expo, including Expo Go. It supports RN 0.70 and later and has been tested on RN 0.86.
- **It does nothing in release builds.** `enabled` defaults to `__DEV__`, so nothing is patched and no socket is opened in production.

## Install

```bash
npm install --save-dev loupe-rn
```

## Usage

Import it as early as possible (for example at the top of `index.js`), so requests made at startup are captured:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage'
import createLoupe from 'loupe-rn'

export const loupe = createLoupe({ appName: 'My App', asyncStorage: AsyncStorage }).connect()
```

### State

```ts
// Redux Toolkit
configureStore({ reducer, enhancers: (getDefault) => getDefault().concat(loupe.reduxEnhancer()) })

// Zustand
loupe.trackZustand('cart', useCartStore)

// Anything with getState/subscribe
loupe.trackStore('session', { getState, subscribe, dispatch, restore })
```

### Custom commands

These show up as buttons in Loupe's Device panel:

```ts
loupe.registerCommand({
  id: 'seed',
  title: 'Seed test data',
  args: [{ name: 'count', type: 'number' }],
  handler: async ({ count }) => seedDatabase(count)
})
```

### Errors and logs

Uncaught JS errors are captured automatically. For caught errors, report them yourself:

```ts
componentDidCatch(error, info) {
  loupe.reportError(error, info.componentStack)
}
loupe.log('checkout started', { cartId })
```

## Options

| Option | Default | Description |
|---|---|---|
| `enabled` | `__DEV__` | Master switch. When `false` you get an inert client. |
| `appName` | `'React Native App'` | Shown in Loupe's device picker. |
| `host` | auto | Loupe's host. By default it tries the Metro host, then `localhost` (iOS simulator), then `10.0.2.2` (Android emulator). |
| `port` | `9393` | Must match Loupe's port setting. |
| `network`, `console`, `errors`, `performance` | `true` | Turn individual features on or off. |
| `asyncStorage` | none | Pass your AsyncStorage instance to enable the Storage panel. |
| `ignoreUrls` | `[]` | URLs containing any of these strings are never captured. |

## How it works

- **Network:** `XMLHttpRequest` (used by axios and by the classic `fetch` polyfill) and native `fetch` are both instrumented. Each request is recorded once, whichever layer your RN version uses. Only text bodies up to 1 MB are sent to Loupe.
- **Mocks and offline mode:** these are applied inside your app, so the app behaves exactly as it would against a real server. They switch off automatically when Loupe disconnects.
- **Safety:** the SDK never throws into your app. Serialization handles circular references, huge objects and getters that throw.

## Connecting

| Setup | What to do |
|---|---|
| iOS simulator | Nothing. |
| Android emulator | Nothing, or click **adb reverse** in Loupe. |
| Physical device over Wi‑Fi | In Loupe's Settings, turn on **Allow LAN connections**. |
| Physical Android device over USB | Click **adb reverse** in Loupe. |
