import { useMemo } from 'react'
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
    if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text' && 'text' in block) {
      texts.push(String(block.text))
    }
  }
  const line = texts.join('\n').trim().split('\n')[0] ?? ''
  return line.length > 80 ? `${line.slice(0, 79)}…` : line
}

/**
 * Left rail of jumpable waypoints: recorded milestones plus weaker user-message marks.
 * ChatView mounts this in a full-flow overlay so it can stick in the conversation scrollport.
 * @param props - ordered Chat keys, node map, locale, and jump handler.
 * @returns the rail, or null when the session has no waypoints.
 */
export function ChatRail({ order, nodes, t, onJump }: ChatRailProps) {
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
    <nav className={css.rail} aria-label={t('rail.aria')}>
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
          onClick={() => { onJump(item.key) }}
        >
          <span className={css.railDot} data-kind={item.kind} aria-hidden />
          {item.kind === 'milestone' && <span className={css.railLabel}>{item.title}</span>}
        </button>
      ))}
    </nav>
  )
}
