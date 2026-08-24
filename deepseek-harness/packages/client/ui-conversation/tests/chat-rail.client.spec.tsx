// @vitest-environment jsdom
// ChatRail waypoints: ticks in a viewport-height minimap. A click jumps and
// pins a floating preview; titles stay out of the track until then.

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

function milestoneNode(key: string, title: string, body = 'the fact'): ChatNode {
  return {
    key, kind: 'milestone', id: key, target: 'chat', anchorSeq: 2,
    location: { kind: 'session' }, visibility: 'visible',
    data: { seq: 2, time: 2, title, body, origin: 'session' },
  }
}

describe('ChatRail', () => {
  it('renders nothing when the session has no waypoints', () => {
    const view = render(<ChatRail order={['missing']} nodes={store([])} t={t} onJump={() => {}} />)
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('keeps titles out of the minimap until a waypoint is pinned', () => {
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
    expect(nav.getAttribute('data-pinned')).toBeNull()
    expect(view.queryByText('do the thing')).toBeNull()
    expect(view.queryByText('Found the leak')).toBeNull()
    expect(nav.querySelector('[data-virtual-count]')?.getAttribute('data-virtual-count')).toBe('3')
    fireEvent.click(view.getByRole('button', { name: '消息：do the thing' }))
    expect(view.getByText('do the thing')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: `消息：${'a'.repeat(79)}…` }))
    fireEvent.click(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-pinned')).toBe('')
    expect(view.getByText('Found the leak')).toBeTruthy()
    expect(view.getByText('the fact')).toBeTruthy()
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
    expect(nav.getAttribute('data-pinned')).toBe('')
    return { view, nav }
  }

  it('does not render a close control on the pinned preview', () => {
    const { view } = pinnedRail()
    expect(view.container.querySelector('button[class*="railClose"]')).toBeNull()
    expect(view.getAllByRole('button')).toHaveLength(2)
  })

  it('closes the pinned preview on Escape and on a pointer down outside it', () => {
    const first = pinnedRail()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first.nav.getAttribute('data-pinned')).toBeNull()
    expect(first.view.queryByText('Found the leak')).toBeNull()
    first.view.unmount()

    const again = pinnedRail()
    fireEvent.pointerDown(document.body)
    expect(again.nav.getAttribute('data-pinned')).toBeNull()
  })

  it('keeps the pinned preview open on a pointer down inside it', () => {
    const { view, nav } = pinnedRail()
    fireEvent.pointerDown(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-pinned')).toBe('')
    expect(view.getByText('Found the leak')).toBeTruthy()
  })

  it('packs many waypoints into one viewport-height track without listing titles', () => {
    const entries = Array.from({ length: 40 }, (_, index) => milestoneNode(`m${index}`, `Mile ${index}`))
    const view = render(
      <ChatRail
        order={entries.map(entry => entry.key)}
        nodes={store(entries)}
        t={t}
        onJump={() => {}}
      />,
    )
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    expect(nav.querySelector('[data-virtual-count]')?.getAttribute('data-virtual-count')).toBe('40')
    expect(view.getAllByRole('button')).toHaveLength(40)
    expect(view.queryByText('Mile 0')).toBeNull()
    expect(view.queryByText('Mile 39')).toBeNull()
  })
})
