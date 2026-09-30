import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WebSocket } from 'ws'
import type { CommandResult, ReplayRequest, ReplayResult, StackFrame } from '@shared/types'

const REPLAY_TIMEOUT_MS = 30_000
const REPLAY_MAX_BYTES = 5 * 1024 * 1024
const METRO_TIMEOUT_MS = 4_000
const ADB_TIMEOUT_MS = 10_000
const FORBIDDEN_REPLAY_HEADERS = new Set(['host', 'content-length', 'connection', 'accept-encoding'])

function findAdb(): string {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(homedir(), 'Library/Android/sdk'),
    join(homedir(), 'Android/Sdk')
  ]
  const binary = process.platform === 'win32' ? 'adb.exe' : 'adb'
  for (const root of roots) {
    if (!root) continue
    const candidate = join(root, 'platform-tools', binary)
    if (existsSync(candidate)) return candidate
  }
  return binary // fall back to PATH
}

function run(file: string, args: string[], timeout: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        const notFound = (error as NodeJS.ErrnoException).code === 'ENOENT'
        resolve({
          ok: false,
          error: notFound
            ? `${file} not found. Install Android platform-tools or set ANDROID_HOME.`
            : (stderr || error.message).trim()
        })
        return
      }
      resolve({ ok: true, output: stdout.trim() })
    })
  })
}

export async function adbDevices(): Promise<CommandResult> {
  return run(findAdb(), ['devices', '-l'], ADB_TIMEOUT_MS)
}

/** Forward the Loupe and Metro ports from every connected Android device to this machine. */
export async function adbReverse(ports: number[]): Promise<CommandResult> {
  const adb = findAdb()
  const list = await run(adb, ['devices'], ADB_TIMEOUT_MS)
  if (!list.ok) return list
  const serials = (list.output ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === 'device')
    .map(([serial]) => serial)
  if (!serials.length) return { ok: false, error: 'No Android devices connected (adb devices is empty).' }

  const results = await Promise.all(
    serials.flatMap((serial) =>
      ports.map((port) => run(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`], ADB_TIMEOUT_MS))
    )
  )
  const failed = results.find((r) => !r.ok)
  if (failed) return failed
  return { ok: true, output: `Reversed ports ${ports.join(', ')} on ${serials.join(', ')}` }
}

const BLOCKED_SCHEMES = new Set(['javascript:', 'file:', 'data:', 'vbscript:', 'about:', 'blob:'])

/** Validate a deep link: must parse as a URL with a safe scheme. */
export function validateDeepLink(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Enter a full URL including its scheme, e.g. myapp://profile/42'
  }
  if (BLOCKED_SCHEMES.has(parsed.protocol)) return `The ${parsed.protocol} scheme is not allowed`
  return null
}

/** Open a deep link on the booted iOS simulator or on connected Android devices. */
export async function openDeepLink(url: string, platform: 'ios' | 'android'): Promise<CommandResult> {
  const invalid = validateDeepLink(url)
  if (invalid) return { ok: false, error: invalid }
  if (platform === 'ios') {
    const res = await run('xcrun', ['simctl', 'openurl', 'booted', url], ADB_TIMEOUT_MS)
    if (!res.ok && /No devices are booted/i.test(res.error ?? '')) {
      return { ok: false, error: 'No iOS simulator is booted' }
    }
    // LaunchServices code 115: nothing on the simulator is registered for this scheme.
    if (!res.ok && /code=115|failed to open/i.test(res.error ?? '')) {
      return {
        ok: false,
        error: `No app on the simulator handles ${new URL(url).protocol}// links. Is the app installed and the URL scheme registered?`
      }
    }
    return res.ok ? { ok: true, output: `Opened ${url} on the iOS simulator` } : res
  }
  const res = await run(
    findAdb(),
    ['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', url],
    ADB_TIMEOUT_MS
  )
  if (!res.ok) return res
  if (/Error:|Activity not started/i.test(res.output ?? '')) {
    return { ok: false, error: (res.output ?? '').split('\n').find((l) => /Error|not started/.test(l)) ?? res.output }
  }
  return { ok: true, output: `Opened ${url} on Android` }
}

/** Send a command to every app connected to Metro via its message socket. */
export function metroCommand(metroPort: number, method: 'reload' | 'devMenu'): Promise<CommandResult> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://localhost:${metroPort}/message`)
    const timer = setTimeout(() => {
      socket.terminate()
      resolve({ ok: false, error: `Metro did not respond on port ${metroPort}` })
    }, METRO_TIMEOUT_MS)
    socket.once('open', () => {
      socket.send(JSON.stringify({ version: 2, method }), () => {
        clearTimeout(timer)
        socket.close()
        resolve({ ok: true, output: `Sent ${method} to Metro` })
      })
    })
    socket.once('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: `Cannot reach Metro on port ${metroPort}: ${err.message}` })
    })
  })
}

async function postToMetro(metroPort: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://localhost:${metroPort}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(METRO_TIMEOUT_MS)
  })
}

export async function symbolicate(metroPort: number, frames: StackFrame[]): Promise<StackFrame[] | null> {
  try {
    const res = await postToMetro(metroPort, '/symbolicate', { stack: frames })
    if (!res.ok) return null
    const data = (await res.json()) as { stack?: StackFrame[] }
    return Array.isArray(data.stack) ? data.stack : null
  } catch {
    return null
  }
}

/**
 * Open React Native DevTools (breakpoints, profiler) via Metro's
 * /open-debugger endpoint, for the most recently connected Hermes app.
 */
export async function openDebugger(metroPort: number, panel?: string): Promise<CommandResult> {
  const query = panel ? `?panel=${encodeURIComponent(panel)}` : ''
  try {
    const res = await fetch(`http://localhost:${metroPort}/open-debugger${query}`, {
      method: 'POST',
      signal: AbortSignal.timeout(METRO_TIMEOUT_MS)
    })
    if (res.ok) return { ok: true, output: 'Opened React Native DevTools' }
    if (res.status === 404) {
      return { ok: false, error: 'No debuggable app is connected to Metro. React Native DevTools needs Hermes.' }
    }
    return { ok: false, error: `Metro responded ${res.status}` }
  } catch (err) {
    return { ok: false, error: `Cannot reach Metro on port ${metroPort}: ${(err as Error).message}` }
  }
}

export async function openInEditor(metroPort: number, file: string, lineNumber: number): Promise<CommandResult> {
  try {
    const res = await postToMetro(metroPort, '/open-stack-frame', { file, lineNumber })
    return res.ok ? { ok: true } : { ok: false, error: `Metro responded ${res.status}` }
  } catch (err) {
    return { ok: false, error: `Cannot reach Metro: ${(err as Error).message}` }
  }
}

/** Read a response body as text, stopping at `maxBytes`. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  const truncated = total >= maxBytes
  if (truncated) await reader.cancel().catch(() => undefined)
  const text = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes))
  return truncated ? `${text}\n… [truncated at ${maxBytes / 1024 / 1024} MB]` : text
}

/** Re-issue a captured request from the desktop (outside the app). */
export async function replayRequest(req: ReplayRequest): Promise<ReplayResult> {
  const started = Date.now()
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return { ok: false, error: 'Invalid URL', durationMs: 0 }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Only http(s) requests can be replayed', durationMs: 0 }
  }
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => !FORBIDDEN_REPLAY_HEADERS.has(k.toLowerCase()))
  )
  const method = req.method.toUpperCase()
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : req.body,
      signal: AbortSignal.timeout(REPLAY_TIMEOUT_MS)
    })
    const body = await readCapped(res, REPLAY_MAX_BYTES)
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body,
      durationMs: Date.now() - started
    }
  } catch (err) {
    return { ok: false, error: (err as Error).message, durationMs: Date.now() - started }
  }
}
