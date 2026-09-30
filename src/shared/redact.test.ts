import { describe, expect, it } from 'vitest'
import { REDACTED, redactBody, redactEntry, redactHeaders, redactUrl } from './redact'
import type { NetworkEntry } from './network'

describe('redaction', () => {
  it('masks credential headers case-insensitively', () => {
    expect(redactHeaders({ Authorization: 'Bearer abc', 'content-type': 'json', Cookie: 's=1' })).toEqual({
      Authorization: REDACTED,
      'content-type': 'json',
      Cookie: REDACTED
    })
  })

  it('masks sensitive query params and URL credentials', () => {
    expect(redactUrl('https://api.dev/x?access_token=abc&page=2')).toBe(
      `https://api.dev/x?access_token=${encodeURIComponent(REDACTED)}&page=2`
    )
    expect(redactUrl('https://user:pw@api.dev/x')).toBe(`https://${encodeURIComponent(REDACTED)}@api.dev/x`)
    expect(redactUrl('https://api.dev/x?page=2')).toBe('https://api.dev/x?page=2')
    expect(redactUrl('not a url')).toBe('not a url')
  })

  it('masks nested JSON secrets but keeps structure', () => {
    const body = JSON.stringify({
      user: { email: 'a@b.c', password: 'p' },
      tokens: { accessToken: 't', expiresIn: 3600 }
    })
    expect(JSON.parse(redactBody(body) as string)).toEqual({
      user: { email: 'a@b.c', password: REDACTED },
      tokens: { accessToken: REDACTED, expiresIn: 3600 }
    })
  })

  it('masks form-encoded bodies and leaves other text alone', () => {
    expect(redactBody('username=a&password=b')).toBe(`username=a&password=${encodeURIComponent(REDACTED)}`)
    expect(redactBody('plain text body')).toBe('plain text body')
    expect(redactBody(undefined)).toBeUndefined()
  })

  it('redacts a whole entry without mutating it', () => {
    const entry: NetworkEntry = {
      id: '1',
      request: {
        id: '1',
        url: 'https://api.dev/login?token=x',
        method: 'POST',
        headers: { authorization: 'Bearer t' },
        body: '{"password":"p"}',
        startedAt: 1,
        source: 'fetch'
      },
      response: {
        id: '1',
        status: 200,
        statusText: '',
        headers: { 'set-cookie': 'sid=1' },
        body: '{"refresh_token":"r"}',
        bodySize: 1,
        endedAt: 2
      }
    }
    const redacted = redactEntry(entry)
    expect(redacted.request.headers.authorization).toBe(REDACTED)
    expect(redacted.response?.headers['set-cookie']).toBe(REDACTED)
    expect(redacted.response?.body).toContain(REDACTED)
    expect(entry.request.headers.authorization).toBe('Bearer t')
  })
})
