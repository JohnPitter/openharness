import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './ChatView.module.css'

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

function tickOffset(index: number, count: number): string {
  if (count <= 1) return '0%'
  return `${(index / (count - 1)) * 100}%`
}

/**
 * Viewport-height jump index: a virtual minimap of ticks, not a growing list.
 * Titles live in a floating preview for the hovered or pinned waypoint; a
 * click jumps and pins that preview, and Escape or a pointer down outside
 * the rail returns to ticks. ChatView mounts this in a full-flow overlay so
 * it can stick in the conversation scrollport. Narrow columns overlay the
 * preview on the transcript from the left padding — the track stays sticky
 * and never switches to absolute positioning.
 * @param props - ordered Chat keys, node map, locale, and jump handler.
 * @returns the rail, or null when the session has no waypoints.
 */
export function ChatRail({ order, nodes, t, onJump }: ChatRailProps) {
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const navRef = useRef<HTMLElement | null>(null)
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

  if (waypoints.length === 0) return null
  const preview = previewKey === null
    ? undefined
    : waypoints.find(item => item.key === previewKey)
  const previewIndex = preview === undefined
    ? -1
    : waypoints.findIndex(item => item.key === preview.key)

  return (
    <nav
      ref={navRef}
      className={css.rail}
      data-pinned={pinnedKey !== null ? '' : undefined}
      aria-label={t('rail.aria')}
      onPointerLeave={() => { setHoveredKey(null) }}
    >
      <div className={css.railTrack} data-virtual-count={waypoints.length}>
        {waypoints.map((item, index) => (
          <button
            key={item.key}
            type="button"
            className={css.railTick}
            style={{ top: tickOffset(index, waypoints.length) }}
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
      {preview !== undefined && (
        <div
          id={previewDomId}
          className={css.railPreview}
          style={{ top: tickOffset(Math.max(0, previewIndex), waypoints.length) }}
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
