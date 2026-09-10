/**
 * Shared account-quota meters for the sidebar chip and the Settings Usages page.
 */

import type { ReactNode } from 'react'
import type { AccountUsageView, AccountUsageWindowView } from '@deepseek-ai/dsh-api-remotes/client'
import { formatQuotaCount, formatResetWhen } from './usage-format.ts'
import type { ModelKey } from './locales.ts'

/** Translate face used by quota surfaces (model namespace). */
export type QuotaTranslate = (
  key: ModelKey,
  params?: Record<string, string>,
) => string

/** Compact horizontal meter for a 0–100 utilization percent. */
export function MeterBar({ percent, className, fillClassName }: {
  percent: number
  className?: string | undefined
  fillClassName?: string | undefined
}): ReactNode {
  return (
    <div className={className} aria-hidden>
      <div className={fillClassName} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  )
}

/** Ring geometry shared by the occupancy/quota rings: 14px viewBox, 2px stroke. */
const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** CSS class triple a ring consumer supplies from its own module. */
export interface RingStyles {
  ring?: string | undefined
  ringTrack?: string | undefined
  ringFill?: string | undefined
}

/** Compact radial meter for a 0–100 percent, stroked through the caller's classes. */
export function Ring({ percent, styles }: { percent: number; styles: RingStyles }): ReactNode {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden className={styles.ring}>
      <circle className={styles.ringTrack} cx="7" cy="7" r={RING_RADIUS} />
      <circle
        className={styles.ringFill}
        cx="7"
        cy="7"
        r={RING_RADIUS}
        strokeDasharray={`${RING_CIRCUMFERENCE * percent / 100} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

/** Rolling-window length in hours, defaulting to a 5-hour coding-plan window. */
export function windowHours(window: AccountUsageWindowView): string {
  const minutes = window.windowMinutes
  return minutes !== undefined && minutes > 0
    ? String(minutes % 60 === 0 ? minutes / 60 : Math.max(1, Math.round(minutes / 60)))
    : '5'
}

/** Human label for one quota window id. */
export function quotaWindowLabel(window: AccountUsageWindowView, t: QuotaTranslate): string {
  if (window.id === 'weekly') return t('usage.quotaWeekly')
  if (window.id === 'monthly') return t('usage.quotaMonthly')
  if (window.id === 'requests-weekly') return t('usage.quotaRequestsWeekly')
  if (window.id === 'rate') return t('usage.quotaRate', { hours: windowHours(window) })
  if (window.id === 'requests') return t('usage.quotaRequests', { hours: windowHours(window) })
  return window.id
}

/** Used/limit or percent string for one window. */
export function quotaWindowValue(window: AccountUsageWindowView, t: QuotaTranslate): string {
  if (window.limit === 100) {
    return t('usage.quotaPercent', { percent: String(window.percent) })
  }
  return t('usage.quotaValue', {
    used: formatQuotaCount(window.used),
    limit: formatQuotaCount(window.limit),
  })
}

/**
 * Render one provider's account quota (plan + windows), or a loading/error
 * placeholder. Returns null when the adapter reports no quota support.
 */
export function QuotaBody({
  quota,
  t,
  styles,
}: {
  quota: AccountUsageView | 'loading'
  t: QuotaTranslate
  styles: {
    quota?: string | undefined
    quotaHint?: string | undefined
    quotaError?: string | undefined
    rows?: string | undefined
    row?: string | undefined
    rowMeter?: string | undefined
    rowDetail?: string | undefined
    meter?: string | undefined
    meterFill?: string | undefined
  }
}): ReactNode {
  if (quota === 'loading') {
    return <p className={styles.quotaHint}>{t('usage.quotaLoading')}</p>
  }
  if (!quota.supported) return null
  if (quota.error !== undefined) {
    return (
      <div className={styles.quota}>
        <p className={styles.quotaHint}>{t('usage.quota')}</p>
        <p className={styles.quotaError}>{quota.error}</p>
      </div>
    )
  }
  const windows = quota.windows ?? []
  if (windows.length === 0) return null
  return (
    <div className={styles.quota}>
      <dl className={styles.rows}>
        <div className={styles.row}>
          <dt>{t('usage.quota')}</dt>
          <dd>{quota.plan ?? ''}</dd>
        </div>
      </dl>
      <p className={styles.quotaHint}>{t('usage.quotaShared')}</p>
      <dl className={styles.rows}>
        {windows.map((window) => {
          const reset = formatResetWhen(window.resetsAt)
          return (
            <div key={window.id}>
              <div className={styles.row}>
                <dt>{quotaWindowLabel(window, t)}</dt>
                <dd>{quotaWindowValue(window, t)}</dd>
              </div>
              <div className={styles.rowMeter}>
                <MeterBar
                  percent={window.percent}
                  className={styles.meter}
                  fillClassName={styles.meterFill}
                />
              </div>
              {reset !== undefined && (
                <div className={styles.rowDetail}>
                  <dt />
                  <dd>{t('usage.quotaReset', { when: reset })}</dd>
                </div>
              )}
            </div>
          )
        })}
      </dl>
    </div>
  )
}
