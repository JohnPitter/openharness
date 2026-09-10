/**
 * Settings → Limits: coding-plan account quotas only.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AccountUsageView, ConfigurableProviderView, IApiClient,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  awaitWithAbort,
  createUsageProbeSignal,
  quotaProbeErrorText,
} from './usage-quota-live.ts'
import { QuotaBody } from './usage-quota.tsx'
import css from './UsagesSection.module.css'

/** One provider card on the Limits page. */
interface ProviderQuotaRow {
  provider: string
  displayName: string
  quota: AccountUsageView | 'loading'
}

/** Injected dependencies of {@link QuotasSection}. */
export interface QuotasSectionInjected {
  /** Wire face used to list providers and load account quotas. */
  api: Pick<IApiClient, 'llm'>
}

export type QuotasSectionProps =
  Partial<InjectFace<QuotasSectionInjected>>
  & Partial<PropsLocale<'model'>>

function quotaRowVisible(quota: AccountUsageView | 'loading'): boolean {
  if (quota === 'loading') return true
  if (!quota.supported) return false
  if (quota.error !== undefined) return true
  return (quota.windows?.length ?? 0) > 0 || quota.plan !== undefined
}

function quotaFromFailure(error: unknown, timeoutLabel: string): AccountUsageView {
  return { supported: true, error: quotaProbeErrorText(error, timeoutLabel) }
}

/**
 * Render the Limits settings section. Cards appear as each provider probe
 * settles; a hung probe cannot blank the rest of the page.
 * @param props - inject face + locale seat.
 */
export function QuotasSection(props: QuotasSectionProps): ReactNode {
  const api = props.api
  const t = props.t
  const [rows, setRows] = useState<readonly ProviderQuotaRow[] | 'listing' | 'idle'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)
  const [pending, setPending] = useState(0)
  const probeAbort = useRef<AbortController | undefined>(undefined)

  const refresh = useCallback(() => {
    if (api === undefined || t === undefined) return
    probeAbort.current?.abort()
    const ac = new AbortController()
    probeAbort.current = ac
    setRows('listing')
    setError(undefined)
    setPending(0)

    const run = async (): Promise<void> => {
      try {
        const listed = await api.llm.providers({})
        if (ac.signal.aborted) return
        if (!listed.result.ok) {
          setRows([])
          setError(listed.result.error.message)
          return
        }
        const providers = listed.result.value.providers
        setRows(providers.map((entry: ConfigurableProviderView) => ({
          provider: entry.provider,
          displayName: entry.displayName,
          quota: 'loading' as const,
        })))
        setPending(providers.length)
        if (providers.length === 0) return
        await Promise.all(providers.map(async (entry: ConfigurableProviderView) => {
          const probe = createUsageProbeSignal(ac.signal)
          let quota: AccountUsageView
          try {
            const response = await awaitWithAbort(
              api.llm.accountUsage({ provider: entry.provider }, probe.signal),
              probe.signal,
            )
            quota = !response.result.ok
              ? { supported: true, error: response.result.error.message }
              : response.result.value
          } catch (caught: unknown) {
            quota = quotaFromFailure(caught, t('usage.quotaTimeout'))
          } finally {
            probe.dispose()
          }
          if (ac.signal.aborted) return
          setRows((current) => {
            const base = Array.isArray(current)
              ? current
              : providers.map((item: ConfigurableProviderView) => ({
                provider: item.provider,
                displayName: item.displayName,
                quota: 'loading' as const,
              }))
            return base
              .map(row => row.provider === entry.provider ? { ...row, quota } : row)
              .filter(row => quotaRowVisible(row.quota))
          })
          setPending(count => Math.max(0, count - 1))
        }))
      } catch (err: unknown) {
        if (ac.signal.aborted) return
        setRows([])
        setError(err instanceof Error ? err.message : String(err))
      }
    }
    void run()
    return () => { ac.abort() }
  }, [api, t])

  useEffect(() => {
    const cancel = refresh()
    return () => { cancel?.() }
  }, [refresh])

  if (api === undefined || t === undefined) return null

  const listing = rows === 'listing' || rows === 'idle'
  const cards = rows === 'listing' || rows === 'idle' ? [] : rows
  const loading = listing && cards.length === 0
  const busy = listing || pending > 0

  return (
    <div className={css.section}>
      <div className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{t('quotas.title')}</h2>
          <p className={css.intro}>{t('quotas.intro')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<IconRefreshOutline16 size={14} />}
          disabled={busy}
          onClick={() => { refresh() }}
        >
          {t('usages.refresh')}
        </Button>
      </div>

      {error !== undefined && (
        <p className={css.error} role="alert">{error}</p>
      )}

      {loading ? (
        <p className={css.hint}>{t('usage.quotaLoading')}</p>
      ) : cards.length === 0 ? (
        <p className={css.hint}>{t('usages.empty')}</p>
      ) : (
        <ul className={css.cards}>
          {cards.map(row => (
            <li key={row.provider} className={css.card}>
              <div className={css.cardHead}>
                <span className={css.providerName}>{row.displayName}</span>
                <span className={css.providerId}>{row.provider}</span>
              </div>
              <QuotaBody
                quota={row.quota}
                t={t}
                styles={{
                  quota: css.quota,
                  quotaHint: css.quotaHint,
                  quotaError: css.quotaError,
                  rows: css.rows,
                  row: css.row,
                  rowMeter: css.rowMeter,
                  rowDetail: css.rowDetail,
                  meter: css.meter,
                  meterFill: css.meterFill,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
