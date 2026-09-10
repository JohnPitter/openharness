/**
 * Composer account-quota ring, layered INSIDE the context meter's trigger:
 * the current provider's lead quota window (the 5-hour-style limit when the
 * plan discloses one, else the weekly-style window) as the inner arc of the
 * concentric meter beside the send button — the outer arc stays context
 * occupancy. The trigger keeps the context panel's click and tooltip; this
 * contribution is a pure visual that renders nothing until the quota loads
 * with a usable window.
 */

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatResetWhen } from './usage-format.ts'
import { leadQuotaWindow, useProviderQuota } from './usage-quota-live.ts'
import { quotaWindowLabel } from './usage-quota.tsx'
import type { QuotaRingInjected } from './usage-slots.ts'
import css from './QuotaRing.module.css'

export type QuotaRingProps =
  PropsRuntime<'conversation.input.meterCenter'>
  & InjectFace<QuotaRingInjected>
  & PropsLocale<'model'>

/** Inner-ring geometry inside the outer ring's 14px viewBox. */
const INNER_RADIUS = 2.75
const INNER_CIRCUMFERENCE = 2 * Math.PI * INNER_RADIUS

/**
 * Render the inner quota arc for the staged provider.
 * @param props - meter-center owner share plus the quota inject face.
 * @returns the inner ring, or nothing while unusable.
 */
export function QuotaRing(props: QuotaRingProps): ReactNode {
  const { directory, loadAccountUsage, t } = props
  const directorySnap = useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => directory.getSnapshot(),
  )
  const quota = useProviderQuota(directorySnap.current?.provider, loadAccountUsage)
  if (t === undefined) return null
  const lead = leadQuotaWindow(quota)
  if (lead === undefined) return null
  const reset = formatResetWhen(lead.resetsAt)
  const title = t('usage.quotaRingTip', { label: quotaWindowLabel(lead, t), percent: String(lead.percent) })
    + (reset === undefined ? '' : ` · ${t('usage.quotaReset', { when: reset })}`)
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" className={css.ring} role="img" aria-label={title}>
      <title>{title}</title>
      <circle className={css.ringTrack} cx="7" cy="7" r={INNER_RADIUS} />
      <circle
        className={css.ringFill}
        cx="7"
        cy="7"
        r={INNER_RADIUS}
        strokeDasharray={`${INNER_CIRCUMFERENCE * lead.percent / 100} ${INNER_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}
