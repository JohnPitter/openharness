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
 * Bound on one account-usage probe. Same order as the Kimi live-catalog
 * listing timeout: a hang must not blank Limits or leave the chip empty.
 */
export const ACCOUNT_USAGE_PROBE_TIMEOUT_MS = 2_500

/** Chip and composer ring share one successful probe per provider for this TTL. */
export const ACCOUNT_USAGE_CACHE_TTL_MS = 60_000

/** Injected quota loader; the optional signal cancels the RPC. */
export type AccountUsageLoader = (
  provider: string,
  signal?: AbortSignal,
) => Promise<AccountUsageView>

type CacheEntry =
  | { kind: 'inflight'; promise: Promise<AccountUsageView> }
  | { kind: 'done'; at: number; view: AccountUsageView }

const usageCache = new WeakMap<AccountUsageLoader, Map<string, CacheEntry>>()

function cacheTable(load: AccountUsageLoader): Map<string, CacheEntry> {
  const existing = usageCache.get(load)
  if (existing !== undefined) return existing
  const created = new Map<string, CacheEntry>()
  usageCache.set(load, created)
  return created
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

/**
 * True when a probe ended because the caller aborted or the probe timed out.
 * @param error - rejection from fetch, RPC, or {@link awaitWithAbort}.
 */
export function isAbortFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'name' in error
    && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function errorText(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return String(error)
}

/**
 * User-visible probe failure: the timeout copy when the probe aborted or
 * timed out, otherwise the thrown message.
 * @param error - rejection from fetch, RPC, or {@link awaitWithAbort}.
 * @param timeoutLabel - Limits-localized timeout copy.
 */
export function quotaProbeErrorText(error: unknown, timeoutLabel: string): string {
  return isAbortFailure(error) ? timeoutLabel : errorText(error)
}

/**
 * Reject when `signal` aborts even if the underlying promise ignores it.
 * @param promise - the probe.
 * @param signal - timeout and/or unmount.
 */
export function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => { reject(abortReason(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/**
 * A disposable 2.5s timeout, optionally OR'd with an external abort.
 * Callers must `dispose()` so the timer does not keep the event loop alive.
 * @param external - unmount or refresh cancellation.
 */
export function createUsageProbeSignal(external?: AbortSignal): {
  signal: AbortSignal
  dispose: () => void
} {
  const ac = new AbortController()
  const timer = setTimeout(() => {
    ac.abort(new DOMException('The operation was aborted', 'TimeoutError'))
  }, ACCOUNT_USAGE_PROBE_TIMEOUT_MS)
  const dispose = (): void => { clearTimeout(timer) }
  if (external !== undefined) {
    if (external.aborted) {
      dispose()
      ac.abort(external.reason)
    } else {
      external.addEventListener('abort', () => {
        dispose()
        ac.abort(external.reason)
      }, { once: true })
    }
  }
  return { signal: ac.signal, dispose }
}

/**
 * One provider probe with a 2.5s timeout, coalesced per loader+provider
 * for {@link ACCOUNT_USAGE_CACHE_TTL_MS}. Caller abort does not cancel a
 * shared in-flight probe still needed by another surface.
 * @param provider - directory provider id.
 * @param load - injected RPC wrapper.
 * @param signal - the caller's unmount abort; ignored for cache hits that
 *   already completed.
 */
export function loadAccountUsageCached(
  provider: string,
  load: AccountUsageLoader,
  signal: AbortSignal,
): Promise<AccountUsageView> {
  const table = cacheTable(load)
  const now = Date.now()
  const hit = table.get(provider)
  if (hit !== undefined && hit.kind === 'done' && now - hit.at < ACCOUNT_USAGE_CACHE_TTL_MS) {
    return awaitWithAbort(Promise.resolve(hit.view), signal)
  }
  if (hit !== undefined && hit.kind === 'inflight') {
    return awaitWithAbort(hit.promise, signal)
  }
  const probe = createUsageProbeSignal()
  const run = awaitWithAbort(load(provider, probe.signal), probe.signal).then(
    (view) => {
      table.set(provider, { kind: 'done', at: Date.now(), view })
      return view
    },
    (error: unknown) => {
      table.delete(provider)
      throw error
    },
  ).finally(() => { probe.dispose() })
  table.set(provider, { kind: 'inflight', promise: run })
  return awaitWithAbort(run, signal)
}

/**
 * Account quota for one provider, reloaded on provider change and every
 * minute while mounted. Undefined while the first load is in flight and
 * whenever no provider is staged. A timeout or abort becomes an error
 * view; ambient surfaces hide it via {@link leadQuotaWindow}.
 * @param providerId - current directory provider, when one is staged.
 * @param loadAccountUsage - the injected quota loader.
 * @returns the latest quota view, error views included.
 */
export function useProviderQuota(
  providerId: string | undefined,
  loadAccountUsage: AccountUsageLoader,
): AccountUsageView | undefined {
  const [quota, setQuota] = useState<AccountUsageView | undefined>(undefined)
  useEffect(() => {
    setQuota(undefined)
    if (providerId === undefined) return
    const ac = new AbortController()
    const load = (): void => {
      loadAccountUsageCached(providerId, loadAccountUsage, ac.signal).then(
        (view) => { if (!ac.signal.aborted) setQuota(view) },
        (error: unknown) => {
          if (ac.signal.aborted) return
          setQuota({
            supported: true,
            error: errorText(error),
          })
        },
      )
    }
    load()
    const timer = setInterval(load, QUOTA_REFRESH_MS)
    return () => {
      ac.abort()
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
 * Compact ambient segment for one lead window: `42% 5h`, or the weekly and
 * monthly variants in the active locale.
 * @param window - the lead window.
 * @param t - model-namespace translate.
 * @returns the chip segment.
 */
export function quotaChipSegment(window: AccountUsageWindowView, t: QuotaTranslate): string {
  const percent = String(window.percent)
  if (window.id === 'weekly' || window.id === 'requests-weekly') return t('usage.quotaChipWeekly', { percent })
  if (window.id === 'monthly') return t('usage.quotaChipMonthly', { percent })
  return t('usage.quotaChipRate', { percent, hours: windowHours(window) })
}
