import { deriveEventMessage, isSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type { TokenSurfaceNode } from './types.ts'
import { estimateMessage } from './estimate.ts'

/** Pending compaction shadow price, retained for producer consistency checks. */
export interface ShadowPriceClaim {
  start: number
  end: number
  tokens: number
}

/** State needed to fold the active surface without token drift on cuts. */
export interface SurfaceProjectionState {
  readonly nodes: readonly TokenSurfaceNode[]
  readonly claim: ShadowPriceClaim | undefined
}

/** One event's exact effect on the active surface token total. */
export interface SurfaceTokensFold {
  readonly deltaTokens: number
  readonly claim: ShadowPriceClaim | undefined
  readonly nodes: TokenSurfaceNode[]
}

/**
 * Fold one committed event while retaining the active priced nodes. This is
 * intentionally indexed by surface node rather than approximating a cut with
 * the replacement price: repeated and overlapping revisions must subtract each
 * currently active shadowed contribution exactly once.
 * @param state - active priced nodes and adjacent shadow-price claim.
 * @param event - next committed session event.
 * @returns the next state and signed token delta.
 */
export function foldSurfaceProjection(
  state: SurfaceProjectionState,
  event: SessionEvent,
): SurfaceTokensFold {
  if (event.type === 'compaction/summary' || event.type === 'compaction/prune') {
    const { shadowedRange, shadowedTokenCount } = event.data
    return {
      deltaTokens: 0,
      nodes: [...state.nodes],
      claim: { start: shadowedRange.start, end: shadowedRange.end, tokens: shadowedTokenCount },
    }
  }
  if (!isSurfaceEvent(event)) return { deltaTokens: 0, nodes: [...state.nodes], claim: undefined }
  const message = deriveEventMessage(event)
  const tokens = message === null ? 0 : estimateMessage(message)
  const node = { seq: event.seq, tokens }
  const op = event.surfaceOp
  if (op === 'append') return { deltaTokens: tokens, nodes: [...state.nodes, node], claim: undefined }
  if (op.op === 'cut') {
    const removed = state.nodes
      .filter(item => item.seq >= op.anchorSeq && item.seq <= op.throughSeq)
      .reduce((total, item) => total + item.tokens, 0)
    const nodes = state.nodes.filter(item => item.seq < op.anchorSeq || item.seq > op.throughSeq)
    nodes.push(node)
    return { deltaTokens: tokens - removed, nodes, claim: undefined }
  }
  if (state.claim !== undefined && (state.claim.start !== op.start || state.claim.end !== op.end)) {
    throw new Error(`token surface: replace at seq ${event.seq} over range ${op.start}-${op.end} has no adjacent shadow price`)
  }
  const start = state.nodes.findIndex(item => item.seq === op.start)
  const end = state.nodes.findIndex(item => item.seq === op.end)
  if (start < 0 || end < start) {
    if (state.claim === undefined) return { deltaTokens: 0, nodes: [...state.nodes], claim: undefined }
    throw new Error(`token surface: replace at seq ${event.seq} has invalid current range ${op.start}-${op.end}`)
  }
  const removed = state.nodes.slice(start, end + 1).reduce((total, item) => total + item.tokens, 0)
  const nodes = [...state.nodes]
  nodes.splice(start, end - start + 1, node)
  return { deltaTokens: tokens - removed, nodes, claim: undefined }
}
