import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const dir = await mkdtemp(join(tmpdir(), 'api-usage-'))
  dirs.push(dir)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    usagePanelPath: join(dir, 'usage-panel.json'),
  })
  return { ctx, api }
}

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`usage-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

describe('usage.panel', () => {
  it('returns an empty ledger, then folds live session usage', async () => {
    const { ctx, api } = await harness()
    expect(expectOk(await api.usage.panel(request({})))).toEqual({
      days: [],
      models: [],
      totals: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })

    const session = ctx.sessions.create()
    session.append('request/header', {
      header: { config: { provider: 'kimi-for-coding', model: 'kimi-for-coding' } },
      reason: 'initial',
    })
    session.append('assistant/chunk', {
      turn: 1,
      step: 1,
      chunk: { type: 'usage', usage: { inputTokens: 20, outputTokens: 6, cacheReadTokens: 3 } },
    })

    const view = expectOk(await api.usage.panel(request({})))
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
