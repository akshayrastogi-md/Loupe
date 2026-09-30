import log from 'electron-log/main'

const MAX_LOG_BYTES = 5 * 1024 * 1024

/**
 * File + console logging. Logs live in the OS log directory
 * (~/Library/Logs/Prism DevTools on macOS) and rotate at 5 MB.
 */
export function initLogging(): typeof log {
  log.initialize()
  log.transports.file.maxSize = MAX_LOG_BYTES
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn'
  log.errorHandler.startCatching({
    showDialog: false,
    onError: ({ error, processType }) => {
      log.error(`[${processType ?? 'main'}] Unhandled error:`, error)
    }
  })
  return log
}

export { log }
