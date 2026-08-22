import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { userAgent } from '@deepseek-ai/dsh-llm'
import * as LlmKimi from '../src/index.ts'
import { discoverModels } from '../src/discovery.ts'
import type { KimiCatalogModel } from '../src/adapter.ts'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

interface ListingServer {
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
}

/** A stand-in that answers one scripted `GET /models`. */
async function listingServer(behavior: {
  status?: number
  body?: string
}): Promise<ListingServer> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    paths.push(request.url ?? '')
    headers.push(request.headers)
    const body = behavior.body ?? '{}'
    response.writeHead(behavior.status ?? 200, {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    })
    response.end(body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers }
}

const CONFIGURED: readonly KimiCatalogModel[] = [
  { id: 'kimi-for-coding', name: 'Kimi for Coding', contextWindow: 262_144, maxTokens: 32_768 },
]
const stored = (): Promise<string | undefined> => Promise.resolve('stored-key')
const missing = (): Promise<string | undefined> => Promise.resolve(undefined)

describe('Kimi model listing', () => {
  it('reads a live listing, keeps disclosed capacities, and overlays the configured catalog', async () => {
    const server = await listingServer({
      body: JSON.stringify({
        data: [
          { id: 'kimi-for-coding', display_name: 'Live Coding', context_length: 131_072, max: 16_384 },
          { id: 'k3', display_name: 'K3', context_length: 256_000, max: 8192 },
          { id: '' },
          { name: 'no id' },
        ],
      }),
    })

    const models = await discoverModels(
      { baseURL: `${server.url}/coding/v1`, apiKey: 'probe-key' },
      stored,
      'https://unused.example',
      CONFIGURED,
    )

    expect(models).toEqual([
      { id: 'kimi-for-coding', name: 'Live Coding', contextWindow: 131_072, maxTokens: 16_384 },
      { id: 'k3', name: 'K3', contextWindow: 256_000, maxTokens: 8192 },
    ])
    expect(server.paths).toEqual(['/coding/v1/models'])
    expect(server.headers[0]?.authorization).toBe('Bearer probe-key')
    expect(server.headers[0]?.['user-agent']).toBe(userAgent())
  })

  it('uses the default endpoint when the draft names none, including an emptied field', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'k3' }] }) })
    const fromAbsent = await discoverModels(
      { apiKey: 'k' },
      stored,
      server.url,
      CONFIGURED,
    )
    const fromEmpty = await discoverModels(
      { baseURL: '', apiKey: 'k' },
      stored,
      server.url,
      CONFIGURED,
    )
    expect(fromAbsent.map(model => model.id)).toContain('k3')
    expect(fromEmpty.map(model => model.id)).toContain('k3')
    expect(server.paths).toEqual(['/models', '/models'])
  })

  it('keeps a configured id the endpoint omitted', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'k3' }] }) })
    const models = await discoverModels(
      { baseURL: server.url, apiKey: 'k' },
      stored,
      server.url,
      CONFIGURED,
    )
    expect(models.map(model => model.id)).toEqual(['kimi-for-coding', 'k3'])
  })

  it('needs a key, whether the draft or the store supplies it', async () => {
    await expect(discoverModels({ baseURL: 'https://kimi.test' }, missing, 'https://kimi.test', CONFIGURED))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED', message: /requires an API key/ })

    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'k3' }] }) })
    await discoverModels({ baseURL: server.url }, stored, server.url, CONFIGURED)
    expect(server.headers[0]?.authorization).toBe('Bearer stored-key')
  })

  it('reports a blank or illegal probe key as a credential fault', async () => {
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: '' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'sk-\u{1F600}' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('points at the credential for a rejected one, and only then', async () => {
    for (const status of [401, 403]) {
      const refused = await listingServer({ status, body: '{"error":"nope"}' })
      await expect(discoverModels(
        { baseURL: refused.url, apiKey: 'wrong' },
        stored,
        refused.url,
        CONFIGURED,
      )).rejects.toThrow(new RegExp(`answered ${status}; check the API key`))
    }
    const broken = await listingServer({ status: 500, body: '{"error":"boom"}' })
    await expect(discoverModels(
      { baseURL: broken.url, apiKey: 'fine' },
      stored,
      broken.url,
      CONFIGURED,
    )).rejects.toThrow(/answered 500$/)
  })

  it('reports a reply that is not a usable listing', async () => {
    const empty = await listingServer({ body: '{"data":[]}' })
    await expect(discoverModels(
      { baseURL: empty.url, apiKey: 'k' },
      stored,
      empty.url,
      CONFIGURED,
    )).rejects.toThrow(/no usable ids/)

    const malformed = await listingServer({ body: '{"models":[]}' })
    await expect(discoverModels(
      { baseURL: malformed.url, apiKey: 'k' },
      stored,
      malformed.url,
      CONFIGURED,
    )).rejects.toThrow(/no usable ids/)

    const broken = await listingServer({ body: 'not json at all' })
    await expect(discoverModels(
      { baseURL: broken.url, apiKey: 'k' },
      stored,
      broken.url,
      CONFIGURED,
    )).rejects.toThrow(/did not answer with JSON/)
  })

  it('refuses an oversized reply, whether its length is declared or read', async () => {
    const oversized = `{"data":[{"id":"m","pad":"${'x'.repeat(1_048_576)}"}]}`
    const declared = await listingServer({ body: oversized })
    await expect(discoverModels(
      { baseURL: declared.url, apiKey: 'k' },
      stored,
      declared.url,
      CONFIGURED,
    )).rejects.toThrow(/answered with more than 1048576 bytes/)

    vi.stubGlobal('fetch', async () => new Response('x'.repeat(1_048_577), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'k' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toThrow(/answered with more than 1048576 bytes/)
  })

  it('cancels a declared-oversize body, including a response with no body', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': '2000000', 'content-type': 'application/json' },
    }))
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'k' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toThrow(/answered with more than 1048576 bytes/)

    vi.stubGlobal('fetch', async () => new Response(null, {
      status: 200,
      headers: { 'content-length': '2000000' },
    }))
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'k' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toThrow(/answered with more than 1048576 bytes/)
  })

  it('reports an unreachable endpoint instead of an empty catalog', async () => {
    await expect(discoverModels(
      { baseURL: 'http://127.0.0.1:9', apiKey: 'k' },
      stored,
      'http://127.0.0.1:9',
      CONFIGURED,
    )).rejects.toMatchObject({ code: 'DISCOVERY_FAILED', message: /could not reach/ })
  })

  it('reports cancellation during the body read as an abort', async () => {
    const controller = new AbortController()
    const bodyRead = Promise.withResolvers<undefined>()
    vi.stubGlobal('fetch', async (_url: string | URL, init?: RequestInit) => {
      const signal = init?.signal
      if (signal === undefined || signal === null) throw new Error('expected a discovery signal')
      return new Response(new ReadableStream<Uint8Array>({
        pull(stream) {
          bodyRead.resolve(undefined)
          return new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              stream.error(signal.reason)
              resolve()
            }, { once: true })
          })
        },
      }))
    })
    const probe = discoverModels(
      { baseURL: 'https://slow.example', apiKey: 'k', signal: controller.signal },
      stored,
      'https://slow.example',
      CONFIGURED,
    )
    await bodyRead.promise
    controller.abort('test cancellation')
    await expect(probe).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('honors caller cancellation before the request, and a failed fetch while aborted', async () => {
    const aborted = AbortSignal.abort('test cancellation')
    await expect(discoverModels(
      { baseURL: 'http://127.0.0.1:9', apiKey: 'k', signal: aborted },
      stored,
      'http://127.0.0.1:9',
      CONFIGURED,
    )).rejects.toMatchObject({ code: 'ABORTED' })

    vi.stubGlobal('fetch', async () => {
      throw new Error('connect failed')
    })
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'k', signal: AbortSignal.abort() },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('reports a body-read failure as a read error unless the caller aborted', async () => {
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('boom')) },
    }), { status: 200 }))
    await expect(discoverModels(
      { baseURL: 'https://kimi.test', apiKey: 'k' },
      stored,
      'https://kimi.test',
      CONFIGURED,
    )).rejects.toThrow(/could not read/)
  })
})

describe('Kimi discovery registration', () => {
  it('is offered for the namespace and answers from the live listing', async () => {
    const server = await listingServer({ body: JSON.stringify({ data: [{ id: 'k3' }] }) })
    vi.stubEnv('KIMI_API_KEY', 'env-key')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmKimi, { baseURL: server.url })

    const models = await ctx.llm.discoverModels('llm-kimi', { provider: 'kimi-for-coding', baseURL: server.url })
    expect(models.map(model => model.id)).toContain('k3')
    expect(server.headers[0]?.authorization).toBe('Bearer env-key')

    await fiber.dispose()
    await expect(ctx.llm.discoverModels('llm-kimi', { baseURL: server.url }))
      .rejects.toMatchObject({ code: 'NO_DISCOVERY' })
  })

  it('treats a missing stored key as no credential, and rethrows a malformed one', async () => {
    vi.stubEnv('KIMI_API_KEY', '')
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmKimi, { baseURL: 'https://kimi.test' })
    await expect(ctx.llm.discoverModels('llm-kimi', { provider: 'kimi-for-coding' }))
      .rejects.toMatchObject({ code: 'DISCOVERY_FAILED', message: /requires an API key/ })

    vi.stubEnv('KIMI_API_KEY', 'sk-\u{1F600}')
    const invalid = new Context()
    await invalid.plugin(LlmRuntime)
    await invalid.plugin(LlmKimi, { baseURL: 'https://kimi.test' })
    await expect(invalid.llm.discoverModels('llm-kimi', { provider: 'kimi-for-coding' }))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })
})
