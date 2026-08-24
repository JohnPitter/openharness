/**
 * Settings → Usages: account quotas for every provider that publishes them
 * (coding-plan windows: Kimi, Claude Code, Codex, GLM).
 */

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AccountUsageView, ConfigurableProviderView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { QuotaBody } from './usage-quota.tsx'
import css from './UsagesSection.module.css'

/** One provider card on the Usages page. */
interface ProviderQuotaRow {
  provider: string
  displayName: string
  quota: AccountUsageView | 'loading'
}

/** Injected dependencies of {@link UsagesSection}. */
export interface UsagesSectionInjected {
  /** Wire LLM face used to list providers and fetch quotas. */
  api: Pick<IApiClient, 'llm'>
}

export type UsagesSectionProps =
  Partial<InjectFace<UsagesSectionInjected>>
  & Partial<PropsLocale<'model'>>

/**
 * Load every configurable provider, then ask each for account usage. Only
 * routes that report `supported: true` (or an error while checking) stay
 * visible — pay-per-token adapters with no plan windows are omitted.
 */
async function loadQuotaRows(api: Pick<IApiClient, 'llm'>): Promise<ProviderQuotaRow[]> {
  const listed = await api.llm.providers({})
  if (!listed.result.ok) {
    throw new Error(listed.result.error.message)
  }
  const providers = listed.result.value.providers
  const settled = await Promise.all(providers.map(async (entry: ConfigurableProviderView) => {
    try {
      const response = await api.llm.accountUsage({ provider: entry.provider })
      if (!response.result.ok) {
        return {
          provider: entry.provider,
          displayName: entry.displayName,
          quota: { supported: true, error: response.result.error.message } satisfies AccountUsageView,
        }
      }
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        quota: response.result.value,
      }
    } catch (error: unknown) {
      return {
        provider: entry.provider,
        displayName: entry.displayName,
        quota: {
          supported: true,
          error: error instanceof Error ? error.message : String(error),
        } satisfies AccountUsageView,
      }
    }
  }))
  return settled.filter((row) => {
    const quota = row.quota
    if (!quota.supported) return false
    if (quota.error !== undefined) return true
    return (quota.windows?.length ?? 0) > 0 || quota.plan !== undefined
  })
}

/**
 * Render the Usages settings section.
 * @param props - inject face + locale seat.
 */
export function UsagesSection(props: UsagesSectionProps): ReactNode {
  const api = props.api
  const t = props.t
  const [rows, setRows] = useState<readonly ProviderQuotaRow[] | 'loading' | 'idle'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(() => {
    if (api === undefined || t === undefined) return
    let cancelled = false
    setRows('loading')
    setError(undefined)
    loadQuotaRows(api).then(
      (next) => {
        if (!cancelled) setRows(next)
      },
      (err: unknown) => {
        if (!cancelled) {
          setRows([])
          setError(err instanceof Error ? err.message : String(err))
        }
      },
    )
    return () => { cancelled = true }
  }, [api, t])

  useEffect(() => {
    const cancel = refresh()
    return () => { cancel?.() }
  }, [refresh])

  if (api === undefined || t === undefined) return null

  return (
    <div className={css.section}>
      <div className={css.header}>
        <div className={css.heading}>
          <h2 className={css.title}>{t('usages.title')}</h2>
          <p className={css.intro}>{t('usages.intro')}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          icon={<IconRefreshOutline16 size={14} />}
          disabled={rows === 'loading'}
          onClick={() => { refresh() }}
        >
          {t('usages.refresh')}
        </Button>
      </div>

      {error !== undefined && (
        <p className={css.error} role="alert">{error}</p>
      )}

      {rows === 'loading' || rows === 'idle' ? (
        <p className={css.hint}>{t('usage.quotaLoading')}</p>
      ) : rows.length === 0 ? (
        <p className={css.hint}>{t('usages.empty')}</p>
      ) : (
        <ul className={css.cards}>
          {rows.map(row => (
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
