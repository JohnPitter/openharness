import { useEffect, useMemo, useRef, useState } from 'react'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
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
}

function firstLine(node: ChatNode<'user'>): string {
  const texts: string[] = []
  for (const block of node.data.content) {
    if (block.type === 'text') texts.push(block.text)
  }
  const line = texts.join('\n').trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * Sticky jump index: dots by default; milestone titles appear on hover,
 * keyboard focus, or click. A waypoint click pins every title open, including
 * user first-lines that stay dots until then. The pinned rail closes through
 * its close button, Escape, a pointer down outside it, or a click on its own
 * background (pointer events only reach the rail while pinned, so a collapsed
 * rail never blocks the transcript gutter). ChatView mounts this in a full-flow
 * overlay so it can stick in the conversation scrollport. On viewports 720px
 * or narrower the pinned rail overlays the transcript from the left padding
 * and stays sticky — it does not switch to absolute positioning.
 * @param props - ordered Chat keys, node map, locale, and jump handler.
 * @returns the rail, or null when the session has no waypoints.
 */
export function ChatRail({ order, nodes, t, onJump }: ChatRailProps) {
  const [expanded, setExpanded] = useState(false)
  const navRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!expanded) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && navRef.current?.contains(event.target)) return
      setExpanded(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [expanded])
  const waypoints = useMemo(() => {
    const items: Waypoint[] = []
    for (const key of order) {
      const node = nodes.get(key)
      if (node === undefined) continue
      if (node.kind === 'milestone') {
        items.push({ key, kind: 'milestone', title: (node as ChatNode<'milestone'>).data.title })
      } else if (node.kind === 'user') {
        const title = firstLine(node as ChatNode<'user'>)
        if (title.length > 0) items.push({ key, kind: 'user', title })
      }
    }
    return items
  }, [order, nodes])

  if (waypoints.length === 0) return null
  return (
    <nav
      ref={navRef}
      className={css.rail}
      data-expanded={expanded ? '' : undefined}
      aria-label={t('rail.aria')}
      onClick={(event) => {
        if (event.target === event.currentTarget) setExpanded(open => !open)
      }}
    >
      {expanded && (
        <button
          type="button"
          className={css.railClose}
          aria-label={t('rail.close')}
          title={t('rail.close')}
          onClick={() => { setExpanded(false) }}
        >
          <IconCloseOutline16 size={12} />
        </button>
      )}
      {waypoints.map(item => (
        <button
          key={item.key}
          type="button"
          className={item.kind === 'milestone' ? css.railMilestone : css.railUser}
          aria-label={item.kind === 'milestone'
            ? t('rail.milestone', { title: item.title })
            : t('rail.user', { title: item.title })}
          title={item.kind === 'milestone'
            ? t('rail.milestone', { title: item.title })
            : t('rail.user', { title: item.title })}
          onClick={() => {
            setExpanded(true)
            onJump(item.key)
          }}
        >
          <span className={css.railDot} data-kind={item.kind} aria-hidden />
          {(item.kind === 'milestone' || expanded) && (
            <span className={css.railLabel}>{item.title}</span>
          )}
        </button>
      ))}
    </nav>
  )
}
