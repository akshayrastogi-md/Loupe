# Contributing

## Setup

```bash
npm install
npm run dev     # desktop app with hot reload
npm run demo    # simulated React Native app (in a second terminal)
```

To test against a real app, see `examples/expo-example`. It installs the packed SDK: run `npm pack` in `client/`, then `npm i ../loupe-rn-*.tgz` in the example.

## Before opening a PR

```bash
npm run verify     # lint + typecheck + unit tests (coverage gate) + SDK build
npm run test:e2e   # Playwright against the built Electron app
```

CI runs all of this plus packaging on macOS, Windows and Linux.

## Layout

- `client/`: the React Native SDK, with no runtime dependencies. `client/src/protocol.ts` is the wire protocol and the single source of truth.
- `src/main/`: the Electron main process: WebSocket hub, IPC, persistence, tools, logging, updater.
- `src/renderer/`: the React UI. `store/deviceState.ts` is a pure, unit-tested reducer.
- `src/shared/`: pure helpers used by both processes.
- `e2e/`: Playwright tests that drive the real app with the demo simulator.

## Conventions

- **SDK:** never throw into the host app, and never mutate app data.
- **Validation:** validate anything that crosses a process or network boundary with zod.
- **Tests:** add a regression test with every bug fix.
- **Commits:** use Conventional Commits (`feat:`, `fix:`, `chore:` and so on).

## Releasing

Bump `version` in both `package.json` and `client/package.json` (plus `client/src/version.ts`), update `CHANGELOG.md`, and push a `vX.Y.Z` tag. The release workflow builds the installers, drafts a GitHub release and publishes the SDK. Signing and notarization need these repository secrets: `MAC_CERTS`, `MAC_CERTS_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CERTS`, `WIN_CERTS_PASSWORD` and `NPM_TOKEN`.
