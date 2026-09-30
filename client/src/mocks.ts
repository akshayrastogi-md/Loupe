import type { MockRule } from './protocol'

const regexCache = new Map<string, RegExp | null>()

function compile(pattern: string): RegExp | null {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern))
    } catch {
      regexCache.set(pattern, null)
    }
  }
  return regexCache.get(pattern) ?? null
}

export function ruleMatches(rule: MockRule, method: string, url: string): boolean {
  if (!rule.enabled || !rule.urlPattern) return false
  if (rule.method !== 'ANY' && rule.method.toUpperCase() !== method.toUpperCase()) return false
  switch (rule.matchType) {
    case 'exact':
      return url === rule.urlPattern
    case 'contains':
      return url.includes(rule.urlPattern)
    case 'regex':
      return compile(rule.urlPattern)?.test(url) ?? false
    default:
      return false
  }
}

/** Returns the first enabled rule matching the request, or undefined. */
export function findMock(rules: readonly MockRule[], method: string, url: string): MockRule | undefined {
  return rules.find((rule) => ruleMatches(rule, method, url))
}
