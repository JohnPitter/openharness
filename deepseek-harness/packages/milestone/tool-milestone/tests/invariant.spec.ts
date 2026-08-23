import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as MilestoneInvariant from '@deepseek-ai/dsh-tool-milestone/invariant'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { MilestoneId } from '../src/brand.ts'
import type {} from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(MilestoneInvariant)
  return ctx
}

function event(data: unknown): SessionEvent {
  return { type: 'milestone/write', seq: 0, time: 0, data } as SessionEvent
}

const valid = {
  milestoneId: MilestoneId('m-1'),
  title: 'Root cause',
  body: 'Null deref in parse.',
  origin: 'session' as const,
}

describe('milestone write invariants', () => {
  it('accepts a well-formed live append', async () => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, event(valid)) }).not.toThrow()
    expect(() => {
      ctx.emit('session/event', {} as Session, event({
        ...valid, origin: 'worker', childSessionId: 'child-1',
      }))
    }).not.toThrow()
  })

  it.each([
    [{ ...valid, milestoneId: '' }, /milestoneId must be a non-empty string/],
    [{ ...valid, title: ' padded ' }, /already trimmed/],
    [{ ...valid, body: '' }, /body must be non-empty/],
    [{ ...valid, origin: 'mirror' }, /unknown origin/],
    [{ ...valid, origin: 'worker' }, /must name the child session/],
    [{ ...valid, childSessionId: 'child-1' }, /must not name a child session/],
    [{ ...valid, anchorSeq: -1 }, /anchorSeq must be a non-negative integer/],
    [null, /payload must be an object/],
    [{ ...valid, title: 't'.repeat(161) }, /title must be at most 160/],
    [{ ...valid, body: 'b'.repeat(4001) }, /body must be at most 4000/],
  ])('rejects an incoherent durable milestone', async (data, message) => {
    const ctx = await setup()
    expect(() => { ctx.emit('session/event', {} as Session, event(data)) }).toThrow(message)
  })

  it('ignores unrelated dispatches and session events', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.emit('session/event', {} as Session, {
        type: 'turn/start', seq: 0, time: 0, data: { turn: 1 },
      })
    }).not.toThrow()
  })

  it('rejects an invalid existing record on late registration', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    ctx.sessions.create().append('milestone/write', {
      milestoneId: MilestoneId('late'),
      title: 'ok',
      body: 'ok',
      origin: 'mirror',
    } as never)
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(MilestoneInvariant).then(() => undefined)).rejects.toThrow(/unknown origin/)
  })
})
