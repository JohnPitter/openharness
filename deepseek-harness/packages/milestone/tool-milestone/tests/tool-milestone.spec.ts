import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { type Agent } from '@deepseek-ai/dsh-agent'

import * as tool from '../src/index.ts'
import { foldMilestoneTitles, renderMilestoneIndex } from '../src/fold.ts'

const testToolSignal = new AbortController().signal

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(b => b.type === 'text').map(b => b.text).join('')
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool)
  return ctx
}

let callCounter = 0
function callMilestone(
  ctx: Context,
  args: unknown,
  agent: Agent,
) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`call-${++callCounter}`),
    name: 'milestone_write',
    arguments: args,
    agent,
  })
}

describe('dsh-tool-milestone', () => {
  it('registers milestone_write with title, body, and optional anchorSeq', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'milestone_write')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['anchorSeq', 'body', 'title'])
  })

  it('appends an append-only milestone/write to the calling session', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('writer'))
    const agent = { id: session.id, session } as unknown as Agent
    const result = await callMilestone(ctx, { title: '  Root cause  ', body: '  Null deref in parse.  ' }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected milestone_write success')
    expect(result.value).toEqual({
      milestoneId: expect.any(String),
      title: 'Root cause',
    })
    expect(text(result)).toBe('Wrote milestone: Root cause')

    const event = session.events.findLast(e => e.type === 'milestone/write')!
    expect(event.data.title).toBe('Root cause')
    expect(event.data.body).toBe('Null deref in parse.')
    expect(event.data.origin).toBe('session')
    expect(event.data.childSessionId).toBeUndefined()

    await callMilestone(ctx, { title: 'Fix landed', body: 'Guard the parser.' }, agent)
    expect(foldMilestoneTitles(session)).toEqual(['Root cause', 'Fix landed'])
  })

  it('mirrors a child write onto a live parent and still succeeds when the parent is absent', async () => {
    const ctx = await setup()
    const parent = ctx.sessions.create(SessionId('parent'))
    const child = ctx.sessions.create(SessionId('child'), { meta: { parentSession: parent.id } })
    const agent = { id: child.id, session: child } as unknown as Agent
    const result = await callMilestone(ctx, { title: 'Worker finding', body: 'The leak is in fold.' }, agent)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected child write success')

    const childEvent = child.events.findLast(e => e.type === 'milestone/write')!
    const parentEvent = parent.events.findLast(e => e.type === 'milestone/write')!
    expect(childEvent.data.origin).toBe('session')
    expect(parentEvent.data.milestoneId).toBe(childEvent.data.milestoneId)
    expect(parentEvent.data.origin).toBe('worker')
    expect(parentEvent.data.childSessionId).toBe(child.id)
    expect(foldMilestoneTitles(parent)).toEqual(['Worker finding'])

    const orphan = ctx.sessions.create(SessionId('orphan'), { meta: { parentSession: SessionId('missing') } })
    const orphanAgent = { id: orphan.id, session: orphan } as unknown as Agent
    const orphaned = await callMilestone(ctx, { title: 'Still recorded', body: 'Parent was offline.' }, orphanAgent)
    expect(orphaned.isError).toBe(false)
    expect(foldMilestoneTitles(orphan)).toEqual(['Still recorded'])
  })

  it('rejects empty title, oversized body, and a non-agent caller', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('invalid'))
    const agent = { id: session.id, session } as unknown as Agent
    const empty = await callMilestone(ctx, { title: '   ', body: 'x' }, agent)
    expect(empty.isError).toBe(true)
    expect(text(empty)).toContain('`title` must be a non-empty string')

    const long = await callMilestone(ctx, { title: 'ok', body: 'x'.repeat(4001) }, agent)
    expect(long.isError).toBe(true)
    expect(text(long)).toContain('`body` must be at most 4000 characters')

    const longTitle = await callMilestone(ctx, { title: 't'.repeat(161), body: 'ok' }, agent)
    expect(longTitle.isError).toBe(true)
    expect(text(longTitle)).toContain('`title` must be at most 160 characters')

    const badAnchor = await callMilestone(ctx, { title: 'ok', body: 'ok', anchorSeq: -1 }, agent)
    expect(badAnchor.isError).toBe(true)
    expect(text(badAnchor)).toContain('`anchorSeq` must be a non-negative integer')

    const unsafe = await callMilestone(ctx, { title: 'ok', body: 'ok', anchorSeq: Number.MAX_SAFE_INTEGER + 1 }, agent)
    expect(unsafe.isError).toBe(true)
    expect(text(unsafe)).toContain('`anchorSeq` must be a non-negative integer')

    const noAgent = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('no-agent'),
      name: 'milestone_write',
      arguments: { title: 'x', body: 'y' },
    })
    expect(noAgent.isError).toBe(true)
    expect(text(noAgent)).toContain('requires an owning agent session')
  })

  it('renders an empty index as an empty snapshot', () => {
    expect(renderMilestoneIndex([])).toBe('')
    expect(renderMilestoneIndex(['Root cause', 'Fix landed'])).toBe(
      'Milestones recorded in this session:\n- Root cause\n- Fix landed',
    )
  })

  it('exposes titles through the milestone:index runtime context', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('indexed'))
    const agent = { id: session.id, session, ctx } as unknown as Agent
    expect((await ctx.systemPrompt.assemble({ agent })).contexts.find(entry => entry.name === 'milestone:index')?.text)
      .toBe('')
    await callMilestone(ctx, { title: 'Indexed', body: 'Visible to later turns.' }, agent)
    expect((await ctx.systemPrompt.assemble({ agent })).contexts.find(entry => entry.name === 'milestone:index')?.text)
      .toBe('Milestones recorded in this session:\n- Indexed')
    expect((await ctx.systemPrompt.assemble()).contexts.find(entry => entry.name === 'milestone:index')?.text)
      .toBe('')
  })

  it('presents the call with a stable title and the args as raw input', async () => {
    const ctx = await setup()
    const def = ctx.tools.get('milestone_write')!
    const args = { title: 'Root cause', body: 'Null deref.' }
    expect(def.presentCall?.(args)).toEqual({
      card: 'generic', title: 'Record milestone', kind: 'other', rawInput: args,
    })
  })

  it('unregisters the tool when its contributing fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool)
    expect(ctx.tools.schemas().some(s => s.name === 'milestone_write')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'milestone_write')).toBe(false)
  })

  it('skips non-milestone events when folding titles', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('mixed'))
    session.append('turn/start', { turn: 1 })
    const agent = { id: session.id, session } as unknown as Agent
    await callMilestone(ctx, { title: 'Kept', body: 'Among other events.', anchorSeq: 1 }, agent)
    expect(foldMilestoneTitles(session)).toEqual(['Kept'])
  })
})
