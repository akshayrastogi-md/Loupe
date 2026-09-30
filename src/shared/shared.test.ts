import { describe, expect, it } from 'vitest'
import { toCurl, toFetch } from './snippets'
import { toHar } from './har'
import { diff } from './diff'
import { isLibraryFrame, parseStack, shortFile } from './stack'
import { formatBytes, formatDuration, formatTime, prettyJson, previewValue, tryParseJson } from './format'
import {
  EMPTY_FILTER,
  entryDuration,
  entryState,
  graphQLOperation,
  matchesFilter,
  resourceKind,
  splitUrl,
  statusLine,
  type NetworkEntry
} from './network'

const entry = (over: Partial<NetworkEntry> = {}, status?: number, contentType = 'application/json'): NetworkEntry => ({
  id: '1',
  request: {
    id: '1',
    url: 'https://api.dev/v1/users?page=2',
    method: 'GET',
    headers: {},
    startedAt: 1000,
    source: 'xhr'
  },
  response:
    status === undefined
      ? undefined
      : {
          id: '1',
          status,
          statusText: 'OK',
          headers: { 'content-type': contentType },
          body: '{"a":1}',
          bodySize: 7,
          endedAt: 1250
        },
  ...over
})

describe('snippets', () => {
  const req = {
    url: 'https://x.dev/a',
    method: 'post',
    headers: { 'content-type': 'application/json' },
    body: `{"q":"it's"}`
  }

  it('builds a cURL command with escaping', () => {
    expect(toCurl(req)).toBe(
      `curl 'https://x.dev/a' \\\n  -X POST \\\n  -H 'content-type: application/json' \\\n  --data-raw '{"q":"it'\\''s"}'`
    )
    expect(toCurl({ url: 'https://x', method: 'GET', headers: {} })).toBe(`curl 'https://x'`)
  })

  it('builds a fetch snippet', () => {
    expect(toFetch(req)).toContain('"method": "POST"')
    expect(toFetch({ url: 'u', method: 'get', headers: {} })).toBe('fetch("u", {\n  "method": "GET"\n})')
  })
})

describe('network helpers', () => {
  it('classifies entry state', () => {
    expect(entryState(entry())).toBe('pending')
    expect(entryState(entry({}, 200))).toBe('success')
    expect(entryState(entry({}, 304))).toBe('redirect')
    expect(entryState(entry({}, 404))).toBe('client-error')
    expect(entryState(entry({}, 503))).toBe('server-error')
    expect(entryState(entry({}, 0))).toBe('failed')
    expect(entryState(entry({ error: { id: '1', kind: 'error', message: 'x', endedAt: 2 } }))).toBe('failed')
  })

  it('computes duration', () => {
    expect(entryDuration(entry({}, 200))).toBe(250)
    expect(entryDuration(entry())).toBeUndefined()
  })

  it('detects resource kinds and GraphQL', () => {
    expect(resourceKind(entry({}, 200))).toBe('json')
    expect(resourceKind(entry({}, 200, 'image/png'))).toBe('image')
    expect(resourceKind(entry({}, 200, 'text/html'))).toBe('html')
    expect(resourceKind(entry({}, 200, 'text/plain'))).toBe('text')
    expect(resourceKind(entry({}, 200, 'video/mp4'))).toBe('media')
    expect(resourceKind(entry({}, 200, 'application/octet-stream'))).toBe('other')
    const gql = entry({
      request: { ...entry().request, url: 'https://x/api', body: '{"query":"query GetUser { me { id } }"}' }
    })
    expect(resourceKind(gql)).toBe('graphql')
    expect(graphQLOperation(gql)).toBe('GetUser')
    expect(graphQLOperation(entry({ request: { ...entry().request, body: '{"operationName":"Op"}' } }))).toBe('Op')
    expect(graphQLOperation(entry({ request: { ...entry().request, body: 'nope' } }))).toBeUndefined()
  })

  it('splits URLs', () => {
    expect(splitUrl('https://api.dev/v1/users?page=2')).toEqual({
      host: 'api.dev',
      path: '/v1/users?page=2',
      name: 'users?page=2',
      query: [['page', '2']]
    })
    expect(splitUrl('not a url').host).toBe('')
  })

  it('filters entries', () => {
    const ok = entry({}, 200)
    const bad = entry({}, 500)
    expect(matchesFilter(ok, EMPTY_FILTER)).toBe(true)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, text: 'USERS' })).toBe(true)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, text: 'posts' })).toBe(false)
    expect(matchesFilter(bad, { ...EMPTY_FILTER, text: 'status:5' })).toBe(true)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, onlyErrors: true })).toBe(false)
    expect(matchesFilter(bad, { ...EMPTY_FILTER, onlyErrors: true })).toBe(true)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, methods: ['POST'] })).toBe(false)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, kinds: ['image'] })).toBe(false)
    expect(matchesFilter(ok, { ...EMPTY_FILTER, onlyMocked: true })).toBe(false)
  })
})

describe('statusLine', () => {
  it('falls back to standard reason phrases when statusText is missing', () => {
    expect(statusLine(404, '')).toBe('404 Not Found')
    expect(statusLine(201)).toBe('201 Created')
    expect(statusLine(200, 'no error')).toBe('200 OK')
    expect(statusLine(299, 'Custom')).toBe('299 Custom')
    expect(statusLine(299)).toBe('299')
  })
})

describe('HAR export', () => {
  it('produces a valid HAR log', () => {
    const har = JSON.parse(toHar([entry({}, 200), entry()], '1.0.0'))
    expect(har.log.version).toBe('1.2')
    expect(har.log.entries).toHaveLength(2)
    expect(har.log.entries[0].response.status).toBe(200)
    expect(har.log.entries[0].request.queryString).toEqual([{ name: 'page', value: '2' }])
    expect(har.log.entries[0].time).toBe(250)
    expect(har.log.entries[1].response.status).toBe(0)
  })
})

describe('diff', () => {
  it('reports added, removed and changed paths', () => {
    expect(diff({ a: 1, b: { c: 2 }, d: [1, 2] }, { a: 1, b: { c: 3 }, d: [1], e: true })).toEqual([
      { path: 'b.c', kind: 'changed', before: 2, after: 3 },
      { path: 'd[1]', kind: 'removed', before: 2 },
      { path: 'e', kind: 'added', after: true }
    ])
  })

  it('handles root and type changes, and respects limit', () => {
    expect(diff(1, 2)).toEqual([{ path: '(root)', kind: 'changed', before: 1, after: 2 }])
    expect(diff({ a: [] }, { a: {} })).toEqual([{ path: 'a', kind: 'changed', before: [], after: {} }])
    expect(diff({}, { a: 1, b: 2, c: 3 }, 2)).toHaveLength(2)
    expect(diff({ a: 1 }, { a: 1 })).toEqual([])
  })
})

describe('stack parsing', () => {
  it('parses Hermes, JSC and native frames', () => {
    const stack = [
      'Error: boom',
      '    at onPress (http://localhost:8081/index.bundle?platform=ios:1234:56)',
      '    at http://localhost:8081/index.bundle?platform=ios:99:1',
      '    at forEach (native)',
      'render@http://localhost:8081/index.bundle:10:20'
    ].join('\n')
    expect(parseStack(stack)).toEqual([
      { methodName: 'onPress', file: 'http://localhost:8081/index.bundle?platform=ios', lineNumber: 1234, column: 56 },
      { methodName: '<anonymous>', file: 'http://localhost:8081/index.bundle?platform=ios', lineNumber: 99, column: 1 },
      { methodName: 'forEach', file: '(native)', lineNumber: null, column: null },
      { methodName: 'render', file: 'http://localhost:8081/index.bundle', lineNumber: 10, column: 20 }
    ])
    expect(parseStack(undefined)).toEqual([])
  })

  it('classifies and shortens files', () => {
    expect(isLibraryFrame({ methodName: 'x', file: '/app/node_modules/react/x.js', lineNumber: 1, column: 1 })).toBe(
      true
    )
    expect(isLibraryFrame({ methodName: 'x', file: '/app/src/App.tsx', lineNumber: 1, column: 1 })).toBe(false)
    expect(shortFile('/Users/me/app/node_modules/react-native/Libraries/x.js')).toBe(
      'node_modules/react-native/Libraries/x.js'
    )
    expect(shortFile('http://localhost:8081/index.bundle?platform=ios')).toBe('index.bundle')
    expect(shortFile('src/App.tsx')).toBe('src/App.tsx')
  })
})

describe('format', () => {
  it('formats bytes and durations', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 kB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatDuration(0.5)).toBe('0.50 ms')
    expect(formatDuration(250)).toBe('250 ms')
    expect(formatDuration(2500)).toBe('2.50 s')
    expect(formatDuration(125_000)).toBe('2m 5s')
    expect(formatDuration(undefined)).toBe('—')
  })

  it('formats time and JSON', () => {
    expect(formatTime(new Date(2020, 0, 1, 9, 5, 3, 7).getTime())).toBe('09:05:03.007')
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(prettyJson('nope')).toBe('nope')
    expect(prettyJson(undefined)).toBe('')
    expect(tryParseJson('[1]')).toEqual({ ok: true, value: [1] })
    expect(tryParseJson('{')).toEqual({ ok: false })
    expect(tryParseJson(null)).toEqual({ ok: false })
  })

  it('previews values', () => {
    expect(previewValue('abc', 2)).toBe('ab…')
    expect(previewValue({ a: 1 })).toBe('{"a":1}')
    expect(previewValue([1, 2, 3], 3)).toBe('[1,…')
  })
})
