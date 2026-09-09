/**
 * Live account-quota reads shared by the sidebar usage chip and the composer
 * quota ring: given the current directory provider, load its windows and
 * refresh on a slow cadence — quota moves per request, not per render.
 */

import { useEffect, useState } from 'react'
import type { AccountUsageView, AccountUsageWindowView } from '@deepseek-ai/dsh-api-remotes/client'
import type { QuotaTranslate } from './usage-quota.tsx'
import { windowHours } from './usage-quota.tsx'

/** Re-probe cadence for the ambient surfaces; the Limits panel reloads on open. */
const QUOTA_REFRESH_MS = 60_000

/**
 * Account quota for one provider, reloaded on provider change and every
 * minute while mounted. Undefined while the first load is in flight and
 * whenever no provider is staged.
 * @param providerId - current directory provider, when one is staged.
 * @param loadAccountUsage - the injected quota loader.
 * @returns the latest quota view, error views included.
 */
export function useProviderQuota(
  providerId: string | undefined,
  loadAccountUsage: (provider: string) => Promise<AccountUsageView>,
): AccountUsageView | undefined {
  const [quota, setQuota] = useState<AccountUsageView | undefined>(undefined)
  useEffect(() => {
    setQuota(undefined)
    if (providerId === undefined) return
    let disposed = false
    const load = (): void => {
      loadAccountUsage(providerId).then(
        (view) => { if (!disposed) setQuota(view) },
        (error: unknown) => {
          // The Limits panel renders this text; ambient surfaces stay hidden.
          if (!disposed) {
            setQuota({ supported: true, error: error instanceof Error ? error.message : String(error) })
          }
        },
      )
    }
    load()
    const timer = setInterval(load, QUOTA_REFRESH_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [providerId, loadAccountUsage])
  return quota
}

/**
 * The window an ambient readout leads with: the short 5-hour-style limit
 * when the plan discloses one, else the earliest-resetting (weekly-style)
 * window.
 * @param quota - one provider's loaded quota view.
 * @returns the lead window, or undefined when the view carries none.
 */
export function pickLeadWindow(quota: AccountUsageView): AccountUsageWindowView | undefined {
  const windows = quota.windows ?? []
  if (windows.length === 0) return undefined
  const minutes = (window: AccountUsageWindowView): number => window.windowMinutes ?? Number.POSITIVE_INFINITY
  const shortest = windows.reduce((a, b) => minutes(b) < minutes(a) ? b : a)
  if (shortest.windowMinutes !== undefined) return shortest
  const reset = (window: AccountUsageWindowView): number => window.resetsAt ?? Number.POSITIVE_INFINITY
  return windows.reduce((a, b) => reset(b) < reset(a) ? b : a)
}

/**
 * The usable lead window of a loaded view: none while the provider exposes
 * no quota surface or the last probe failed.
 * @param quota - the hook's latest view, when loaded.
 * @returns the lead window to display.
 */
export function leadQuotaWindow(quota: AccountUsageView | undefined): AccountUsageWindowView | undefined {
  if (quota === undefined || !quota.supported || quota.error !== undefined) return undefined
  return pickLeadWindow(quota)
}

/**
 * Compact ambient segment for one lead window: `42% 5h` or the weekly
 * variant in the active locale.
 * @param window - the lead window.
 * @param t - model-namespace translate.
 * @returns the chip segment.
 */
export function quotaChipSegment(window: AccountUsageWindowView, t: QuotaTranslate): string {
  const percent = String(window.percent)
  return window.id === 'weekly' || window.id === 'requests-weekly'
    ? t('usage.quotaChipWeekly', { percent })
    : t('usage.quotaChipRate', { percent, hours: windowHours(window) })
}
