/**
 * Host admission refuses whitespace-only prompts and queue edits while still
 * accepting image-only prompts.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`empty-${String(nextRpc++)}`), payload }
}

async function liveProxy() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const session = ctx.sessions.create(sid('session-empty-prompt'), { meta: { cwd: '/proj' } })
  const followup = vi.fn()
  const replace = vi.fn()
  const queued = createUserMessage({ content: [{ type: 'text', text: 'queued' }], source: { kind: 'user' } })
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    ctx,
    followup,
    inbox: {
      nextTurn: [queued],
      nextStep: [],
      replace,
      remove: vi.fn(),
    },
  } as unknown as Agent
  ctx.agents.register(agent)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { ctx, api, agent, followup, replace, queued }
}

describe('session.prompt empty content', () => {
  it('rejects whitespace-only and empty text before admission', async () => {
    const { api, followup } = await liveProxy()
    const whitespace = await api.sessions.prompt(request({
      sessionId: sid('session-empty-prompt'),
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '  \n\t' }],
    }))
    expect(whitespace.result.ok).toBe(false)
    if (!whitespace.result.ok) {
      expect(whitespace.result.error).toMatchObject({
        code: 'bad-request',
        message: 'prompt content must include non-whitespace text or an attachment',
      })
    }

    const blank = await api.sessions.prompt(request({
      sessionId: sid('session-empty-prompt'),
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '' }],
    }))
    expect(blank.result.ok).toBe(false)
    if (!blank.result.ok) expect(blank.result.error.code).toBe('bad-request')
    expect(followup).not.toHaveBeenCalled()
  })

  it('does not treat image-only or whitespace-plus-image content as empty', async () => {
    const { api } = await liveProxy()

    const imageOnly = await api.sessions.prompt(request({
      sessionId: sid('session-empty-prompt'),
      mode: 'queue' as const,
      content: [{ type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' }],
    }))
    if (!imageOnly.result.ok) {
      expect(imageOnly.result.error.message).not.toBe(
        'prompt content must include non-whitespace text or an attachment',
      )
    }

    const mixed = await api.sessions.prompt(request({
      sessionId: sid('session-empty-prompt'),
      mode: 'queue' as const,
      content: [
        { type: 'text' as const, text: '   ' },
        { type: 'image' as const, mediaType: 'image/png' as const, data: 'AQ==' },
      ],
    }))
    if (!mixed.result.ok) {
      expect(mixed.result.error.message).not.toBe(
        'prompt content must include non-whitespace text or an attachment',
      )
    }
  })
})

describe('session.updateQueue empty edits', () => {
  it('rejects whitespace-only queue edits before mutating the inbox', async () => {
    const { api, replace, queued } = await liveProxy()
    const empty = await api.sessions.updateQueue(request({
      sessionId: sid('session-empty-prompt'),
      itemId: queued.id,
      action: { kind: 'edit' as const, content: [{ type: 'text' as const, text: ' \n' }] },
    }))
    expect(empty.result.ok).toBe(false)
    if (!empty.result.ok) {
      expect(empty.result.error).toMatchObject({
        code: 'bad-request',
        message: 'queue edit content must include non-whitespace text',
      })
    }
    expect(replace).not.toHaveBeenCalled()
  })

  it('applies a non-empty text queue edit', async () => {
    const { api, replace, queued } = await liveProxy()
    const edited = await api.sessions.updateQueue(request({
      sessionId: sid('session-empty-prompt'),
      itemId: queued.id,
      action: { kind: 'edit' as const, content: [{ type: 'text' as const, text: 'revised' }] },
    }))
    expect(edited.result.ok).toBe(true)
    expect(replace).toHaveBeenCalledOnce()
    expect(replace.mock.calls[0]?.[0]).toBe(queued.id)
  })
})
