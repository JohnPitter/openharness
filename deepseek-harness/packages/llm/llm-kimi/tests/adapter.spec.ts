import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { KimiAdapter } from '../src/adapter.ts'
import type { KimiConnectionOptions } from '../src/adapter.ts'

function adapterFor(modelId: string, defaults: KimiConnectionOptions['defaults'] = {}): KimiAdapter {
  const connection: KimiConnectionOptions = {
    baseURL: 'https://example.test/coding/v1',
    apiKeyEnv: credentialRef('KIMI_API_KEY'),
    defaults,
    maxTokens: 32_768,
    defaultContextWindow: 262_144,
    models: [{ id: modelId, name: modelId }],
    streamIdleTimeoutMs: 300_000,
    retryPolicy: resolveRetryPolicy(undefined, 'test'),
  }
  return new KimiAdapter({
    options: () => connection,
    resolveApiKey: () => Promise.resolve('sk-test'),
  })
}

describe('KimiAdapter.resolveModel reasoning', () => {
  it('advertises low/high/max for K3-256k', async () => {
    const info = await adapterFor('k3-256k').resolveModel('kimi-for-coding', 'k3-256k')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high', 'max'])
    expect(info.reasoning?.defaultEffort).toBe('high')
  })

  it('advertises only High for K2.7 code', async () => {
    const info = await adapterFor('kimi-for-coding').resolveModel('kimi-for-coding', 'kimi-for-coding')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['high'])
  })

  it('keeps the Off/High toggle for K2.x thinking models', async () => {
    const info = await adapterFor('kimi-k2.6').resolveModel('kimi-for-coding', 'kimi-k2.6')
    expect(info.reasoning?.efforts.map(effort => effort.id)).toEqual(['off', 'high'])
  })
})

describe('KimiAdapter.advertiseModels', () => {
  it('advertises when the key resolves and withholds when it is missing', async () => {
    await expect(adapterFor('kimi-for-coding').advertiseModels('kimi-for-coding')).resolves.toBe(true)
    const connection: KimiConnectionOptions = {
      baseURL: 'https://example.test/coding/v1',
      apiKeyEnv: credentialRef('KIMI_API_KEY'),
      defaults: {},
      maxTokens: 32_768,
      defaultContextWindow: 262_144,
      models: [{ id: 'kimi-for-coding', name: 'kimi-for-coding' }],
      streamIdleTimeoutMs: 300_000,
      retryPolicy: resolveRetryPolicy(undefined, 'test'),
    }
    const missing = new KimiAdapter({
      options: () => connection,
      resolveApiKey: () => Promise.reject(new LlmError('no key', 'MISSING_CREDENTIAL')),
    })
    await expect(missing.advertiseModels('kimi-for-coding')).resolves.toBe(false)
  })
})

describe('KimiAdapter.providerInfo', () => {
  it('declares request metering on the coding-plan route', () => {
    expect(adapterFor('kimi-for-coding').providerInfo('kimi-for-coding')).toEqual({
      id: 'kimi-for-coding',
      name: 'Kimi for Code',
      metering: 'requests',
    })
  })
})

describe('KimiAdapter.listModels live listing', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('merges a live listing over the configured catalog', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
      data: [
        { id: 'kimi-for-coding', display_name: 'Live Coding', context_length: 131_072 },
        { id: 'k3', display_name: 'K3' },
      ],
    }), { status: 200 }))
    const models = await adapterFor('kimi-for-coding').listModels('kimi-for-coding')
    expect(models.map(model => model.id)).toEqual(['kimi-for-coding', 'k3'])
    expect(models[0]?.name).toBe('Live Coding')
  })

  it('keeps the configured catalog when the probe fails, and the last live listing after a later failure', async () => {
    const replies = [
      () => Promise.resolve(new Response(JSON.stringify({ data: [{ id: 'k3' }] }), { status: 200 })),
      () => Promise.reject(new Error('down')),
    ]
    vi.stubGlobal('fetch', () => replies.shift()!())
    const adapter = adapterFor('kimi-for-coding')
    expect((await adapter.listModels('kimi-for-coding')).map(model => model.id))
      .toEqual(['kimi-for-coding', 'k3'])
    expect((await adapter.listModels('kimi-for-coding')).map(model => model.id))
      .toEqual(['kimi-for-coding', 'k3'])
  })

  it('passes an abort signal and falls back when the probe is aborted', async () => {
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
    expect((await adapterFor('kimi-for-coding').listModels('kimi-for-coding')).map(model => model.id))
      .toEqual(['kimi-for-coding'])
  })
})
