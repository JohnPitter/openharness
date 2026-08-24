/**
 * A committed agent-preset switch leaves stale history under the previous
 * composition's system prompt and tools. The gateway therefore compacts the
 * session — against the NEW composition, whose summarizer builds the clean
 * replacement surface — before admitting the next ordinary prompt. The claim
 * is transient (never logged): a compaction failure keeps it so the following
 * prompt retries, and concurrent prompts after one switch compact once.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type AgentFactory } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { UnknownPresetError } from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { createApiProxy } from '../src/api-proxy.ts'
import { describe, expect, it } from 'vitest'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`compact-${String(nextRpc++)}`), payload }
}

/** Order of the operations a test asserts on: compaction vs prompt admission. */
const operations: string[] = []

/** Minimal live agent: identity, session, and admission spies. */
function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    session,
    status: 'idle',
    followup: () => { operations.push('followup') },
    steer: () => { operations.push('steer') },
  } as unknown as Agent
}

/** A roster whose mount/recompose only track the composed id, per the preset spec. */
function roster(ids: readonly string[]): unknown {
  const composed = new WeakMap<Context, string>()
  return {
    defaultId: ids[0],
    list: () => Promise.resolve(ids.map(id => ({ id, trust: 'system', path: `/presets/${id}/agent.cordis.yml` }))),
    resolve: (id?: string) => {
      const wanted = id ?? ids[0] ?? ''
      if (!ids.includes(wanted)) return Promise.reject(new UnknownPresetError(wanted, ids))
      return Promise.resolve({ id: wanted, trust: 'system', path: `/presets/${wanted}/agent.cordis.yml` })
    },
    mount: (ctx: Context, id?: string) => {
      const resolved = id ?? ids[0] ?? ''
      composed.set(ctx, resolved)
      return Promise.resolve({ id: resolved, trust: 'system', path: `/presets/${resolved}/agent.cordis.yml` })
    },
    recompose: (ctx: Context, id: string) => {
      if (!ids.includes(id)) return Promise.reject(new UnknownPresetError(id, ids))
      composed.set(ctx, id)
      return Promise.resolve({ id, trust: 'system', path: `/presets/${id}.yml` })
    },
    composedPreset: (ctx: Context) => composed.get(ctx),
  }
}

/** The command registry double; `execute` behavior is set per test. */
let compactBehavior: () => Promise<unknown> = () => {
  operations.push('compact')
  return Promise.resolve({ commandId: 'cmd-1', result: { kind: 'success' } })
}
const commands = {
  execute: () => compactBehavior(),
}

async function harness(presets: readonly string[], withCommands = true) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-compact-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  ctx.provide('agentPresets', roster(presets) as never)
  if (withCommands) ctx.provide('commands', commands as never)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      await options.setup?.(agentCtx)
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd,
  })
  return { api, ctx }
}

function promptPayload(sessionId: string, text: string) {
  return request({
    sessionId: SessionId(sessionId),
    mode: 'queue' as const,
    content: [{ type: 'text' as const, text }],
  })
}

describe('auto-compact after an agent-preset switch', () => {
  it('compacts before admitting the next prompt, then clears the claim', async () => {
    operations.length = 0
    compactBehavior = () => {
      operations.push('compact')
      return Promise.resolve({ commandId: 'cmd-1', result: { kind: 'success' } })
    }
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-1'), agentPreset: 'standard' }))
    await api.agentPresets.select(request({ sessionId: SessionId('cmp-1'), agentPreset: 'minimal' }))

    const admitted = await api.sessions.prompt(promptPayload('cmp-1', 'first after switch'))

    expect(admitted.result.ok).toBe(true)
    // The compaction ran against the new composition BEFORE the message was admitted.
    expect(operations).toEqual(['compact', 'followup'])

    operations.length = 0
    const second = await api.sessions.prompt(promptPayload('cmp-1', 'second message'))

    expect(second.result.ok).toBe(true)
    // Claim cleared by the first compaction: no repeat.
    expect(operations).toEqual(['followup'])
  })

  it('does not compact a prompt that follows no switch', async () => {
    operations.length = 0
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-2'), agentPreset: 'standard' }))

    const admitted = await api.sessions.prompt(promptPayload('cmp-2', 'ordinary message'))

    expect(admitted.result.ok).toBe(true)
    expect(operations).toEqual(['followup'])
  })

  it('admits the message when the composition mounts no commands service', async () => {
    operations.length = 0
    const { api } = await harness(['standard', 'minimal'], false)
    await api.sessions.create(request({ sessionId: SessionId('cmp-3'), agentPreset: 'standard' }))
    await api.agentPresets.select(request({ sessionId: SessionId('cmp-3'), agentPreset: 'minimal' }))

    const admitted = await api.sessions.prompt(promptPayload('cmp-3', 'no command registry here'))

    // The minimal preset has no compaction service: the flag is set anyway and
    // the missing registry settles as a successful no-op.
    expect(admitted.result.ok).toBe(true)
    expect(operations).toEqual(['followup'])
  })

  it('admits the message when compaction settles as an empty-history no-op', async () => {
    operations.length = 0
    // Mirrors command-compact on a blank log: a success result, not a throw.
    compactBehavior = () => {
      operations.push('compact')
      return Promise.resolve({ commandId: 'cmd-1', result: { kind: 'success', text: 'No compactable history yet' } })
    }
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-4'), agentPreset: 'standard' }))
    await api.agentPresets.select(request({ sessionId: SessionId('cmp-4'), agentPreset: 'minimal' }))

    const admitted = await api.sessions.prompt(promptPayload('cmp-4', 'blank session prompt'))

    expect(admitted.result.ok).toBe(true)
    expect(operations).toEqual(['compact', 'followup'])
  })

  it('surfaces a compaction failure before admission and retries on the next prompt', async () => {
    operations.length = 0
    const failure = new Error('summarizer unavailable')
    compactBehavior = () => {
      operations.push('compact')
      return Promise.reject(failure)
    }
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-5'), agentPreset: 'standard' }))
    await api.agentPresets.select(request({ sessionId: SessionId('cmp-5'), agentPreset: 'minimal' }))

    await expect(api.sessions.prompt(promptPayload('cmp-5', 'will fail first'))).rejects.toThrow('summarizer unavailable')

    // The message was NOT admitted, and the claim was retained.
    expect(operations).toEqual(['compact'])

    compactBehavior = () => {
      operations.push('compact')
      return Promise.resolve({ commandId: 'cmd-2', result: { kind: 'success' } })
    }
    const retried = await api.sessions.prompt(promptPayload('cmp-5', 'retry admits'))

    expect(retried.result.ok).toBe(true)
    expect(operations).toEqual(['compact', 'compact', 'followup'])
  })

  it('compacts exactly once for two concurrent prompts after one switch', async () => {
    operations.length = 0
    compactBehavior = () => {
      operations.push('compact')
      return Promise.resolve({ commandId: 'cmd-1', result: { kind: 'success' } })
    }
    const { api } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-6'), agentPreset: 'standard' }))
    await api.agentPresets.select(request({ sessionId: SessionId('cmp-6'), agentPreset: 'minimal' }))

    const [first, second] = await Promise.all([
      api.sessions.prompt(promptPayload('cmp-6', 'one')),
      api.sessions.prompt(promptPayload('cmp-6', 'two')),
    ])

    expect(first.result.ok).toBe(true)
    expect(second.result.ok).toBe(true)
    expect(operations.filter(operation => operation === 'compact')).toHaveLength(1)
    expect(operations.filter(operation => operation === 'followup')).toHaveLength(2)
  })

  it('still refuses a switch while the agent is running a turn', async () => {
    operations.length = 0
    const { api, ctx } = await harness(['standard', 'minimal'])
    await api.sessions.create(request({ sessionId: SessionId('cmp-7'), agentPreset: 'standard' }))
    const agent = ctx.agents.get(SessionId('cmp-7'))
    if (agent === undefined) throw new Error('unreachable')
    Object.defineProperty(agent, 'status', { configurable: true, get: () => 'running' })

    const response = await api.agentPresets.select(request({ sessionId: SessionId('cmp-7'), agentPreset: 'minimal' }))

    expect(response.result.ok).toBe(false)
    if (response.result.ok) throw new Error('unreachable')
    expect(response.result.error.code).toBe('agent-preset-locked')
    // No commit, no claim: the next prompt is admitted without compacting.
    Object.defineProperty(agent, 'status', { configurable: true, get: () => 'idle' })
    const admitted = await api.sessions.prompt(promptPayload('cmp-7', 'after rejected switch'))
    expect(admitted.result.ok).toBe(true)
    expect(operations).toEqual(['followup'])
  })
})
