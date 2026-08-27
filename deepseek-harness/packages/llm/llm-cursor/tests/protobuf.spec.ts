import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  decodeModelsResponse,
  encodeModelsResponse,
  frame,
  payloadFromConnectBody,
  trailerFrame,
} from '../src/protobuf.ts'

describe('decodeModelsResponse', () => {
  it('unions model_names after AvailableModel rows and skips duplicate ids', () => {
    const payload = encodeModelsResponse(
      [{ name: 'composer-2.5', clientDisplayName: 'Composer 2.5', serverModelName: 'composer-2.5' }],
      ['composer-2.5', 'grok-4'],
    )
    expect(decodeModelsResponse(payload)).toEqual([
      { id: 'composer-2.5', name: 'Composer 2.5' },
      { id: 'grok-4', name: 'grok-4' },
    ])
  })
})

describe('payloadFromConnectBody', () => {
  it('returns unframed protobuf unchanged', () => {
    const payload = encodeModelsResponse([], ['solo'])
    expect(payloadFromConnectBody(payload)).toEqual(payload)
  })

  it('unwraps a gzip data frame before a clean trailer', () => {
    const payload = encodeModelsResponse([], ['gzip-id'])
    const data = frame(gzipSync(payload), 1)
    const trailer = trailerFrame()
    const body = new Uint8Array(data.length + trailer.length)
    body.set(data)
    body.set(trailer, data.length)
    expect(decodeModelsResponse(payloadFromConnectBody(body))).toEqual([{ id: 'gzip-id', name: 'gzip-id' }])
  })

  it('throws when the covering trailer carries an error', () => {
    expect(() => payloadFromConnectBody(trailerFrame({
      code: 'unauthenticated',
      message: 'expired',
    }))).toThrow(LlmError)
  })
})
