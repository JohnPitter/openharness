/**
 * Settings usage Remote (`ctx.remote.usage`): the live-folded Host ledger
 * behind Settings → Status and the provider account-quota read behind
 * Settings → Limits. Ported from the OpenHarness apiproxy `usage.panel` /
 * `llm.accountUsage` specs.
 */
import { describe, expect, it, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, LlmError, createMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmAccountUsage, LlmProviderInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionUsageController } from '../src/usage.ts'

class QuotaAdapter extends LlmAdapter {
  constructor(private readonly failure?: string) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: provider, metering: 'requests' }
  }

  override accountUsage(): Promise<LlmAccountUsage | undefined> {
    if (this.failure !== undefined) return Promise.reject(new LlmError('no API key', 'MISSING_CREDENTIAL'))
    return Promise.resolve({
      plan: 'Moderato',
      windows: [
        { id: 'weekly', used: 214, limit: 2048, percent: 10 },
        { id: 'rate', used: 139, limit: 200, percent: 70, windowMinutes: 300 },
      ],
    })
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Quota tests never stream.
  }
}

class PlainAdapter extends LlmAdapter {
  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // Quota tests never stream.
  }
}

async function harness(): Promise<{ ctx: Context; usage: SessionUsageController }> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionUsageController)
  return { ctx, usage: ctx.sessionUsage }
}

describe('usage.panel', () => {
  it('returns an empty ledger, then folds live session usage', async () => {
    const { ctx, usage } = await harness()
    expect(await usage.panel()).toEqual({
      days: [],
      models: [],
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })

    const session = ctx.sessions.create()
    session.append('request/header', {
      header: { config: { provider: 'kimi-for-coding', model: 'kimi-for-coding' } },
      reason: 'initial',
    })
    session.append('turn/start', { turn: 1 })
    session.append('assistant/message', {
      stream: [],
      turn: 1,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'kimi-for-coding', model: 'kimi-for-coding' },
      }),
      usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 3 },
    }, { surfaceOp: 'append' })

    const view = await usage.panel()
    expect(view.totals).toEqual({
      requests: 1,
      inputTokens: 20,
      outputTokens: 6,
      cacheReadTokens: 3,
      cacheWriteTokens: 0,
    })
    expect(view.models[0]).toMatchObject({ provider: 'kimi-for-coding', model: 'kimi-for-coding', requests: 1 })
  })
})

describe('usage.accountUsage', () => {
  const signal = new AbortController().signal

  it('reports unsupported when the adapter has no quota surface', async () => {
    const { ctx, usage } = await harness()
    ctx.llm.registerAdapter(['deepseek-official'], new PlainAdapter())
    expect(await usage.accountUsage({ provider: 'deepseek-official' }, signal)).toEqual({ supported: false })
  })

  it('reports unsupported for an unregistered route', async () => {
    const { usage } = await harness()
    expect(await usage.accountUsage({ provider: 'kimi-for-coding' }, signal)).toEqual({ supported: false })
  })

  it('returns quota windows from the owning adapter', async () => {
    const { ctx, usage } = await harness()
    ctx.llm.registerAdapter(['kimi-for-coding'], new QuotaAdapter())
    expect(await usage.accountUsage({ provider: 'kimi-for-coding' }, signal)).toEqual({
      supported: true,
      plan: 'Moderato',
      windows: [
        { id: 'weekly', used: 214, limit: 2048, percent: 10 },
        { id: 'rate', used: 139, limit: 200, percent: 70, windowMinutes: 300 },
      ],
    })
  })

  it('keeps credential failures on the value instead of failing the call', async () => {
    const { ctx, usage } = await harness()
    ctx.llm.registerAdapter(['kimi-for-coding'], new QuotaAdapter('MISSING_CREDENTIAL'))
    expect(await usage.accountUsage({ provider: 'kimi-for-coding' }, signal)).toEqual({
      supported: true,
      error: 'no API key',
    })
  })
})
