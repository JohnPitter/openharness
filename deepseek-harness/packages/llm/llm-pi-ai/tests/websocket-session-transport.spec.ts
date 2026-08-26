import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api, AssistantMessageEvent, Model } from '@earendil-works/pi-ai'
import { PiAiAdapter } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import type { ResolvedPiAiProviderProfile } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'

const streamSimple = vi.hoisted(() => vi.fn())

const WS_MODEL: Model<'openai-responses'> = {
  id: 'ws-model',
  name: 'ws-model',
  api: 'openai-responses',
  provider: 'ws-route',
  baseUrl: 'http://127.0.0.1:9/v1',
  contextWindow: 8192,
  maxTokens: 1024,
  input: ['text'],
  reasoning: false,
}

const SSE_MODEL: Model<'openai-responses'> = {
  id: 'sse-model',
  name: 'sse-model',
  api: 'openai-responses',
  provider: 'sse-route',
  baseUrl: 'http://127.0.0.1:9/v1',
  contextWindow: 8192,
  maxTokens: 1024,
  input: ['text'],
  reasoning: false,
}

function terminalEvents(): AsyncIterable<AssistantMessageEvent> {
  return (async function* () {
    yield {
      type: 'done',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        api: 'openai-responses',
        provider: 'ws-route',
        model: 'ws-model',
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: 0,
      },
    }
  })()
}

vi.mock('@earendil-works/pi-ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@earendil-works/pi-ai')>()
  const models = {
    setProvider: vi.fn(),
    streamSimple: streamSimple,
    getModel: vi.fn((provider: string, id: string) => {
      if (provider === 'ws-route' && id === 'ws-model') return WS_MODEL
      if (provider === 'sse-route' && id === 'sse-model') return SSE_MODEL
      return undefined
    }),
    getModels: vi.fn(() => []),
    login: vi.fn(),
    logout: vi.fn(),
    checkAuth: vi.fn(),
  }
  return {
    ...actual,
    createModels: () => models,
  }
})

beforeEach(() => {
  streamSimple.mockReset()
  streamSimple.mockImplementation(() => terminalEvents())
})

function websocketAdapter(): PiAiAdapter {
  let memoizedProfiles: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  return new PiAiAdapter({
    // Match production: stable profiles identity across operations on one config.
    profiles: () => {
      if (memoizedProfiles === undefined) {
        memoizedProfiles = resolveProfiles({
          'ws-route': {
            api: 'openai-responses',
            baseURL: 'http://127.0.0.1:9/v1',
            transport: 'websocket-cached',
            models: [{ id: 'ws-model', contextWindow: 8192, maxTokens: 1024 }],
          },
          'sse-route': {
            api: 'openai-responses',
            baseURL: 'http://127.0.0.1:9/v1',
            transport: 'sse',
            models: [{ id: 'sse-model', contextWindow: 8192, maxTokens: 1024 }],
          },
        })
      }
      return memoizedProfiles
    },
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function drainWs(adapter: PiAiAdapter, sessionId: string): Promise<void> {
  for await (const _chunk of adapter.stream({
    provider: 'ws-route',
    model: 'ws-model',
    messages: [],
    sessionId: sessionId as never,
  })) {
    // drain
  }
}

describe('websocket session transport', () => {
  it('keeps websocket-cached for the first session id on a websocket-eligible route', async () => {
    const adapter = websocketAdapter()
    await drainWs(adapter, 'parent-session')
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ transport: 'websocket-cached' })
  })

  it('forces SSE for a second session id on the same websocket-eligible route', async () => {
    const adapter = websocketAdapter()
    await drainWs(adapter, 'parent-session')
    await drainWs(adapter, 'child-session')
    expect(streamSimple.mock.calls[1]?.[2]).toMatchObject({ transport: 'sse' })
  })

  it('keeps the same session id on websocket-cached across repeated streams', async () => {
    const adapter = websocketAdapter()
    await drainWs(adapter, 'parent-session')
    await drainWs(adapter, 'parent-session')
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ transport: 'websocket-cached' })
    expect(streamSimple.mock.calls[1]?.[2]).toMatchObject({ transport: 'websocket-cached' })
  })

  it('does not force SSE between session ids on an HTTP-only route', async () => {
    const adapter = websocketAdapter()
    for await (const _chunk of adapter.stream({
      provider: 'sse-route',
      model: 'sse-model',
      messages: [],
      sessionId: 'parent-session' as never,
    })) { /* drain */ }
    for await (const _chunk of adapter.stream({
      provider: 'sse-route',
      model: 'sse-model',
      messages: [],
      sessionId: 'child-session' as never,
    })) { /* drain */ }
    expect(streamSimple.mock.calls[0]?.[2]).toMatchObject({ transport: 'sse' })
    expect(streamSimple.mock.calls[1]?.[2]).toMatchObject({ transport: 'sse' })
  })
})
