/**
 * OpenHarness Session commands ported from the deleted apiproxy: same-session
 * latest-message revision (`session.revise`), permanent delete with
 * origin-subagent descendants (`session.delete`), and the one compaction a
 * committed preset switch owes before the next prompt.
 */
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, UserMessage } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { ApiSessionAgentController } from '../src/agent.ts'
import { SessionCommandController } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'
import { createInboxStub } from '@deepseek-ai/dsh-agent-loop-testkit'
import { installSessionReadTestServices } from './test-remote.ts'

async function harness(options: { status?: 'idle' | 'running'; stored?: SessionHeader[] } = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(TypertRegistry)
  installSessionReadTestServices(ctx)
  const session = ctx.sessions.create(SessionId('oh-session'), { meta: { cwd: '/workspace' } })
  const followupCommitted = vi.fn()
  const followup = vi.fn()
  const cancel = vi.fn()
  const agent = {
    id: session.id,
    options: { provider: 'fixture', model: 'fixture-model' },
    whenIdle: vi.fn(() => Promise.resolve()),
    runMaintenance: async () => { throw new Error('unexpected maintenance') },
    send: vi.fn(),
    inject: vi.fn(),
    session,
    model: { current: () => undefined, select: vi.fn() } as unknown as Agent['model'],
    inbox: createInboxStub(),
    status: options.status ?? 'idle',
    ctx,
    steer: vi.fn(),
    followup,
    followupCommitted,
    cancel,
  } satisfies Agent
  await ctx.agents.register(agent)
  const forgotten: SessionId[] = []
  ctx.provide('workspaceRegistry', {
    get: () => undefined,
    list: () => [],
    forgetSession: (id: SessionId) => { forgotten.push(id); return Promise.resolve() },
  } as never)
  const stored = [...options.stored ?? []]
  const deleted: SessionId[] = []
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve(stored.map(header => ({ header, revision: 'r' }))),
    delete: (id: SessionId) => { deleted.push(id); return Promise.resolve() },
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    saveSelection: () => Promise.resolve(),
  } as never)
  ctx.provide('attachments', { admitPromptContent: (content: unknown[]) => Promise.resolve(content) } as never)
  ctx.provide('fileUploads', {
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
  } as never)
  const agents = new ApiSessionAgentController(ctx)
  vi.spyOn(agents, 'resolveAgent').mockImplementation(id => Promise.resolve(id === agent.id
    ? { agent }
    : { error: new RemoteError('session/not-found', 'missing', { sessionId: id }) }))
  return { ctx, controller: new SessionCommandController(ctx, agents, '/workspace'), agent, session, followupCommitted, followup, deleted, forgotten }
}

function completedTurn(session: Agent['session'], text: string): UserMessage {
  session.append('turn/start', { turn: 1 })
  const message = createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
  session.append('user/message', message, { surfaceOp: 'append' })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return message
}

describe('session.revise', () => {
  it('commits one durable cut and dispatches the replacement exactly once per operation id', async () => {
    const { controller, agent, session, followupCommitted } = await harness()
    const original = completedTurn(session, 'old text')
    const request = {
      sessionId: agent.id, operationId: 'op-1', anchorSeq: 1, anchorMessageId: original.id,
      content: [{ type: 'text' as const, text: 'new text' }],
    }
    const first = await controller.revise(request, new AbortController().signal)
    expect(first).toMatchObject({ revision: 1, operationId: 'op-1' })
    expect(followupCommitted).toHaveBeenCalledOnce()
    const retried = await controller.revise(request, new AbortController().signal)
    expect(retried).toEqual(first)
    expect(followupCommitted).toHaveBeenCalledOnce()
    expect(session.snapshotEvents().filter(event => event.type === 'session/revision')).toHaveLength(1)
    expect(session.deriveMessages().map(message => message.content)).toEqual([[{ type: 'text', text: 'new text' }]])
  })

  it('refuses a stale anchor, whitespace content, and a running session', async () => {
    const { controller, agent, session } = await harness()
    const original = completedTurn(session, 'old')
    const signal = new AbortController().signal
    await expect(controller.revise({
      sessionId: agent.id, operationId: 'op', anchorSeq: 0, anchorMessageId: original.id,
      content: [{ type: 'text', text: 'x' }],
    }, signal)).rejects.toMatchObject({ code: 'session/revision-anchor-stale' })
    await expect(controller.revise({
      sessionId: agent.id, operationId: 'op', anchorSeq: 1, anchorMessageId: original.id,
      content: [{ type: 'text', text: '   ' }],
    }, signal)).rejects.toMatchObject({ code: 'gateway/bad-request' })
    const running = await harness({ status: 'running' })
    const message = completedTurn(running.session, 'old')
    await expect(running.controller.revise({
      sessionId: running.agent.id, operationId: 'op', anchorSeq: 1, anchorMessageId: message.id,
      content: [{ type: 'text', text: 'x' }],
    }, signal)).rejects.toMatchObject({ code: 'session/active' })
  })
})

describe('session.delete', () => {
  it('deletes origin-subagent descendants first, then the root, and forgets workspace bookkeeping', async () => {
    const root = SessionId('oh-cold-root')
    const child = SessionId('oh-cold-root-child')
    const grandchild = SessionId('oh-cold-root-grandchild')
    const fork = SessionId('oh-cold-root-fork')
    const header = (id: SessionId, extra: Partial<SessionHeader> = {}): SessionHeader =>
      ({ version: SESSION_FORMAT_VERSION, id, createdAt: 1, cwd: '/workspace', isSeeded: false, ...extra })
    const { ctx, controller, deleted, forgotten } = await harness({
      stored: [
        header(root),
        header(child, { parentSession: root, origin: 'subagent' }),
        header(grandchild, { parentSession: child, origin: 'subagent' }),
        // An ordinary fork is a peer Session and survives.
        header(fork, { parentSession: root }),
      ],
    })
    const emitted: SessionId[] = []
    ctx.on('api-session/deleted', (id) => { emitted.push(id) })
    expect(await controller.delete({ sessionId: root })).toEqual({ deleted: true, sessionIds: [grandchild, child, root] })
    expect(deleted).toEqual([grandchild, child, root])
    expect(forgotten).toEqual([grandchild, child, root])
    expect(emitted).toEqual([grandchild, child, root])
  })

  it('refuses an unknown id and a subagent-owned id', async () => {
    const child = SessionId('oh-child')
    const { controller } = await harness({
      stored: [{ version: SESSION_FORMAT_VERSION, id: child, createdAt: 1, cwd: '/workspace', isSeeded: false, parentSession: SessionId('oh-session'), origin: 'subagent' }],
    })
    await expect(controller.delete({ sessionId: SessionId('missing') })).rejects.toMatchObject({ code: 'session/not-found' })
    await expect(controller.delete({ sessionId: child })).rejects.toMatchObject({ code: 'session/agent-busy' })
  })

  it('refuses a live Session it does not own', async () => {
    const { controller, agent } = await harness()
    await expect(controller.delete({ sessionId: agent.id })).rejects.toMatchObject({ code: 'session/agent-busy' })
  })
})

describe('preset-switch compaction', () => {
  let nextRequest = 1
  const prompt = (sessionId: SessionId) => ({
    requestId: `oh-${String(nextRequest++)}` as SessionRequestId,
    sessionId,
    mode: 'queue' as const,
    content: [{ type: 'text' as const, text: 'next' }],
  })

  it('compacts once before the next prompt after a started Session switches preset', async () => {
    const { ctx, controller, agent, session, followup } = await harness()
    completedTurn(session, 'first')
    const execute = vi.fn((_sessionId: SessionId, _command: string) => Promise.resolve({ commandId: 'c', result: { kind: 'success' } }))
    ctx.provide('commands', { execute } as never)
    controller.presetSwitched(agent.id)
    await Promise.all([
      controller.prompt(prompt(agent.id), { kind: 'user' }),
      controller.prompt(prompt(agent.id), { kind: 'user' }),
    ])
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[1]).toBe('/compact')
    expect(followup).toHaveBeenCalledTimes(2)
    await controller.prompt(prompt(agent.id), { kind: 'user' })
    expect(execute).toHaveBeenCalledOnce()
  })

  it('skips a blank Session and retries after a failed compaction', async () => {
    const { ctx, controller, agent, session, followup } = await harness()
    const execute = vi.fn()
      .mockRejectedValueOnce(new Error('summarizer offline'))
      .mockResolvedValue({ commandId: 'c', result: { kind: 'success' } })
    ctx.provide('commands', { execute } as never)
    controller.presetSwitched(agent.id)
    await controller.prompt(prompt(agent.id), { kind: 'user' })
    expect(execute).not.toHaveBeenCalled()
    completedTurn(session, 'first')
    controller.presetSwitched(agent.id)
    await expect(controller.prompt(prompt(agent.id), { kind: 'user' })).rejects.toMatchObject({ code: 'session/agent-busy' })
    await controller.prompt(prompt(agent.id), { kind: 'user' })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(followup).toHaveBeenCalledTimes(2)
  })
})
