# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Renamed the project from Prism to **Loupe**. The SDK is now `loupe-rn` (`createLoupe`). Settings, mocks and window state migrate automatically from the old app's data folder.

### Added
- **Queries panel:** TanStack Query cache inspector via `loupe.trackQueryClient(queryClient)`, with per-query refetch, invalidate, reset and remove.
- **WebSocket inspector:** connections and frames in both directions in the Network panel, and sending frames into a live socket.
- **Edit & resend:** change a request's method, URL, headers or body, then send it from the device or from the desktop.
- **One-click JS debugger:** opens React Native DevTools through Metro.
- **Navigation:** `loupe.trackNavigation(navigationRef)`, with navigation dispatch and time travel from the State panel.
- **Deep-link launcher** for the iOS simulator and Android.
- **Session export/import:** share a device's full capture as a `.loupe` file.
- **Secret redaction** for HAR and session exports (on by default).
- A clear error, with a "Change port" action, when the device port is already in use.

## [0.1.0] - 2026-09-30

### Added
- **Desktop app panels:**
  - Network: waterfall, filters, HAR export, cURL/fetch copy, replay, create a mock from a request.
  - Console, State (diffs, dispatch, time travel), Storage, Performance, Errors (with symbolication), Mocks and Throttling, Device and Commands.
- **React Native SDK** (`loupe-rn`):
  - Captures XHR and native fetch, console, errors, Redux/Zustand/custom stores, AsyncStorage, performance and custom commands.
  - Does nothing in release builds.
  - Falls back through several hosts (Metro host, `localhost`, `10.0.2.2`).
- **Security:**
  - Sandboxed renderer and strict CSP.
  - Schema validation of device frames and IPC.
  - Browser origins rejected on the device socket.
  - Localhost-only by default.
  - Electron fuses: no `RUN_AS_NODE`, `NODE_OPTIONS` or inspector arguments; asar integrity enforced.
- **Operations:**
  - File logging with rotation and crash recovery.
  - Single-instance lock and remembered window size and position.
  - Auto-update support, active once a publish target is configured.
- **Packaging and CI:**
  - macOS (dmg/zip, arm64 and x64, hardened runtime, notarization-ready), Windows (NSIS) and Linux (AppImage/deb).
  - CI runs lint, typecheck, unit tests with coverage thresholds, Playwright end-to-end tests and packaging on all three OSes.
  - Tag-based release workflow.
