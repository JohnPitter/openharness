import type { Context } from '@deepseek-ai/cordis'
import type {
  CompactionSummaryNode, ConversationMatch, ConversationNodeContext, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-compaction/types'
import { chatNode } from './common.ts'
import { compactSource, compactSummary, runningCompaction, updateCompactionState } from './command.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Automatic compaction checkpoint marker. */
    compaction: CompactionSummaryNode
  }
}

interface CompactionState {
  readonly start?: ConversationMatch
  readonly summary?: ConversationMatch
  readonly checkpoint?: ConversationMatch
  readonly ended?: boolean
}

function fallbackState(context: ConversationNodeContext<CompactionState>): CompactionState {
  const start = context.matches.find(match => match.event.type === 'compaction/start')
  const summary = context.matches.find(match => match.event.type === 'compaction/summary')
  const checkpoint = context.matches.find(match => compactSource(match.event) !== undefined)
  const ended = context.matches.some(match => match.event.type === 'compaction/end')
  return {
    ...start === undefined ? {} : { start },
    ...summary === undefined ? {} : { summary },
    ...checkpoint === undefined ? {} : { checkpoint },
    ...ended ? { ended: true } : {},
  }
}

/** Automatic compaction lifecycle and landed checkpoint Definition. */
export const compactionDefinition: ConversationNodeDefinition<CompactionState> = {
  kind: 'compaction',
  target: 'chat',
  match: (event) => {
    const checkpoint = compactSource(event)
    if (checkpoint !== undefined && checkpoint.sourceCommandId === undefined) {
      return { id: checkpoint.compactionId, role: 'update' }
    }
    if (event.type === 'compaction/start'
      || event.type === 'compaction/summary'
      || event.type === 'compaction/end') {
      if (event.data.sourceCommandId !== undefined) return null
      const compactionId: unknown = event.data.compactionId
      if (typeof compactionId !== 'string' || compactionId === '') return null
      return { id: compactionId, role: event.type === 'compaction/start' ? 'start' : 'update' }
    }
    return null
  },
  start: (_context, match) => updateCompactionState({}, match),
  update: (context, match) => updateCompactionState(context.state, match),
  buildViewNode: (context) => {
    const state = context.state ?? fallbackState(context)
    if (state.checkpoint !== undefined) {
      const marker = compactSummary(state.summary, state.checkpoint)
      return chatNode(context, 'compaction', marker.seq, marker)
    }
    if (state.start === undefined) return null
    const marker = runningCompaction(state.start)
    return chatNode(
      context,
      'compaction',
      marker.seq,
      marker,
      { visibility: state.ended === true ? 'hidden' : 'visible' },
    )
  },
}

/**
 * Register the automatic-compaction business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerCompactionConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(compactionDefinition)
}
