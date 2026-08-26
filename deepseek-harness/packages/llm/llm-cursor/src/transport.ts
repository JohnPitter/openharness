/**
 * HTTP/2 transport for Cursor's Connect RPC endpoints.
 *
 * `api2.cursor.sh` only offers `h2` on its TLS ALPN; a plain HTTP/1.1 client
 * (Node's global `fetch`/undici) negotiates HTTP/1.1 against this host and
 * the origin's load balancer answers with HTTP 464 "Incompatible Protocol
 * Versions" instead of routing the request. `node:http2` is required.
 *
 * @module @deepseek-ai/dsh-llm-cursor/transport
 */

import { connect } from 'node:http2'
import type { ClientHttp2Session } from 'node:http2'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** One streamed HTTP/2 response: status, response headers, and the body as an async byte stream. */
export interface Http2Response {
  /** The HTTP status from the `:status` pseudo-header. */
  status: number
  /** Response headers, lowercase-keyed (as HTTP/2 delivers them). */
  headers: Record<string, string | string[] | undefined>
  /** The response body, yielded as it arrives; empty for a body-less response. */
  body: AsyncIterable<Uint8Array>
}

/** One POST request against the transport's origin. */
export interface Http2RequestOptions {
  /** Request path, including leading `/`. */
  path: string
  /** Request headers, excluding `:method`/`:path`/`:authority` (the transport sets those). Sent verbatim; the caller owns lowercasing. */
  headers: Record<string, string>
  /** Request body, sent as a single frame. */
  body: Uint8Array
  /** Aborts the request; already-aborted throws synchronously with `LlmError('ABORTED')`. */
  signal?: AbortSignal
}

/** What the adapter needs from an HTTP/2 transport: one POST call and disposal. */
export interface CursorHttp2Transport {
  /**
   * Send one POST request and resolve once response headers arrive; the body
   * streams through {@link Http2Response.body}.
   * @param options - path, headers, body, and an optional abort signal.
   * @returns the response status, headers, and body stream.
   * @throws LlmError coded `ABORTED` when `signal` fires before or during the
   *   request, `TIMEOUT` when no response header arrives within the
   *   configured timeout, or `PROVIDER_ERROR` for any other connection or
   *   stream failure.
   */
  request(options: Http2RequestOptions): Promise<Http2Response>
  /** Close the underlying session. Idempotent; safe to call more than once. */
  close(): void
}

/** {@link createHttp2Transport} options. */
export interface Http2TransportOptions {
  /** Origin to connect to, e.g. `https://api2.cursor.sh`. */
  baseURL: string
  /** Milliseconds to wait for response headers before failing with `LlmError('TIMEOUT')`; defaults to 120000 (120s). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 120_000

function abortedError(): LlmError {
  return new LlmError('request aborted', 'ABORTED')
}

/**
 * Create an HTTP/2 transport backed by one reused `node:http2` session. The
 * session is opened lazily on first `request()` and kept alive across calls;
 * callers own its lifecycle and must call {@link CursorHttp2Transport.close}
 * once the transport is no longer needed (an adapter ties this to its own
 * disposal).
 * @param options - target origin and response-header timeout.
 * @returns a transport whose `request()` streams one response body at a time per call.
 */
export function createHttp2Transport(options: Http2TransportOptions): CursorHttp2Transport {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let session: ClientHttp2Session | undefined
  let closed = false

  function ensureSession(): ClientHttp2Session {
    if (closed) throw new LlmError('Cursor HTTP/2 transport already closed', 'PROVIDER_ERROR')
    if (session === undefined || session.closed || session.destroyed) {
      session = connect(options.baseURL)
      // A session-level error (e.g. a dropped connection) must not become an
      // unhandled 'error' event; the next request() reconnects lazily.
      session.on('error', () => {})
    }
    return session
  }

  return {
    async request({ path, headers, body, signal }: Http2RequestOptions): Promise<Http2Response> {
      if (signal?.aborted === true) throw abortedError()
      const activeSession = ensureSession()
      return new Promise<Http2Response>((resolve, reject) => {
        let headersSettled = false
        const requestHeaders: Record<string, string> = { ...headers, ':method': 'POST', ':path': path }
        const stream = activeSession.request(requestHeaders)

        // The response-header wait and the request's whole lifetime are two
        // distinct owners: the timer only bounds waiting for headers (a
        // response already delivered may legitimately stream for longer than
        // `timeoutMs`), while abort must close the stream for as long as the
        // caller holds it — including mid-body, after headers already
        // resolved this promise — so it is never removed via `{ once: true }`.
        const timer = setTimeout(() => {
          if (headersSettled) return
          headersSettled = true
          stream.close()
          reject(new LlmError(`Cursor request timed out after ${timeoutMs}ms`, 'TIMEOUT'))
        }, timeoutMs)

        const onAbort = () => {
          clearTimeout(timer)
          stream.close()
          if (!headersSettled) {
            headersSettled = true
            reject(abortedError())
          }
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        stream.once('close', () => { signal?.removeEventListener('abort', onAbort) })

        stream.on('response', (responseHeaders) => {
          if (headersSettled) return
          headersSettled = true
          clearTimeout(timer)
          resolve({
            status: responseHeaders[':status'] ?? 0,
            headers: responseHeaders,
            body: stream,
          })
        })
        stream.on('error', (error: Error) => {
          if (headersSettled) return
          headersSettled = true
          clearTimeout(timer)
          reject(signal?.aborted === true
            ? abortedError()
            : new LlmError(error.message, 'PROVIDER_ERROR', { cause: error }))
        })
        stream.end(body)
      })
    },
    close(): void {
      closed = true
      if (session !== undefined && !session.closed && !session.destroyed) session.close()
      session = undefined
    },
  }
}
