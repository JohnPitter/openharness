/**
 * Model-facing append-only milestone_write. Each call appends a `milestone/write`
 * event to the calling agent's session and, when that session has a live parent,
 * mirrors the same identity onto the parent log. Named exports preserve loader
 * injection metadata.
 * @module @deepseek-ai/dsh-tool-milestone
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import { MilestoneId } from './brand.ts'
import { foldMilestoneTitles, renderMilestoneIndex } from './fold.ts'
import type { MilestoneWriteData } from './types.ts'

export type * from './types.ts'
export { MilestoneId } from './brand.ts'
export { foldMilestoneTitles, renderMilestoneIndex } from './fold.ts'

export const name = 'tool-milestone'
export const inject = ['tools', 'systemPrompt']

/** Maximum stored title length after trim. */
export const MILESTONE_TITLE_MAX = 160
/** Maximum stored body length after trim. */
export const MILESTONE_BODY_MAX = 4000

const DESCRIPTION
  = 'Record a durable session milestone when a finding, decision, or fix closes. '
    + 'Call it in the same tool step as the work that produced the fact — do not '
    + 'open a new turn only to write the milestone. Title is the one-line label '
    + 'the human and later model turns use as an index; body is the recorded fact. '
    + 'Do not use this for a task checklist (that is todo_write).'

/**
 * Trim and bound one milestone field.
 * @param value - model-supplied text.
 * @param label - field name used in rejection text.
 * @param max - inclusive character cap after trim.
 * @returns the stored text.
 */
function boundText(value: string, label: string, max: number): string {
  const text = value.trim()
  if (text.length === 0) {
    throw new Error(`invalid milestone: \`${label}\` must be a non-empty string`)
  }
  if (text.length > max) {
    throw new Error(`invalid milestone: \`${label}\` must be at most ${max} characters`)
  }
  return text
}

/**
 * Append one milestone to a session log.
 * @param session - owning log.
 * @param data - already-validated payload.
 */
function appendMilestone(session: Session, data: MilestoneWriteData): void {
  session.append('milestone/write', data)
}

/**
 * Register `milestone_write` and the titles-only runtime-context index.
 * @param ctx - registrant context carrying tools and system prompt.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.context({
    name: 'milestone:index',
    order: 125,
    text: (context) => {
      const agent = context.agent
      if (agent === undefined) return ''
      return renderMilestoneIndex(foldMilestoneTitles(agent.session))
    },
  })

  ctx.tools.register(defineTool({
    name: 'milestone_write',
    description: DESCRIPTION,
    parameters: {
      title: {
        type: 'string',
        required: true,
        description: 'One-line label for the rail and the model-visible index.',
      },
      body: {
        type: 'string',
        required: true,
        description: 'The recorded finding, decision, or fix.',
      },
      anchorSeq: {
        type: 'integer',
        description: 'Session seq this fact is about, when known.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          milestoneId: { type: 'string', required: true },
          title: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Wrote milestone: ${value.title}`,
      }],
    },
    execute(args, exec) {
      const title = boundText(args.title, 'title', MILESTONE_TITLE_MAX)
      const body = boundText(args.body, 'body', MILESTONE_BODY_MAX)
      const anchorSeq = args.anchorSeq
      if (anchorSeq !== undefined && (!Number.isSafeInteger(anchorSeq) || anchorSeq < 0)) {
        throw new Error('invalid milestone: `anchorSeq` must be a non-negative integer')
      }
      if (!exec.agent) {
        throw new Error('milestone_write requires an owning agent session')
      }
      const milestoneId = MilestoneId(randomUUID())
      const session = exec.agent.session
      const payload: MilestoneWriteData = {
        milestoneId,
        title,
        body,
        origin: 'session',
        ...anchorSeq === undefined ? {} : { anchorSeq },
      }
      appendMilestone(session, payload)
      const parentId = session.header.parentSession
      if (parentId !== undefined) {
        const parent = ctx.get('sessions')?.get(parentId)
        if (parent !== undefined) {
          appendMilestone(parent, {
            ...payload,
            origin: 'worker',
            childSessionId: session.id,
          })
        }
      }
      return Promise.resolve({ milestoneId, title })
    },
    presentCall: args => ({ card: 'generic', title: 'Record milestone', kind: 'other', rawInput: args }),
  }))
}
