import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-tool-milestone/client'
import type { MilestoneChatData } from '../contract/chat-nodes.ts'
import { chatNode } from './common.ts'

declare module '../contract/chat-nodes.ts' {
  interface ChatNodeDataMap {
    /** Append-only session milestone. */
    milestone: MilestoneChatData
  }
}

/** One `milestone/write` becomes one Chat Node keyed by the branded milestone id. */
export const milestoneDefinition: ConversationNodeDefinition<MilestoneChatData> = {
  kind: 'milestone',
  target: 'chat',
  match: (event) => {
    if (event.type !== 'milestone/write') return null
    const milestoneId = event.data.milestoneId
    if (typeof milestoneId !== 'string' || milestoneId === '') return null
    return { id: milestoneId, role: 'start' }
  },
  start: (_context, match) => {
    if (match.event.type !== 'milestone/write') throw new Error('milestone start requires milestone/write')
    const data = match.event.data
    return {
      seq: match.event.seq,
      time: match.event.time,
      title: data.title,
      body: data.body,
      origin: data.origin,
    }
  },
  update: context => context.state,
  buildViewNode: (context) => {
    if (context.state === undefined) return null
    // A milestone closes work: it stays outside the folded Turn process so the
    // transcript chip and its rail waypoint remain reachable after folding.
    return chatNode(context, 'milestone', context.state.seq, context.state, { groupTree: 'turn' })
  },
}

/**
 * Register the milestone conversation contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerMilestoneConversationNode(ctx: Context): void {
  ctx.uiConversation.events.register(milestoneDefinition)
}
