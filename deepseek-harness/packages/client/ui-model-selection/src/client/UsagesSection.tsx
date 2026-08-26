/**
 * Settings → Usages: Host-local daily token history plus coding-plan quotas.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AccountUsageView, ConfigurableProviderView, IApiClient, UsageBuckets, UsageDayView, UsagePanelView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { formatTokens } from './usage-format.ts'
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
  /** Wire face used to load the local panel and provider quotas. */
  api: Pick<IApiClient, 'llm' | 'usage'>
}

export type UsagesSectionProps =
  Partial<InjectFace<UsagesSectionInjected>>
  & Partial<PropsLocale<'model'>>

const emptyBuckets = (): UsageBuckets => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
})

/** Billed tokens in one panel row. */
function panelTokens(buckets: UsageBuckets): number {
  return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value)
}

/** Local calendar day `YYYY-MM-DD`. */
function localIsoDate(time = Date.now()): string {
  const date = new Date(time)
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addIsoDays(iso: string, delta: number): string {
  const [year = 0, month = 1, day = 1] = iso.split('-').map(part => Number(part))
  return localIsoDate(new Date(year, month - 1, day + delta).getTime())
}

/** Last `count` local calendar days, oldest first, filling missing host days with zeros. */
function fillRecentDays(days: readonly UsageDayView[], count: number, today: string): UsageDayView[] {
  const byDate = new Map(days.map(day => [day.date, day]))
  const filled: UsageDayView[] = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = addIsoDays(today, -offset)
    filled.push(byDate.get(date) ?? { date, ...emptyBuckets() })
  }
  return filled
}

function sumDays(days: readonly UsageDayView[], fromDate: string): UsageBuckets {
  return days.reduce<UsageBuckets>((totals, day) => {
    if (day.date < fromDate) return totals
    return {
      requests: totals.requests + day.requests,
      inputTokens: totals.inputTokens + day.inputTokens,
      outputTokens: totals.outputTokens + day.outputTokens,
      cacheReadTokens: totals.cacheReadTokens + day.cacheReadTokens,
      cacheWriteTokens: totals.cacheWriteTokens + day.cacheWriteTokens,
    }
  }, emptyBuckets())
}

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

async function loadPanel(api: Pick<IApiClient, 'usage'>): Promise<UsagePanelView> {
  const response = await api.usage.panel({})
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

function dayLabel(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

/**
 * Render the Usages settings section.
 * @param props - inject face + locale seat.
 */
export function UsagesSection(props: UsagesSectionProps): ReactNode {
  const api = props.api
  const t = props.t
  const [panel, setPanel] = useState<UsagePanelView | 'loading' | 'idle'>('idle')
  const [rows, setRows] = useState<readonly ProviderQuotaRow[] | 'loading' | 'idle'>('idle')
  const [error, setError] = useState<string | undefined>(undefined)

  const refresh = useCallback(() => {
    if (api === undefined || t === undefined) return
    let cancelled = false
    setPanel('loading')
    setRows('loading')
    setError(undefined)
    void Promise.all([loadPanel(api), loadQuotaRows(api)]).then(
      ([nextPanel, nextRows]) => {
        if (cancelled) return
        setPanel(nextPanel)
        setRows(nextRows)
      },
      (err: unknown) => {
        if (cancelled) return
        setPanel({ days: [], models: [], totals: emptyBuckets() })
        setRows([])
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => { cancelled = true }
  }, [api, t])

  useEffect(() => {
    const cancel = refresh()
    return () => { cancel?.() }
  }, [refresh])

  const today = localIsoDate()
  const weekFrom = addIsoDays(today, -6)
  const recentDays = useMemo(
    () => panel === 'loading' || panel === 'idle' ? [] : fillRecentDays(panel.days, 14, today),
    [panel, today],
  )
  const peakTokens = recentDays.reduce((peak, day) => Math.max(peak, panelTokens(day)), 0)

  if (api === undefined || t === undefined) return null

  const loading = panel === 'loading' || panel === 'idle' || rows === 'loading' || rows === 'idle'
  const view = panel === 'loading' || panel === 'idle' ? undefined : panel
  const todayBuckets = view === undefined ? emptyBuckets() : (view.days.find(day => day.date === today) ?? emptyBuckets())
  const weekBuckets = view === undefined ? emptyBuckets() : sumDays(view.days, weekFrom)
  const allBuckets = view === undefined ? emptyBuckets() : view.totals

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
          disabled={loading}
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
      ) : (
        <>
          <ul className={css.stats}>
            <li className={css.stat}>
              <span className={css.statLabel}>{t('usages.today')}</span>
              <strong className={css.statValue}>{formatTokens(panelTokens(todayBuckets))}</strong>
              <span className={css.statMeta}>{t('usages.requests', { count: String(todayBuckets.requests) })}</span>
            </li>
            <li className={css.stat}>
              <span className={css.statLabel}>{t('usages.week')}</span>
              <strong className={css.statValue}>{formatTokens(panelTokens(weekBuckets))}</strong>
              <span className={css.statMeta}>{t('usages.requests', { count: String(weekBuckets.requests) })}</span>
            </li>
            <li className={css.stat}>
              <span className={css.statLabel}>{t('usages.all')}</span>
              <strong className={css.statValue}>{formatTokens(panelTokens(allBuckets))}</strong>
              <span className={css.statMeta}>{t('usages.requests', { count: String(allBuckets.requests) })}</span>
            </li>
          </ul>

          <section className={css.block}>
            <h3 className={css.blockTitle}>{t('usages.byDay')}</h3>
            {view !== undefined && panelTokens(view.totals) === 0 && view.totals.requests === 0 ? (
              <p className={css.hint}>{t('usages.emptyHistory')}</p>
            ) : (
              <ol className={css.bars} aria-label={t('usages.byDay')}>
                {recentDays.map((day) => {
                  const tokens = panelTokens(day)
                  const height = peakTokens === 0 ? 0 : Math.max(tokens === 0 ? 0 : 8, Math.round(tokens / peakTokens * 96))
                  return (
                    <li key={day.date} className={css.barCol} title={`${day.date} · ${formatTokens(tokens)}`}>
                      <span className={css.bar} style={{ height: `${String(height)}px` }} />
                      <span className={css.barLabel}>{dayLabel(day.date)}</span>
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          <section className={css.block}>
            <h3 className={css.blockTitle}>{t('usages.models')}</h3>
            {view === undefined || view.models.length === 0 ? (
              <p className={css.hint}>{t('usages.emptyHistory')}</p>
            ) : (
              <ol className={css.models} aria-label={t('usages.models')}>
                {view.models.map(model => (
                  <li key={`${model.provider}/${model.model}`} className={css.modelRow}>
                    <div className={css.modelHead}>
                      <span className={css.modelName}>{model.model}</span>
                      <span className={css.providerId}>{model.provider}</span>
                    </div>
                    <dl className={css.modelStats}>
                      <div className={css.row}>
                        <dt>{t('usages.tokensLabel')}</dt>
                        <dd>{formatTokens(panelTokens(model))}</dd>
                      </div>
                      <div className={css.row}>
                        <dt>{t('usages.input')}</dt>
                        <dd>{formatTokens(model.inputTokens + model.cacheReadTokens + model.cacheWriteTokens)}</dd>
                      </div>
                      <div className={css.row}>
                        <dt>{t('usages.output')}</dt>
                        <dd>{formatTokens(model.outputTokens)}</dd>
                      </div>
                      <div className={css.row}>
                        <dt>{t('usages.requestsLabel')}</dt>
                        <dd>{String(model.requests)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className={css.block}>
            <h3 className={css.blockTitle}>{t('usages.quotas')}</h3>
            {rows.length === 0 ? (
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
          </section>
        </>
      )}
    </div>
  )
}
