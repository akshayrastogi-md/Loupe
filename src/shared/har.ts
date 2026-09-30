import type { HttpHeaders } from './protocol'
import { contentType, entryDuration, splitUrl, type NetworkEntry } from './network'

const toNameValue = (headers: HttpHeaders): Array<{ name: string; value: string }> =>
  Object.entries(headers).map(([name, value]) => ({ name, value }))

/** Serialize captured traffic as an HTTP Archive (HAR 1.2) document. */
export function toHar(entries: readonly NetworkEntry[], creatorVersion: string): string {
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Loupe', version: creatorVersion },
      entries: entries.map((entry) => {
        const { request, response } = entry
        const time = entryDuration(entry) ?? 0
        return {
          startedDateTime: new Date(request.startedAt).toISOString(),
          time,
          request: {
            method: request.method,
            url: request.url,
            httpVersion: 'HTTP/1.1',
            headers: toNameValue(request.headers),
            queryString: splitUrl(request.url).query.map(([name, value]) => ({ name, value })),
            cookies: [],
            headersSize: -1,
            bodySize: request.body?.length ?? 0,
            ...(request.body !== undefined && {
              postData: { mimeType: contentType(request.headers) || 'text/plain', text: request.body }
            })
          },
          response: {
            status: response?.status ?? 0,
            statusText: response?.statusText ?? entry.error?.message ?? '',
            httpVersion: 'HTTP/1.1',
            headers: toNameValue(response?.headers ?? {}),
            cookies: [],
            content: {
              size: response?.bodySize ?? 0,
              mimeType: contentType(response?.headers) || 'text/plain',
              text: response?.body ?? ''
            },
            redirectURL: response?.headers?.location ?? '',
            headersSize: -1,
            bodySize: response?.bodySize ?? -1
          },
          cache: {},
          timings: { send: 0, wait: time, receive: 0 }
        }
      })
    }
  }
  return JSON.stringify(har, null, 2)
}
