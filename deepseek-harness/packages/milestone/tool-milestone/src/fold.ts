/**
 * Pure fold of recorded milestone titles from a session log.
 *
 * @module @deepseek-ai/dsh-tool-milestone/fold
 */

import type { Session } from '@deepseek-ai/dsh-session'
import type {} from './types.ts'

/**
 * Collect milestone titles in log order.
 * @param session - session whose events to fold.
 * @returns titles from every `milestone/write` event.
 */
export function foldMilestoneTitles(session: Session): string[] {
  const titles: string[] = []
  for (const event of session.events) {
    if (event.type === 'milestone/write') titles.push(event.data.title)
  }
  return titles
}

/**
 * Model-facing runtime-context body for the current milestone index.
 * @param titles - folded titles in log order.
 * @returns snapshot text, or `''` when the session has no milestones.
 */
export function renderMilestoneIndex(titles: readonly string[]): string {
  if (titles.length === 0) return ''
  return `Milestones recorded in this session:\n${titles.map(title => `- ${title}`).join('\n')}`
}
