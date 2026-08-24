/**
 * Sidebar-foot Remote chip: sits above the usage/model row and opens a
 * QR panel through the OpenHarness desktop shell (postMessage to the parent
 * window). The panel is `position: fixed` from the chip rect so the
 * collapsed sidebar clip cannot crop it.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import clsx from 'clsx'
import { IconLinkOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './RemoteChip.module.css'

export type RemoteChipProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'model'>

type RemoteReady = {
  url?: string
  qrDataUrl?: string
  error?: string
  loading?: boolean
}

const PANEL_GAP = 8
const PANEL_MARGIN = 12
const RAIL_PANEL_WIDTH = 240
const MEASURE_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }

/**
 * Place the remote panel outside the sidebar clip: wide opens above the chip,
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
  left = Math.min(Math.max(left, PANEL_MARGIN), window.innerWidth - width - PANEL_MARGIN)
  top = Math.min(Math.max(top, PANEL_MARGIN), window.innerHeight - height - PANEL_MARGIN)
  return { left, top, width }
}

function desktopShell(): boolean {
  return window.parent !== window
}

/**
 * Render the Remote chip and its click-open QR panel.
 * @param props - sidebar owner state plus the model locale seat.
 * @returns the footer action.
 */
export function RemoteChip(props: RemoteChipProps): ReactNode {
  const { wide, t } = props
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState<RemoteReady>({})
  const [copied, setCopied] = useState(false)
  const [panelPos, setPanelPos] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const payload = event.data as { type?: unknown; url?: string; qrDataUrl?: string; error?: string } | undefined
      if (payload?.type !== 'openharness:remote-ready') return
      setRemote({
        ...payload.url !== undefined ? { url: payload.url } : {},
        ...payload.qrDataUrl !== undefined ? { qrDataUrl: payload.qrDataUrl } : {},
        ...payload.error !== undefined ? { error: payload.error } : {},
      })
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  useEffect(() => {
    if (!open) return
    if (remote.url !== undefined || remote.loading === true || remote.error !== undefined) return
    if (!desktopShell()) {
      setRemote({ error: 'desktop-only' })
      return
    }
    setRemote({ loading: true })
    window.parent.postMessage({ type: 'openharness:remote-enable' }, '*')
  }, [open, remote.url, remote.loading, remote.error])

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null)
      return
    }
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      const panel = panelRef.current
      /* v8 ignore next -- layout effect runs after the chip and panel commit */
      if (rect === undefined || panel === null) return
      setPanelPos(anchoredPanelStyle(rect, panel.offsetHeight, wide))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(place)
      /* v8 ignore next -- panel is committed when open */
      if (panel !== null) observer.observe(panel)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, wide, remote])

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

  const url = remote.url
  const stateLabel = url !== undefined
    ? t('remote.active')
    : remote.loading === true
      ? t('remote.connecting')
      : t('remote.idle')

  const copyLink = (url: string): void => {
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true)
        window.setTimeout(() => { setCopied(false) }, 1500)
      },
      () => undefined,
    )
  }

  const stopRemote = (): void => {
    if (desktopShell()) window.parent.postMessage({ type: 'openharness:remote-disable' }, '*')
    setRemote({})
    setCopied(false)
    setOpen(false)
  }

  return (
    <div ref={rootRef} className={clsx(css.layer, !wide && css.rail)}>
      {open && (
        <section
          ref={panelRef}
          className={css.panel}
          role="dialog"
          aria-label={t('remote.panelAria')}
          style={panelPos ?? MEASURE_STYLE}
        >
          <header className={css.title}>{t('remote.title')}</header>
          {remote.loading === true && <div className={css.status}>{t('remote.loading')}</div>}
          {remote.error === 'desktop-only' && <div className={css.status}>{t('remote.desktopOnly')}</div>}
          {remote.error !== undefined && remote.error !== 'desktop-only' && (
            <div className={css.error}>{t('remote.error', { message: remote.error })}</div>
          )}
          {remote.qrDataUrl !== undefined && (
            <img className={css.qr} src={remote.qrDataUrl} alt={t('remote.qrAlt')} />
          )}
          {url !== undefined && (
            <>
              <div className={css.url}>{url}</div>
              <p className={css.hint}>{t('remote.warning')}</p>
              <div className={css.actions}>
                <button type="button" className={css.action} onClick={() => { copyLink(url) }}>
                  {copied ? t('remote.copied') : t('remote.copy')}
                </button>
                <button type="button" className={css.action} onClick={stopRemote}>
                  {t('remote.stop')}
                </button>
              </div>
            </>
          )}
        </section>
      )}
      <Tooltip label={t('remote.title')} delayMs={500} disabled={wide || open} side="right">
        <button
          type="button"
          className={css.badge}
          aria-label={t('remote.triggerAria', { state: stateLabel })}
          aria-haspopup="dialog"
          aria-expanded={open}
          data-active={open || url !== undefined || undefined}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconLinkOutline16 size={wide ? 16 : 18} />
          {wide && (
            <span className={css.badgeBody}>
              <span className={css.badgeLabel}>{t('menu.remote')}</span>
              <span className={css.badgeMeta}>{stateLabel}</span>
            </span>
          )}
        </button>
      </Tooltip>
    </div>
  )
}
