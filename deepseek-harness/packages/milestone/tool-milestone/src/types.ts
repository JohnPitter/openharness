/**
 * Milestone event payload and SessionEventMap merge. Host consumers import
 * `./types`; the browser half re-exports the same declarations from `./client`.
 *
 * @module @deepseek-ai/dsh-tool-milestone/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MilestoneId } from './brand.ts'

export type { MilestoneId } from './brand.ts'

/** Who authored the durable milestone record. */
export type MilestoneOrigin = 'session' | 'worker'

/** Log-only payload of one `milestone/write` event. */
export interface MilestoneWriteData {
  /** Stable identity minted at execute time. */
  readonly milestoneId: MilestoneId
  /** One-line label shown in the rail and runtime-context index. */
  readonly title: string
  /** The recorded finding, decision, or fix. */
  readonly body: string
  /** Session seq the fact is about, when the model supplied one. */
  readonly anchorSeq?: number
  /** `worker` on a parent-session mirror; `session` on the calling log. */
  readonly origin: MilestoneOrigin
  /** Child session that authored a parent-session mirror. */
  readonly childSessionId?: SessionId
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One append-only session milestone. Log-only: the model sees titles through
     * the runtime-context snapshot, not a second derived-history message.
     * @param data - identity, title, body, optional anchor, and origin.
     */
    'milestone/write': MilestoneWriteData
  }
}
