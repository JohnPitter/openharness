/**
 * Sidebar-foot account chip: current provider/model, advertised context
 * window, session token use, and a door into Models settings. The panel is
 * `position: fixed` from the chip's viewport rect so the collapsed sidebar's
 * overflow clip cannot crop it.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'
import { IconDataOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { AccountUsageView } from '@deepseek-ai/dsh-api-remotes/client'
import type { UsageStatusChipInjected } from './usage-slots.ts'
import type { WorkerModelState } from './worker-store.ts'
import {
  billedInputTokens,
  cacheHitPercent,
  contextOccupancy,
  currentModelContextWindow,
  formatTokens,
  routeLabelFor,
  routeLabelOf,
  sessionTokens,
} from './usage-format.ts'
import { MeterBar, QuotaBody } from './usage-quota.tsx'
import css from './UsageStatusChip.module.css'

/** Idle snapshot used before the worker store's first load and outside Workflow mode. */
const IDLE_WORKER: WorkerModelState = { current: null, status: 'idle', error: null }

export type UsageStatusChipProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<UsageStatusChipInjected>
  & PropsLocale<'model'>

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS
const PANEL_GAP = 8
const PANEL_MARGIN = 12
const RAIL_PANEL_WIDTH = 240
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * Place the usage panel outside the sidebar clip: wide opens above the chip,
 * rail opens to the right of the icon so the 56px column cannot crop it.
 */
function anchoredPanelStyle(
  anchor: DOMRect,
  height: number,
  wide: boolean,
): CSSProperties {
  const width = wide ? Math.max(RAIL_PANEL_WIDTH, anchor.width) : RAIL_PANEL_WIDTH
  let left = wide ? anchor.left : anchor.right + PANEL_GAP
  let top = wide ? anchor.top - height - PANEL_GAP : anchor.bottom - height
  if (width > 0) left = Math.min(Math.max(left, PANEL_MARGIN), window.innerWidth - width - PANEL_MARGIN)
  if (height > 0) top = Math.min(Math.max(top, PANEL_MARGIN), window.innerHeight - height - PANEL_MARGIN)
  return { left, top, width }
}

function Ring({ percent }: { percent: number }) {
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden className={css.ring}>
      <circle className={css.ringTrack} cx="7" cy="7" r={RING_RADIUS} />
      <circle
        className={css.ringFill}
        cx="7"
        cy="7"
        r={RING_RADIUS}
        strokeDasharray={`${RING_CIRCUMFERENCE * percent / 100} ${RING_CIRCUMFERENCE}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

function QuotaSection({
  quota,
  t,
}: {
  quota: AccountUsageView | 'loading'
  t: NonNullable<UsageStatusChipProps['t']>
}): ReactNode {
  return (
    <QuotaBody
      quota={quota}
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
  )
}

/**
 * Render the usage chip and its click-open panel.
 * @param props - sidebar owner state plus directory/settings inject.
 * @returns the footer action.
 */
export function UsageStatusChip(props: UsageStatusChipProps): ReactNode {
  const {
    wide, useSessions, directory, workerDirectory, ensureDirectory, openModels, openUsages, loadAccountUsage, t,
  } = props
  const sessionId = useSessions(state => state.current)
  const usage = useSessions((state): TokenUsageProjection | undefined => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.projectionValues?.tokenUsage
  })
  const pressure = useSessions((state): ContextPressureProjection | undefined => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.projectionValues?.contextPressure
  })
  const preset = useSessions((state): string | undefined => {
    const id = state.current
    return id === undefined ? undefined : state.byId[id]?.agentPreset
  })
  const directorySnap = useSyncExternalStore(
    listener => directory.subscribe(listener),
    () => directory.getSnapshot(),
  )
  const workerState = useSyncExternalStore(
    workerDirectory === undefined ? () => () => {} : listener => workerDirectory.subscribe(listener),
    () => workerDirectory?.getSnapshot() ?? IDLE_WORKER,
  )
  const [open, setOpen] = useState(false)
  const [quota, setQuota] = useState<AccountUsageView | 'loading' | null>(null)
  const [workerQuota, setWorkerQuota] = useState<AccountUsageView | 'loading' | null>(null)
  const [panelPos, setPanelPos] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const providerId = directorySnap.current?.provider
  const workerSelection = preset === 'workflow' ? workerState.current : null
  const workerProviderId = workerSelection?.provider

  useEffect(() => {
    if (sessionId !== undefined) ensureDirectory(sessionId)
  }, [ensureDirectory, sessionId])

  useEffect(() => {
    if (!open || providerId === undefined) {
      setQuota(null)
      return
    }
    let cancelled = false
    setQuota('loading')
    loadAccountUsage(providerId).then(
      (view) => { if (!cancelled) setQuota(view) },
      (error: unknown) => {
        if (!cancelled) {
          setQuota({
            supported: true,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => { cancelled = true }
  }, [loadAccountUsage, open, providerId])

  useEffect(() => {
    if (!open || workerProviderId === undefined) {
      setWorkerQuota(null)
      return
    }
    // Same provider as the staged route: the account quota is identical, so
    // reuse the already-loading/loaded value instead of a second request.
    if (workerProviderId === providerId) {
      setWorkerQuota(quota)
      return
    }
    let cancelled = false
    setWorkerQuota('loading')
    loadAccountUsage(workerProviderId).then(
      (view) => { if (!cancelled) setWorkerQuota(view) },
      (error: unknown) => {
        if (!cancelled) {
          setWorkerQuota({
            supported: true,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
    return () => { cancelled = true }
  }, [loadAccountUsage, open, providerId, quota, workerProviderId])

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null)
      return
    }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      const panel = panelRef.current
      if (rect === undefined || panel === null) return
      setPanelPos(anchoredPanelStyle(rect, panel.offsetHeight, wide))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place)
      observer.observe(panel)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, wide, quota, workerQuota])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const route = routeLabelOf(directorySnap)
  const occupancy = contextOccupancy(pressure)
  const catalogWindow = occupancy?.contextWindow ?? currentModelContextWindow(directorySnap)
  const total = sessionTokens(usage)
  const cache = usage === undefined ? null : cacheHitPercent(usage)
  const headline = route === undefined
    ? t('usage.idle')
    : t('usage.route', { provider: route.provider, model: route.model })
  const meta = occupancy !== null
    ? `${occupancy.percent}% · ${formatTokens(occupancy.contextWindow)}`
    : catalogWindow !== undefined
      ? formatTokens(catalogWindow)
      : t('usage.sessionShort', { tokens: formatTokens(total) })
  const occupancyLabel = occupancy === null
    ? (catalogWindow === undefined ? t('usage.contextUnknown') : formatTokens(catalogWindow))
    : `${occupancy.percent}%`

  const openKeys = (): void => {
    setOpen(false)
    openModels()
  }
  const openAllQuotas = (): void => {
    setOpen(false)
    openUsages()
  }

  return (
    <div ref={rootRef} className={clsx(css.layer, !wide && css.rail)}>
      {open && (
        <section
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('usage.panelAria')}
          style={panelPos ?? MEASURE_STYLE}
        >
          <header className={css.header}>
            <span className={css.provider}>{route?.provider ?? t('usage.idle')}</span>
            {route !== undefined && <span className={css.model}>{route.model}</span>}
          </header>
          <dl className={css.rows}>
            <div className={css.row}>
              <dt>{t('usage.context')}</dt>
              <dd>
                {occupancy === null
                  ? catalogWindow === undefined
                    ? t('usage.contextUnknown')
                    : formatTokens(catalogWindow)
                  : t('usage.contextValue', {
                    percent: String(occupancy.percent),
                    used: formatTokens(occupancy.usedTokens),
                    window: formatTokens(occupancy.contextWindow),
                  })}
              </dd>
            </div>
            {occupancy !== null && (
              <div className={css.rowMeter}>
                <MeterBar percent={occupancy.percent} className={css.meter} fillClassName={css.meterFill} />
              </div>
            )}
            <div className={css.row}>
              <dt>{t('usage.session')}</dt>
              <dd>{total === 0 ? t('usage.sessionEmpty') : formatTokens(total)}</dd>
            </div>
            {usage !== undefined && total > 0 && (
              <>
                <div className={css.rowDetail}>
                  <dt>{t('usage.input')}</dt>
                  <dd>{formatTokens(billedInputTokens(usage))}</dd>
                </div>
                <div className={css.rowDetail}>
                  <dt>{t('usage.output')}</dt>
                  <dd>{formatTokens(usage.outputTokens)}</dd>
                </div>
                {cache !== null && (
                  <div className={css.rowDetail}>
                    <dt>{t('usage.cache')}</dt>
                    <dd>{t('usage.cacheValue', { percent: String(cache) })}</dd>
                  </div>
                )}
              </>
            )}
          </dl>
          {quota !== null && <QuotaSection quota={quota} t={t} />}
          {workerSelection !== null && (
            <>
              <dl className={css.rows}>
                <div className={css.row}>
                  <dt>{t('role.worker')}</dt>
                  <dd>{routeLabelFor(directorySnap, workerSelection).model}</dd>
                </div>
              </dl>
              {workerQuota !== null && <QuotaSection quota={workerQuota} t={t} />}
            </>
          )}
          <button type="button" className={css.manage} onClick={openAllQuotas}>
            {t('usages.viewAll')}
          </button>
          <button type="button" className={css.manage} onClick={openKeys}>
            {t('usage.manageKeys')}
          </button>
        </section>
      )}
      <Tooltip label={headline} delayMs={500} disabled={wide || open} side="right">
        <button
          type="button"
          className={css.badge}
          aria-label={t('usage.triggerAria', { route: headline, occupancy: occupancyLabel })}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-active={open || undefined}
          onClick={() => { setOpen(value => !value) }}
        >
          {occupancy === null ? <IconDataOutline16 size={wide ? 16 : 18} /> : <Ring percent={occupancy.percent} />}
          {wide && (
            <span className={css.badgeBody}>
              <span className={css.badgeLabel}>{headline}</span>
              <span className={css.badgeMeta}>{meta}</span>
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  )
}
