import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ChatView.module.css'
import {
  packedTrackHeight,
  placeRailPreview,
  shouldFollowTrackTail,
  tickTop,
  trackOverflows,
} from './rail-preview.ts'

interface ChatRailProps {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): ChatConversationViewNode | undefined }
  readonly t: ChatViewSlotProps['t']
  readonly onJump: (key: string) => void
}

interface Waypoint {
  readonly key: string
  readonly kind: 'milestone' | 'user'
  readonly title: string
  readonly body: string
}

function firstLine(node: ChatNode<'user'>): string {
  const texts: string[] = []
  for (const block of node.data.content) {
    if (block.type === 'text') texts.push(block.text)
  }
  const line = texts.join('\n').trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

function clipBody(text: string): string {
  const line = text.trim()
  return line.length > 280 ? `${line.slice(0, 279)}…` : line
}

/**
 * Jump index: ticks pack from the top on an 8px rhythm so a short session
 * never stretches markers across the conversation column. When the stack
 * exceeds the sticky column the track scrolls and follows its tail until
 * the pointer moves it. Titles live in a viewport-fixed preview for the
 * hovered or pinned waypoint so the conversation scroller and composer
 * cannot clip it. A click jumps and pins that preview; Escape or a pointer
 * down outside the rail returns to ticks.
 * @param props - ordered Chat keys, node map, locale, and jump handler.
 * @returns the rail, or null when the session has no waypoints.
 */
export function ChatRail({ order, nodes, t, onJump }: ChatRailProps) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const [previewPos, setPreviewPos] = useState<{ left: number; top: number } | null>(null)
  const [scrollable, setScrollable] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const followTail = useRef(true)
  const previewDomId = `dsh-rail-preview-${useId().replace(/:/g, '')}`
  const previewKey = pinnedKey ?? hoveredKey

  useEffect(() => {
    if (pinnedKey === null) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return
      setPinnedKey(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setPinnedKey(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [pinnedKey])

  const waypoints = useMemo(() => {
    const items: Waypoint[] = []
    for (const key of order) {
      const node = nodes.get(key)
      if (node === undefined) continue
      if (node.kind === 'milestone') {
        const data = (node as ChatNode<'milestone'>).data
        items.push({ key, kind: 'milestone', title: data.title, body: clipBody(data.body) })
      } else if (node.kind === 'user') {
        const title = firstLine(node as ChatNode<'user'>)
        if (title.length > 0) items.push({ key, kind: 'user', title, body: '' })
      }
    }
    return items
  }, [order, nodes])

  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null) return
    const sync = (): void => {
      setScrollable(trackOverflows(track))
      if (followTail.current) track.scrollTop = track.scrollHeight
    }
    sync()
    window.addEventListener('resize', sync)
    return () => { window.removeEventListener('resize', sync) }
  }, [waypoints.length])

  const preview = previewKey === null
    ? undefined
    : waypoints.find(item => item.key === previewKey)

  useLayoutEffect(() => {
    if (preview === undefined) {
      setPreviewPos(null)
      return
    }
    const place = (): void => {
      const tick = navRef.current?.querySelector<HTMLElement>('[data-active]')
      const panel = previewRef.current
      if (tick === null || tick === undefined || panel === null) return
      setPreviewPos(placeRailPreview(
        tick.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [preview])

  if (waypoints.length === 0) return null

  return (
    <nav
      ref={navRef}
      className={css.rail}
      data-pinned={pinnedKey !== null ? '' : undefined}
      data-scrollable={scrollable ? '' : undefined}
      aria-label={t('rail.aria')}
      onPointerLeave={() => { setHoveredKey(null) }}
    >
      <div
        ref={trackRef}
        className={css.railStack}
        data-virtual-count={waypoints.length}
        onScroll={event => {
          followTail.current = shouldFollowTrackTail(event.currentTarget)
        }}
        onWheel={event => {
          if (!scrollable) return
          event.stopPropagation()
        }}
      >
        <div className={css.railTrack} style={{ height: packedTrackHeight(waypoints.length) }}>
          {waypoints.map((item, index) => (
            <button
              key={item.key}
              type="button"
              className={css.railTick}
              style={{ top: tickTop(index) }}
              data-kind={item.kind}
              data-active={previewKey === item.key ? '' : undefined}
              aria-label={item.kind === 'milestone'
                ? t('rail.milestone', { title: item.title })
                : t('rail.user', { title: item.title })}
              aria-expanded={pinnedKey === item.key ? true : undefined}
              aria-controls={previewKey === item.key ? previewDomId : undefined}
              onPointerEnter={event => {
                if (event.pointerType === 'mouse') setHoveredKey(item.key)
              }}
              onClick={() => {
                setPinnedKey(item.key)
                onJump(item.key)
              }}
            />
          ))}
        </div>
      </div>
      {preview !== undefined && (
        <div
          ref={previewRef}
          id={previewDomId}
          className={css.railPreview}
          style={previewPos ?? { visibility: 'hidden', left: 0, top: 0 }}
          data-kind={preview.kind}
        >
          <div className={css.railPreviewTitle}>{preview.title}</div>
          {preview.body !== '' && (
            <div className={css.railPreviewBody}>{preview.body}</div>
          )}
        </div>
      )}
    </nav>
  )
}
