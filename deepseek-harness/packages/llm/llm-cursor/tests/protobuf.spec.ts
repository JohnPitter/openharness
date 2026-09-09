import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  decodeTrailer, frame, frames, parseFrames, payloadFromConnectBody, trailerFrame,
} from '../src/protobuf.ts'

describe('payloadFromConnectBody', () => {
  it('returns unframed protobuf unchanged', () => {
    const payload = new Uint8Array([10, 4, 115, 111, 108, 111])
    expect(payloadFromConnectBody(payload)).toEqual(payload)
  })

  it('unwraps a gzip data frame before a clean trailer', () => {
    const payload = new Uint8Array([10, 3, 97, 98, 99])
    const data = frame(gzipSync(payload), 1)
    const trailer = trailerFrame()
    const body = new Uint8Array(data.length + trailer.length)
    body.set(data)
    body.set(trailer, data.length)
    expect(Buffer.from(payloadFromConnectBody(body))).toEqual(Buffer.from(payload))
  })

  it('throws when the covering trailer carries an error', () => {
    expect(() => payloadFromConnectBody(trailerFrame({
      code: 'unauthenticated',
      message: 'expired',
    }))).toThrow(LlmError)
  })
})

describe('frame splitting', () => {
  it('parses complete frames and ignores a trailing partial frame', () => {
    const first = frame(new Uint8Array([1, 2]))
    const second = frame(new Uint8Array([3]), 2)
    const partial = frame(new Uint8Array([9, 9, 9])).slice(0, 4)
    const body = new Uint8Array(first.length + second.length + partial.length)
    body.set(first)
    body.set(second, first.length)
    body.set(partial, first.length + second.length)
    const parsed = parseFrames(body)
    expect(parsed.map(packet => packet.flags)).toEqual([0, 2])
    expect(frames(body)).toHaveLength(2)
  })
})

describe('decodeTrailer', () => {
  it('accepts a clean trailer', () => {
    expect(() => decodeTrailer(new TextEncoder().encode('{}'))).not.toThrow()
  })

  it('maps authentication failures to AUTH', () => {
    expect(() => decodeTrailer(new TextEncoder().encode(JSON.stringify({
      error: { code: 'unauthenticated', message: 'expired token' },
    })))).toThrow(/expired token/)
    try {
      decodeTrailer(new TextEncoder().encode(JSON.stringify({ error: { code: 'unauthenticated', message: 'x' } })))
      expect.unreachable()
    } catch (error) {
      expect((error as LlmError).code).toBe('AUTH')
    }
  })

  it('maps a rejected client version to PROVIDER_ERROR, other exhaustion to RATE_LIMIT', () => {
    try {
      decodeTrailer(new TextEncoder().encode(JSON.stringify({
        error: { code: 'resource_exhausted', message: 'Your version of Cursor is no longer supported' },
      })))
      expect.unreachable()
    } catch (error) {
      expect((error as LlmError).code).toBe('PROVIDER_ERROR')
    }
    try {
      decodeTrailer(new TextEncoder().encode(JSON.stringify({
        error: { code: 'resource_exhausted', message: 'quota exceeded' },
      })))
      expect.unreachable()
    } catch (error) {
      expect((error as LlmError).code).toBe('RATE_LIMIT')
    }
  })
})
