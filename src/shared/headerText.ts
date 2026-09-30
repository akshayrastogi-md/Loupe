import type { HttpHeaders } from './protocol'

/** Render headers as editable "name: value" lines. */
export function headersToText(headers: HttpHeaders): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** Parse "name: value" lines; blank or malformed lines are ignored, names are lowercased. */
export function textToHeaders(text: string): HttpHeaders {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.indexOf(':') > 0)
      .map((line) => {
        const idx = line.indexOf(':')
        return [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()]
      })
  )
}
