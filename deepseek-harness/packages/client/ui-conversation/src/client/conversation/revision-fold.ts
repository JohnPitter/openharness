/**
 * Same-session latest-message revision folding for the conversation feed.
 * A durable `session/revision` cut hides its `[anchorSeq, throughSeq]`
 * interval from every active projection and carries the replacement user
 * message, which the conversation surfaces as an ordinary `user/message`
 * at the revision's own seq. The raw log stays intact: folding is a view
 * over the loaded window, recomputed whenever the window changes.
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Whether one window entry is a durable revision cut. */
export function isRevisionEntry(entry: SessionEventLikeEntry): boolean {
  return entry.type === 'event' && entry.event.type === 'session/revision'
}

/**
 * Fold every revision cut present in the loaded window.
 * @param entries - window entries in seq order.
 * @returns the same array when no cut is loaded; otherwise the active entries,
 * each surviving cut rewritten as the replacement `user/message`.
 */
export function foldRevisionEntries(entries: readonly SessionEventLikeEntry[]): readonly SessionEventLikeEntry[] {
  const cuts: { readonly seq: number; readonly anchorSeq: number; readonly throughSeq: number }[] = []
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event.type !== 'session/revision') continue
    const { anchorSeq, throughSeq } = entry.event.data
    cuts.push({ seq: entry.event.seq, anchorSeq, throughSeq })
  }
  if (cuts.length === 0) return entries
  const hidden = (seq: number): boolean =>
    cuts.some(cut => cut.seq !== seq && seq >= cut.anchorSeq && seq <= cut.throughSeq)
  const folded: SessionEventLikeEntry[] = []
  for (const entry of entries) {
    if (hidden(entry.event.seq)) continue
    if (entry.type === 'event' && entry.event.type === 'session/revision') {
      const replacement = {
        type: 'user/message',
        seq: entry.event.seq,
        time: entry.event.time,
        data: entry.event.data.replacement,
        surfaceOp: 'append',
      } as unknown as SessionEvent
      folded.push({ type: 'event', event: replacement })
      continue
    }
    folded.push(entry)
  }
  return folded
}
