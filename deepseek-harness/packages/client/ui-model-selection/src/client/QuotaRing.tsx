/**
 * Composer account-quota ring beside the send button: the current provider's
 * lead quota window (the 5-hour-style limit when the plan discloses one,
 * else the weekly-style window) as a compact ring with a percent readout.
 * Click opens Settings → Limits; the tooltip names the window and its reset.
 * Renders nothing until the quota loads with a usable window.
 */

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { formatResetWhen } from './usage-format.ts'
import { leadQuotaWindow, useProviderQuota } from './usage-quota-live.ts'
import { quotaWindowLabel, Ring } from './usage-quota.tsx'
import type { QuotaRingInjected } from './usage-slots.ts'
import css from './QuotaRing.module.css'

export type QuotaRingProps =
  PropsRuntime<'conversation.input.right'>
  & InjectFace<QuotaRingInjected>
  & PropsLocale<'model'>

/**
 * Render the quota ring for the staged provider.
 * @param props - input-row owner share plus the quota inject face.
 * @returns the ring button, or nothing while unusable.
 */
export function QuotaRing(props: QuotaRingProps): ReactNode {
  const { directory, loadAccountUsage, openQuotas, t } = props
  const directorySnap = useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => directory.getSnapshot(),
  )
  const quota = useProviderQuota(directorySnap.current?.provider, loadAccountUsage)
  if (t === undefined) return null
  const lead = leadQuotaWindow(quota)
  if (lead === undefined) return null
  const reset = formatResetWhen(lead.resetsAt)
  const tip = t('usage.quotaRingTip', { label: quotaWindowLabel(lead, t), percent: String(lead.percent) })
    + (reset === undefined ? '' : ` · ${t('usage.quotaReset', { when: reset })}`)
  return (
    <Tooltip label={tip} side="top" delayMs={500}>
      <button type="button" className={css.trigger} aria-label={tip} onClick={openQuotas}>
        <Ring percent={lead.percent} styles={{ ring: css.ring, ringTrack: css.ringTrack, ringFill: css.ringFill }} />
        <span className={css.percent}>{lead.percent}%</span>
      </button>
    </Tooltip>
  )
}
