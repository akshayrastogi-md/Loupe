# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/) and the project uses [Semantic Versioning](https://semver.org/).

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
