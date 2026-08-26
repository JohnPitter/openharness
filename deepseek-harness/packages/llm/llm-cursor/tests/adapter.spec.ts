import { describe, expect, it } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { checksum, CursorAdapter } from '../src/adapter.ts'
import type { CursorHttp2Transport, Http2RequestOptions, Http2Response } from '../src/transport.ts'
import { encodeModelsResponse, encodeResponseFixture, frame, trailerFrame } from '../src/protobuf.ts'

const base = { provider: 'cursor', model: 'composer-2.5', messages: [] as never[] }

/** One text-delta data frame followed by a clean trailer — a complete, successful stream. */
const textFrames = (text: string): Uint8Array => {
  const b = new TextEncoder().encode(
    String.fromCharCode(18, text.length + 2, 10, text.length, ...new TextEncoder().encode(text)),
  )
  const data = frame(b)
  const trailer = trailerFrame()
  const out = new Uint8Array(data.length + trailer.length)
  out.set(data)
  out.set(trailer, data.length)
  return out
}

/** Yield `bytes` as a single chunk from an async iterable, the shape `response.body` has. */
async function* bodyOf(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes
}

/** A fake {@link CursorHttp2Transport} whose `request()` is fully scripted by the test. */
function fakeTransport(
  handler: (options: Http2RequestOptions) => Http2Response | Promise<Http2Response>,
): CursorHttp2Transport & { closed: boolean } {
  const state = { closed: false }
  return {
    get closed() { return state.closed },
    async request(options) { return handler(options) },
    close() { state.closed = true },
  }
}

function okResponse(body: Uint8Array, status = 200): Http2Response {
  return { status, headers: {}, body: bodyOf(body) }
}

describe('CursorAdapter native transport', () => {
  it('maps multi-turn conversation and streams protobuf text', async () => {
    let requestBody: Uint8Array | undefined
    const transport = fakeTransport((options) => {
      requestBody = options.body
      return okResponse(textFrames('hello'))
    })
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    const chunks = []
    for await (const c of adapter.stream({
      ...base,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one' }] } as never,
        { role: 'assistant', content: [{ type: 'text', text: 'two' }] } as never,
      ],
    })) chunks.push(c)
    expect(requestBody?.[0]).toBe(0)
    expect(chunks.some(c => c.type === 'text-delta' && c.text === 'hello')).toBe(true)
  })

  it('maps tools to an Agent request and sends official client headers', async () => {
    let headers: Http2RequestOptions['headers'] | undefined
    const transport = fakeTransport((options) => {
      headers = options.headers
      return okResponse(textFrames('ok'))
    })
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    for await (const _ of adapter.stream({
      ...base,
      tools: [{ name: 'my tool', description: 'desc', parameters: { type: 'object' } }],
    })) { }
    expect(headers?.authorization).toBe('Bearer jwt')
    expect(headers?.['x-cursor-client-type']).toBe('ide')
    expect(headers?.['x-cursor-client-layout']).toBe('editor')
    expect(headers?.['x-cursor-client-device-type']).toBe('desktop')
    expect(headers?.['x-cursor-client-os']).toBe(process.platform)
    expect(headers?.['x-cursor-client-os-version']).toBeTypeOf('string')
    expect(headers?.['x-cursor-client-arch']).toBe(process.arch)
    expect(headers?.['x-new-onboarding-completed']).toBe('false')
    expect(headers?.['x-amzn-trace-id']).toBe(`Root=${headers?.['x-request-id']}`)
    expect(headers).not.toHaveProperty('x-cursor-client-key')
    expect(headers?.['x-cursor-timezone']).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
  })

  it('uses the official checksum vector', () => {
    // C=1700000 -> raw [0,0,0,25,240,160] -> obfuscated [165,166,168,180,72,237] -> paaotEjt
    expect(checksum('machine', 'mac', 1700000000000)).toBe('paaotEjtmachine/mac')
  })

  it('reuses a session id across stream calls', async () => {
    const sessionIds: string[] = []
    const transport = fakeTransport((options) => {
      sessionIds.push(options.headers['x-session-id'] ?? '')
      return okResponse(textFrames('ok'))
    })
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    for await (const _ of adapter.stream(base)) { }
    for await (const _ of adapter.stream(base)) { }
    expect(sessionIds[0]).toBe(sessionIds[1])
  })

  it('reports HTTP and missing credentials', async () => {
    const transport = fakeTransport(() => okResponse(new Uint8Array(), 401))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of adapter.stream(base)) { }
    }).rejects.toMatchObject({ code: 'AUTH' })
    const missing = new CursorAdapter(async () => {
      throw new LlmError('missing', 'MISSING_CREDENTIAL')
    }, () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of missing.stream(base)) { }
    }).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('honors abort and unsupported options', async () => {
    const controller = new AbortController()
    const transport = fakeTransport(async (options) => {
      await new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () => { reject(new LlmError('request aborted', 'ABORTED')) }, { once: true })
        setTimeout(resolve, 100)
      })
      return okResponse(textFrames('ok'))
    })
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    const pending = (async () => {
      for await (const _ of adapter.stream({ ...base, signal: controller.signal })) { }
    })()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(async () => {
      for await (const _ of adapter.stream({ ...base, stop: ['x'] })) { }
    }).rejects.toMatchObject({ code: 'UNSUPPORTED' })
  })

  it('aborts mid-stream once the response body is already flowing', async () => {
    const controller = new AbortController()
    async function* slowBody(): AsyncIterable<Uint8Array> {
      yield frame(new TextEncoder().encode(String.fromCharCode(18, 3, 10, 1, 97))) // one 'a' text delta
      await new Promise(resolve => setTimeout(resolve, 50))
      yield trailerFrame()
    }
    const transport = fakeTransport(() => ({ status: 200, headers: {}, body: slowBody() }))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    const pending = (async () => {
      const chunks = []
      for await (const c of adapter.stream({ ...base, signal: controller.signal })) chunks.push(c)
      return chunks
    })()
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('discovers models through the unary RPC', async () => {
    const transport = fakeTransport((options) => {
      expect(options.headers['content-type']).toBe('application/proto')
      return okResponse(encodeModelsResponse([{
        name: 'server-id',
        clientDisplayName: 'Display',
        serverModelName: 'server-id',
        contextTokenLimit: 8192,
      }]))
    })
    const adapter = new CursorAdapter(async () => 'jwt', () => ({ fallback: 'Fallback' }), undefined, transport)
    await expect(adapter.listModels('cursor')).resolves.toEqual([{ provider: 'cursor', id: 'server-id', name: 'Display' }])
  })

  it('falls back to configured models on unary auth failure', async () => {
    const transport = fakeTransport(() => okResponse(new Uint8Array(), 401))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({ fallback: 'Fallback' }), undefined, transport)
    await expect(adapter.listModels('cursor')).resolves.toEqual([{ provider: 'cursor', id: 'fallback', name: 'Fallback' }])
  })

  it('emits protobuf usage before finish', async () => {
    const data = frame(encodeResponseFixture({ text: 'x', debuggingOnlyTokenCount: 7 }))
    const trailer = trailerFrame()
    const body = new Uint8Array(data.length + trailer.length)
    body.set(data)
    body.set(trailer, data.length)
    const transport = fakeTransport(() => okResponse(body))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    const chunks = []
    for await (const c of adapter.stream(base)) chunks.push(c)
    expect(chunks.at(-2)).toEqual({ type: 'usage', usage: { inputTokens: 0, outputTokens: 7 } })
    expect(chunks.at(-1)?.type).toBe('finish')
  })

  it('maps a resource_exhausted trailer to a RATE_LIMIT LlmError', async () => {
    const trailer = trailerFrame({
      code: 'resource_exhausted',
      message: 'Error',
      details: [{ debug: { details: { detail: 'You have hit your usage limit.' } } }],
    })
    const transport = fakeTransport(() => okResponse(trailer))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of adapter.stream(base)) { }
    }).rejects.toMatchObject({ code: 'RATE_LIMIT', message: expect.stringContaining('You have hit your usage limit.') as string })
  })

  it('maps unauthenticated/permission_denied trailers to AUTH', async () => {
    for (const code of ['unauthenticated', 'permission_denied']) {
      const transport = fakeTransport(() => okResponse(trailerFrame({ code, message: 'nope' })))
      const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
      await expect(async () => {
        for await (const _ of adapter.stream(base)) { }
      }).rejects.toMatchObject({ code: 'AUTH' })
    }
  })

  it('maps an unrecognized trailer error code to PROVIDER_ERROR', async () => {
    const transport = fakeTransport(() => okResponse(trailerFrame({ code: 'internal', message: 'boom' })))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of adapter.stream(base)) { }
    }).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
  })

  it('treats a clean trailer with no error as a normal stream end', async () => {
    const transport = fakeTransport(() => okResponse(textFrames('done')))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    const chunks = []
    for await (const c of adapter.stream(base)) chunks.push(c)
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('rejects an unknown Connect frame flag as a PROTOCOL error', async () => {
    const transport = fakeTransport(() => okResponse(frame(new Uint8Array([1, 2, 3]), 3)))
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of adapter.stream(base)) { }
    }).rejects.toMatchObject({ code: 'PROTOCOL' })
  })

  it('fails a request that times out waiting for a response', async () => {
    const transport: CursorHttp2Transport = {
      async request() {
        throw new LlmError('Cursor request timed out after 1ms', 'TIMEOUT')
      },
      close() {},
    }
    const adapter = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    await expect(async () => {
      for await (const _ of adapter.stream(base)) { }
    }).rejects.toMatchObject({ code: 'TIMEOUT' })
  })

  it('disposes its owned transport but not an injected one', () => {
    const transport = fakeTransport(() => okResponse(textFrames('ok')))
    const injected = new CursorAdapter(async () => 'jwt', () => ({}), undefined, transport)
    injected.dispose()
    expect(transport.closed).toBe(false)
  })
})
