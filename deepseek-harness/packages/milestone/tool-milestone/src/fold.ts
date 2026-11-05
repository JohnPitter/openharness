/**
 * Pure milestone-title fold and its host-only Session projection.
 *
 * @module @deepseek-ai/dsh-tool-milestone/fold
 */

import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from './types.ts'

/** Host-only projection key holding recorded milestone titles in log order. */
export const MILESTONE_TITLES_PROJECTION_KEY = 'milestoneTitles'

/**
 * Advance the title index by one committed event.
 * @param state - titles covering every prior event.
 * @param event - next committed session event.
 * @returns the same reference unless the event is a `milestone/write`.
 */
export function applyMilestoneTitles(state: readonly string[], event: SessionEvent): readonly string[] {
  return event.type === 'milestone/write' ? [...state, event.data.title] : state
}

/**
 * Collect milestone titles in log order from an explicit event sequence.
 * @param events - committed events to fold.
 * @returns titles from every `milestone/write` event.
 */
export function foldMilestoneTitles(events: Iterable<SessionEvent>): string[] {
  let titles: readonly string[] = []
  for (const event of events) titles = applyMilestoneTitles(titles, event)
  return [...titles]
}

const titlesSchema: ZodType<readonly string[]> = zod.array(zod.string()).readonly()

/**
 * Host-only Session projection of recorded milestone titles. Registrants
 * sharing this exact definition share one ref-counted unit, so the tool and
 * compaction can both read the index without rescanning the log.
 */
export const milestoneTitlesProjection = {
  key: MILESTONE_TITLES_PROJECTION_KEY,
  stateSchema: titlesSchema,
  init: (): readonly string[] => [],
  apply: applyMilestoneTitles,
  stateVersion: 1,
} as const

/**
 * Model-facing runtime-context body for the current milestone index.
 * @param titles - folded titles in log order.
 * @returns snapshot text, or `''` when the session has no milestones.
 */
export function renderMilestoneIndex(titles: readonly string[]): string {
  if (titles.length === 0) return ''
  return `Milestones recorded in this session:\n${titles.map(title => `- ${title}`).join('\n')}`
}
