import type { StackFrame } from './types'

// Hermes / V8:  "at fn (http://host/index.bundle:10:20)"  or  "at http://host/index.bundle:10:20"
const V8_FRAME = /^\s*at\s+(?:(.+?)\s+\()?(?:address at\s+)?(.+?):(\d+):(\d+)\)?\s*$/
// JSC / Firefox: "fn@http://host/index.bundle:10:20"
const JSC_FRAME = /^\s*(.*?)@(.+?):(\d+):(\d+)\s*$/
// Hermes native frames: "at fn (native)"
const NATIVE_FRAME = /^\s*at\s+(.+?)\s+\(native\)\s*$/

export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return []
  return stack.split('\n').flatMap((line): StackFrame[] => {
    const v8 = line.match(V8_FRAME)
    if (v8) {
      return [{ methodName: v8[1] ?? '<anonymous>', file: v8[2], lineNumber: Number(v8[3]), column: Number(v8[4]) }]
    }
    const jsc = line.match(JSC_FRAME)
    if (jsc) {
      return [{ methodName: jsc[1] || '<anonymous>', file: jsc[2], lineNumber: Number(jsc[3]), column: Number(jsc[4]) }]
    }
    const native = line.match(NATIVE_FRAME)
    if (native) return [{ methodName: native[1], file: '(native)', lineNumber: null, column: null }]
    return []
  })
}

/** True for frames that come from node_modules or the RN runtime rather than app code. */
export function isLibraryFrame(frame: StackFrame): boolean {
  return frame.file === '(native)' || /node_modules|\/Libraries\/|InternalBytecode/.test(frame.file)
}

export function shortFile(file: string): string {
  const withoutQuery = file.split('?')[0]
  const nodeModules = withoutQuery.lastIndexOf('node_modules/')
  if (nodeModules >= 0) return withoutQuery.slice(nodeModules)
  try {
    return new URL(withoutQuery).pathname.replace(/^\//, '')
  } catch {
    return withoutQuery
  }
}
