# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through your repository host's security advisory feature, not in public issues. Include steps to reproduce and the versions affected. We aim to acknowledge reports within 3 business days.

## Threat model

Prism runs a WebSocket server that development builds of React Native apps connect to.

**Network exposure**
- By default it listens on `127.0.0.1` only. "Allow LAN connections" exposes it to your local network; only turn it on for trusted networks.
- Browser pages are rejected: any connection whose `Origin` header doesn't match the target host is refused. React Native's native WebSocket sends either no `Origin` or one matching the target.
- Every frame from a device is schema-validated before use. Frames are limited to 16 MB, and connections that haven't completed their handshake are capped and time out.

**The desktop app**
- The renderer is sandboxed with context isolation, a strict CSP, and no navigation or new windows. Every IPC input is validated.
- `adb` runs through `execFile` without a shell. Request replay only allows `http(s)`, and its response is capped at 5 MB.
- Packaged builds turn on Electron fuses: `runAsNode`, `NODE_OPTIONS` and inspector arguments are disabled, and asar integrity is enforced.

**The SDK**
- It is inert unless `__DEV__` is true, or you pass `enabled: true` explicitly.

Captured traffic can contain secrets such as auth headers and tokens. It stays in memory on your machine and is written to disk only when you export a HAR file.
