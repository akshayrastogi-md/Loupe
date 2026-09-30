import { describe, expect, it } from 'vitest'
import { serialize, clampBody, describeBody } from './serialize'
import { findMock, ruleMatches } from './mocks'
import { normalizeHeaders, parseRawHeaders, serializeHeaders } from './headers'
import type { MockRule } from './protocol'

const rule = (over: Partial<MockRule> = {}): MockRule => ({
  id: 'r1',
  name: 'rule',
  enabled: true,
  method: 'ANY',
  matchType: 'contains',
  urlPattern: '/users',
  status: 200,
  headers: {},
  body: '{}',
  delayMs: 0,
  ...over
})

describe('serialize', () => {
  it('replaces circular references', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(serialize(a)).toEqual({ name: 'a', self: '[Circular]' })
  })

  it('handles non-JSON primitives', () => {
    expect(serialize(undefined)).toBe('[undefined]')
    expect(serialize(NaN)).toBe('NaN')
    expect(serialize(10n)).toBe('10n')
    expect(serialize(function foo() {})).toBe('[Function foo]')
    expect(serialize(Symbol('x'))).toBe('Symbol(x)')
  })

  it('serializes errors, dates, maps and sets', () => {
    const err = serialize(new TypeError('boom')) as Record<string, unknown>
    expect(err.name).toBe('TypeError')
    expect(err.message).toBe('boom')
    expect(serialize(new Date(0))).toBe('1970-01-01T00:00:00.000Z')
    expect(serialize(new Map([['k', 1]]))).toEqual({ '[Map]': [['k', 1]] })
    expect(serialize(new Set([1]))).toEqual({ '[Set]': [1] })
  })

  it('limits depth, width and string length', () => {
    expect(serialize({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({ a: { b: '[Object]' } })
    expect(serialize([[1]], { maxDepth: 1 })).toEqual(['[Array(1)]'])
    expect(serialize([1, 2, 3], { maxKeys: 2 })).toEqual([1, 2, '… 1 more items'])
    expect(serialize({ a: 1, b: 2 }, { maxKeys: 1 })).toEqual({ a: 1, '…': '1 more keys' })
    expect(serialize('abcdef', { maxString: 3 })).toBe('abc… [3 more chars]')
  })

  it('does not mark shared (non-circular) references as circular', () => {
    const shared = { x: 1 }
    expect(serialize({ a: shared, b: shared })).toEqual({ a: { x: 1 }, b: { x: 1 } })
  })

  it('survives throwing getters', () => {
    const obj = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get() {
        throw new Error('nope')
      }
    })
    expect(serialize(obj)).toEqual({ bad: '[Getter threw: nope]' })
  })
})

describe('clampBody / describeBody', () => {
  it('clamps long bodies', () => {
    expect(clampBody('abcdef', 3)).toEqual({ body: 'abc', truncated: true })
    expect(clampBody('ab', 3)).toEqual({ body: 'ab', truncated: false })
  })

  it('describes various bodies', () => {
    expect(describeBody(undefined)).toBeUndefined()
    expect(describeBody('x')).toBe('x')
    expect(describeBody(new URLSearchParams({ a: '1' }))).toBe('a=1')
    expect(describeBody({ a: 1 })).toBe('{"a":1}')
    expect(describeBody(new Uint8Array(2))).toBe('[Binary data]')
  })
})

describe('mock matching', () => {
  it('matches by contains, exact and regex', () => {
    expect(ruleMatches(rule(), 'GET', 'https://api.dev/users/1')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'exact', urlPattern: 'https://a/b' }), 'GET', 'https://a/b')).toBe(true)
    expect(ruleMatches(rule({ matchType: 'exact', urlPattern: 'https://a/b' }), 'GET', 'https://a/b/c')).toBe(false)
    expect(ruleMatches(rule({ matchType: 'regex', urlPattern: '/users/\\d+$' }), 'GET', 'https://x/users/42')).toBe(
      true
    )
  })

  it('respects method and enabled flag, and tolerates bad regex', () => {
    expect(ruleMatches(rule({ method: 'POST' }), 'GET', '/users')).toBe(false)
    expect(ruleMatches(rule({ method: 'post' }), 'POST', '/users')).toBe(true)
    expect(ruleMatches(rule({ enabled: false }), 'GET', '/users')).toBe(false)
    expect(ruleMatches(rule({ matchType: 'regex', urlPattern: '(' }), 'GET', '(')).toBe(false)
    expect(ruleMatches(rule({ urlPattern: '' }), 'GET', '/users')).toBe(false)
  })

  it('returns the first matching rule', () => {
    const rules = [rule({ id: 'a', enabled: false }), rule({ id: 'b' }), rule({ id: 'c' })]
    expect(findMock(rules, 'GET', '/users')?.id).toBe('b')
    expect(findMock(rules, 'GET', '/posts')).toBeUndefined()
  })
})

describe('headers', () => {
  it('parses raw XHR header strings', () => {
    expect(parseRawHeaders('Content-Type: application/json\r\nSet-Cookie: a=1\r\nset-cookie: b=2\r\n')).toEqual({
      'content-type': 'application/json',
      'set-cookie': 'a=1, b=2'
    })
    expect(parseRawHeaders(null)).toEqual({})
  })

  it('normalizes header containers', () => {
    expect(normalizeHeaders({ 'X-A': 1 })).toEqual({ 'x-a': '1' })
    expect(normalizeHeaders([['X-B', 'v']])).toEqual({ 'x-b': 'v' })
    expect(normalizeHeaders(new Headers({ 'X-C': 'c' }))).toEqual({ 'x-c': 'c' })
    expect(normalizeHeaders(undefined)).toEqual({})
  })

  it('serializes headers', () => {
    expect(serializeHeaders({ a: '1', b: '2' })).toBe('a: 1\r\nb: 2')
  })
})
