import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { openDebugger } from './tools'

let server: Server | null = null

function fakeMetro(status: number): Promise<{ port: number; requests: string[] }> {
  const requests: string[] = []
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      res.writeHead(status)
      res.end()
    }).listen(0, '127.0.0.1', () => resolve({ port: (server!.address() as AddressInfo).port, requests }))
  })
}

afterEach(async () => {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
  server = null
})

describe('openDebugger', () => {
  it('POSTs to Metro /open-debugger with the requested panel', async () => {
    const metro = await fakeMetro(200)
    expect(await openDebugger(metro.port, 'sources')).toEqual({ ok: true, output: 'Opened React Native DevTools' })
    expect(metro.requests).toEqual(['POST /open-debugger?panel=sources'])
  })

  it('explains when no debuggable app is connected', async () => {
    const metro = await fakeMetro(404)
    const res = await openDebugger(metro.port)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Hermes')
  })

  it('reports when Metro is not running', async () => {
    const res = await openDebugger(1)
    expect(res.ok).toBe(false)
    expect(res.error).toContain('Cannot reach Metro')
  })
})
