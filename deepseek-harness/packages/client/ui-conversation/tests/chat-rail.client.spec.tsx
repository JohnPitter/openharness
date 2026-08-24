// @vitest-environment jsdom
// ChatRail waypoints: dots by default; a click pins titles open. User marks
// stay dots whose accessible name is the first line.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { ChatRail } from '../src/client/chat/ChatRail.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh, commonZh)

function store(entries: readonly ChatNode[]): { get(key: string): ChatNode | undefined } {
  const byKey = new Map(entries.map(entry => [entry.key, entry]))
  return { get: key => byKey.get(key) }
}

function userNode(key: string, content: readonly unknown[]): ChatNode {
  return {
    key, kind: 'user', id: key, target: 'chat', anchorSeq: 1,
    location: { kind: 'session' }, visibility: 'visible',
    data: { kind: 'user', seq: 1, time: 1, content, source: { kind: 'user' } },
  } as ChatNode
}

function milestoneNode(key: string, title: string): ChatNode {
  return {
    key, kind: 'milestone', id: key, target: 'chat', anchorSeq: 2,
    location: { kind: 'session' }, visibility: 'visible',
    data: { seq: 2, time: 2, title, body: 'the fact', origin: 'session' },
  }
}

describe('ChatRail', () => {
  it('renders nothing when the session has no waypoints', () => {
    const view = render(<ChatRail order={['missing']} nodes={store([])} t={t} onJump={() => {}} />)
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('jumps recorded milestones and weaker user marks without duplicating user text', () => {
    const onJump = vi.fn<(key: string) => void>()
    const long = `${'a'.repeat(80)}z`
    const nodes = store([
      userNode('u1', [{ type: 'text', text: 'do the thing' }]),
      userNode('u-empty', [{ type: 'text', text: '   ' }]),
      userNode('u-image', [{ type: 'image', text: 'ignored' }]),
      userNode('u-plain', ['not-a-block']),
      userNode('u-long', [{ type: 'text', text: `${long}\nsecond` }]),
      milestoneNode('m1', 'Found the leak'),
    ])
    const view = render(
      <ChatRail
        order={['u1', 'u-empty', 'u-image', 'u-plain', 'u-long', 'missing', 'm1']}
        nodes={nodes}
        t={t}
        onJump={onJump}
      />,
    )
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    expect(nav.getAttribute('data-expanded')).toBeNull()
    expect(view.queryByText('do the thing')).toBeNull()
    expect(view.getByText('Found the leak')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '消息：do the thing' }))
    fireEvent.click(view.getByRole('button', { name: `消息：${'a'.repeat(79)}…` }))
    fireEvent.click(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-expanded')).toBe('')
    expect(onJump.mock.calls.map(call => call[0])).toEqual(['u1', 'u-long', 'm1'])
  })

  function pinnedRail() {
    const view = render(
      <ChatRail
        order={['u1', 'm1']}
        nodes={store([userNode('u1', [{ type: 'text', text: 'do the thing' }]), milestoneNode('m1', 'Found the leak')])}
        t={t}
        onJump={() => {}}
      />,
    )
    fireEvent.click(view.getByRole('button', { name: '里程碑：Found the leak' }))
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    expect(nav.getAttribute('data-expanded')).toBe('')
    return { view, nav }
  }

  it('closes the pinned rail through its close button', () => {
    const { view, nav } = pinnedRail()
    fireEvent.click(view.getByRole('button', { name: zh['rail.close'] }))
    expect(nav.getAttribute('data-expanded')).toBeNull()
    expect(view.queryByRole('button', { name: zh['rail.close'] })).toBeNull()
  })

  it('closes the pinned rail on Escape and on a pointer down outside it', () => {
    const first = pinnedRail()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first.nav.getAttribute('data-expanded')).toBeNull()
    first.view.unmount()

    const again = pinnedRail()
    fireEvent.pointerDown(document.body)
    expect(again.nav.getAttribute('data-expanded')).toBeNull()
  })

  it('keeps the pinned rail open on a pointer down inside it and toggles on background click', () => {
    const { view, nav } = pinnedRail()
    fireEvent.pointerDown(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-expanded')).toBe('')
    fireEvent.click(nav)
    expect(nav.getAttribute('data-expanded')).toBeNull()
    fireEvent.click(nav)
    expect(nav.getAttribute('data-expanded')).toBe('')
  })
})
