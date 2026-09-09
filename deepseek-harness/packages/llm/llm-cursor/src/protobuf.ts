/**
 * Connect protocol framing and error handling shared by Cursor transports:
 * 5-byte enveloped frames (`flags` + big-endian length + payload), gzip data
 * frames, and the terminal JSON trailer. Message-level encode/decode lives in
 * `agent-proto.ts` (the `agent.v1` AgentService schema).
 */

import { gunzipSync } from 'node:zlib'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** Protobuf payload of a Connect unary body, or `bytes` when it is not framed.
 * When `parseFrames` consumes the whole buffer, gzip data (`flags = 1`) is inflated and a
 * trailer (`flags = 2`) is passed to {@link decodeTrailer}.
 * @param bytes - HTTP/2 response body of `GetUsableModels` or a test fixture.
 * @returns concatenated data-frame payloads, or the original buffer when frames do not cover it.
 * @throws LlmError when a trailer carries `error`, or a data frame uses unknown flags.
 */
export function payloadFromConnectBody(bytes: Uint8Array): Uint8Array {
  const packets = parseFrames(bytes)
  let covered = 0
  for (const packet of packets) covered += packet.size
  if (packets.length === 0 || covered !== bytes.length) return bytes
  const pieces: Uint8Array[] = []
  for (const packet of packets) {
    if (packet.flags === 2) {
      decodeTrailer(packet.payload)
      continue
    }
    pieces.push(decodePayload(packet.flags, packet.payload))
  }
  if (pieces.length === 0) return new Uint8Array()
  if (pieces.length === 1) return pieces[0] ?? new Uint8Array()
  let total = 0
  for (const piece of pieces) total += piece.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const piece of pieces) {
    out.set(piece, offset)
    offset += piece.length
  }
  return out
}

/** Wrap one payload in a Connect envelope frame (`flags`, big-endian length, payload). */
export function frame(data: Uint8Array, flags = 0): Uint8Array {
  const out = new Uint8Array(5 + data.length)
  out[0] = flags
  new DataView(out.buffer).setUint32(1, data.length)
  out.set(data, 5)
  return out
}

/**
 * Encode a Connect end-of-stream trailer frame (flags `0x02`), for test
 * fixtures. Every real stream ends with one; `error` omitted encodes a clean
 * `{}` trailer (normal end), matching the shape {@link decodeTrailer} expects.
 * @param error - the Connect error payload to encode, when simulating a failed stream.
 */
export function trailerFrame(error?: { code: string; message: string; details?: unknown[] }): Uint8Array {
  const json = JSON.stringify(error === undefined ? {} : { error })
  return frame(new TextEncoder().encode(json), 2)
}

/** Split a buffer into every complete Connect frame it contains, in order. */
export function parseFrames(data: Uint8Array): Array<{ flags: number; payload: Uint8Array; size: number }> {
  const out: Array<{ flags: number; payload: Uint8Array; size: number }> = []
  let offset = 0
  while (offset + 5 <= data.length) {
    const size = new DataView(data.buffer, data.byteOffset + offset + 1).getUint32(0)
    if (offset + 5 + size > data.length) break
    out.push({ flags: data[offset] ?? 0, payload: data.slice(offset + 5, offset + 5 + size), size: size + 5 })
    offset += size + 5
  }
  return out
}

/** Payloads of every complete Connect frame in `data`, in order. */
export function frames(data: Uint8Array): Uint8Array[] {
  return parseFrames(data).map(item => item.payload)
}

/** Undo one data frame's content coding (gzip for flags `1`; identity for flags `0`). */
export function decodePayload(flags: number, payload: Uint8Array): Uint8Array {
  if (flags === 0) return payload
  if (flags === 1) return gunzipSync(payload)
  throw new LlmError(`Unknown Connect frame flags: 0x${flags.toString(16)}`, 'PROTOCOL')
}

/** One `aiserver.v1.ErrorDetails` entry from a Connect trailer's `error.details`. */
interface ConnectErrorDetail {
  debug?: { details?: { detail?: unknown } }
}

/** The JSON payload of a Connect end-of-stream trailer (frame flags `0x02`) carrying a failure. */
interface ConnectErrorTrailer {
  error: {
    code?: unknown
    message?: unknown
    details?: unknown
  }
}

function isConnectErrorTrailer(value: unknown): value is ConnectErrorTrailer {
  return typeof value === 'object' && value !== null && 'error' in value
    && typeof value.error === 'object' && value.error !== null
}

/**
 * Cursor reuses Connect `resource_exhausted` for both quota and a rejected
 * client-version pin. The human detail (or `error.message`) names the version
 * case; quota and billing keep {@link LlmError} `RATE_LIMIT`.
 */
function isClientVersionRejected(message: string): boolean {
  const haystack = message.toLowerCase()
  return haystack.includes('no longer supported') || haystack.includes('cursor.com/downloads')
}

/** Maps the Connect protocol's standard error codes to this adapter's stable {@link LlmError} codes. */
function mapConnectErrorCode(code: unknown, message: string): string {
  if (code === 'unauthenticated' || code === 'permission_denied') return 'AUTH'
  if (code === 'resource_exhausted') return isClientVersionRejected(message) ? 'PROVIDER_ERROR' : 'RATE_LIMIT'
  return 'PROVIDER_ERROR'
}

/**
 * The human-readable detail message nested in the first `ErrorDetails` entry
 * (`details[].debug.details.detail`), when present. Cursor's backend carries
 * its user-facing explanation here; `error.message` alone is often a generic
 * placeholder (e.g. `"Error"`).
 */
function firstDetailMessage(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined
  for (const entry of details as ConnectErrorDetail[]) {
    const detail = entry.debug?.details?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return undefined
}

/**
 * Decode a Connect end-of-stream trailer frame (flags `0x02`). Unlike data
 * frames, the trailer payload is always JSON, never protobuf — Connect's
 * streaming protocol terminates every stream with one such frame, carrying
 * either `{}`/metadata (normal end) or `{"error": {...}}` (failure).
 * @param payload - the raw trailer frame payload (never gzip-compressed).
 * @throws LlmError when the trailer carries an `error`: code `AUTH` for
 *   `unauthenticated`/`permission_denied`, `RATE_LIMIT` for quota
 *   `resource_exhausted`, `PROVIDER_ERROR` for a rejected client-version pin
 *   (same Connect code, detail names the Cursor download) and any other
 *   Connect code. The message combines `error.message` with the nested
 *   human-readable detail when present; the server's original code is carried
 *   as `cause`.
 */
export function decodeTrailer(payload: Uint8Array): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload).toString('utf8'))
  } catch (error) {
    throw new LlmError('Cursor stream trailer is not valid JSON', 'PROTOCOL', { cause: error })
  }
  if (!isConnectErrorTrailer(parsed)) return
  const { error } = parsed
  const serverMessage = typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Cursor stream error'
  const humanDetail = firstDetailMessage(error.details)
  const message = humanDetail === undefined ? serverMessage : `${serverMessage}: ${humanDetail}`
  throw new LlmError(message, mapConnectErrorCode(error.code, message), {
    cause: new Error(`Cursor error code: ${typeof error.code === 'string' ? error.code : 'unknown'}`),
  })
}
