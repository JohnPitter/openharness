/** Package-owned durable milestone-write invariants. @module @deepseek-ai/dsh-tool-milestone/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { MILESTONE_BODY_MAX, MILESTONE_TITLE_MAX } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-milestone'
const ORIGINS = new Set(['session', 'worker'])

/** Cordis companion plugin name. */
export const name = 'tool-milestone-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one append-only milestone record before it reaches the durable log. */
function validateWrite(value: unknown, fail: InvariantFailure): void {
  if (typeof value !== 'object' || value === null) fail('milestone/write payload must be an object')
  const data = value as Record<string, unknown>
  if (typeof data.milestoneId !== 'string' || data.milestoneId.length === 0) {
    fail('milestone/write milestoneId must be a non-empty string')
  }
  if (typeof data.title !== 'string' || data.title.length === 0 || data.title.trim() !== data.title) {
    fail('milestone/write title must be non-empty and already trimmed')
  }
  if (data.title.length > MILESTONE_TITLE_MAX) {
    fail(`milestone/write title must be at most ${MILESTONE_TITLE_MAX} characters`)
  }
  if (typeof data.body !== 'string' || data.body.length === 0 || data.body.trim() !== data.body) {
    fail('milestone/write body must be non-empty and already trimmed')
  }
  if (data.body.length > MILESTONE_BODY_MAX) {
    fail(`milestone/write body must be at most ${MILESTONE_BODY_MAX} characters`)
  }
  if (data.anchorSeq !== undefined
    && (typeof data.anchorSeq !== 'number' || !Number.isSafeInteger(data.anchorSeq) || data.anchorSeq < 0)) {
    fail('milestone/write anchorSeq must be a non-negative integer when present')
  }
  if (typeof data.origin !== 'string' || !ORIGINS.has(data.origin)) {
    fail(`milestone/write carries unknown origin ${JSON.stringify(data.origin)}`)
  }
  if (data.origin === 'worker') {
    if (typeof data.childSessionId !== 'string' || data.childSessionId.length === 0) {
      fail('milestone/write worker origin must name the child session')
    }
  } else if (data.childSessionId !== undefined) {
    fail('milestone/write session origin must not name a child session')
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate the package-owned event fields and ignore unrelated events. */
function validateEvent(event: SessionEvent, fail: InvariantFailure): void {
  if (event.type === 'milestone/write') validateWrite(event.data, fail)
}

/** Install validation for loaded and newly appended milestone records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) {
    for (const event of session.events) validateEvent(event, fail)
  }
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const event = (args as [Session, SessionEvent])[1]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the milestone invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
