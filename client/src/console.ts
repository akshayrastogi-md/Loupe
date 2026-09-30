import type { ClientMessage, LogLevel } from './protocol'
import { serialize } from './serialize'

const LEVELS: readonly LogLevel[] = ['debug', 'log', 'info', 'warn', 'error']

type ConsoleFn = (...args: unknown[]) => void

export function installConsole(send: (message: ClientMessage) => void): () => void {
  const target = console as unknown as Record<LogLevel, ConsoleFn>
  const originals = Object.fromEntries(LEVELS.map((level) => [level, target[level]])) as Record<LogLevel, ConsoleFn>
  let reentrant = false

  LEVELS.forEach((level) => {
    const original = originals[level]
    if (typeof original !== 'function') return
    target[level] = function prismConsole(...args: unknown[]) {
      if (!reentrant) {
        reentrant = true
        try {
          send({ type: 'console', payload: { level, args: args.map((a) => serialize(a)), timestamp: Date.now() } })
        } catch {
          // Never let instrumentation break logging.
        } finally {
          reentrant = false
        }
      }
      return original.apply(console, args)
    }
  })

  return () => {
    LEVELS.forEach((level) => {
      if (originals[level]) target[level] = originals[level]
    })
  }
}
