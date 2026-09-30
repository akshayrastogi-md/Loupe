import type { ClientMessage, ErrorPayload } from './protocol'

type GlobalHandler = (error: unknown, isFatal?: boolean) => void

interface ErrorUtilsLike {
  getGlobalHandler(): GlobalHandler
  setGlobalHandler(handler: GlobalHandler): void
}

export function toErrorPayload(error: unknown, isFatal: boolean, componentStack?: string): ErrorPayload {
  const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error))
  return {
    name: err.name || 'Error',
    message: err.message || String(error),
    stack: err.stack,
    componentStack,
    isFatal,
    timestamp: Date.now()
  }
}

/** Hook into React Native's global JS error handler (ErrorUtils). */
export function installErrors(send: (message: ClientMessage) => void): () => void {
  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils
  if (!errorUtils?.getGlobalHandler) return () => undefined

  const previous = errorUtils.getGlobalHandler()
  errorUtils.setGlobalHandler((error, isFatal) => {
    try {
      send({ type: 'error', payload: toErrorPayload(error, Boolean(isFatal)) })
    } catch {
      // Reporting must never mask the original error.
    }
    previous?.(error, isFatal)
  })
  return () => errorUtils.setGlobalHandler(previous)
}
