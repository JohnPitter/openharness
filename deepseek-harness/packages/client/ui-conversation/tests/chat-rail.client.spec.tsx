// @vitest-environment jsdom
// ChatRail waypoints: ticks pack from the top on an 8px rhythm. A click
// jumps and pins a viewport-fixed preview; titles stay out of the track until then.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
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

function stubTickRect(tick: HTMLElement, rect: { top: number; right: number }): void {
  tick.getBoundingClientRect = () => ({
    top: rect.top, right: rect.right, left: rect.right - 16, bottom: rect.top + 8,
    width: 16, height: 8, x: rect.right - 16, y: rect.top, toJSON: () => ({}),
  })
}

describe('ChatRail', () => {
  it('renders nothing without waypoints', () => {
    const view = render(
      <ChatRail order={['missing']} nodes={store([])} t={t} onJump={() => {}} />,
    )
    expect(view.queryByRole('navigation')).toBeNull()
  })

  it('places a single waypoint at the top pad', () => {
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Only')])}
        t={t}
        onJump={() => {}}
      />,
    )
    const tick = view.getByRole('button') as HTMLElement
    expect(tick.style.top).toBe('6px')
    fireEvent.click(tick)
    expect(view.getByText('Only')).toBeTruthy()
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
    expect(nav.getAttribute('data-scrollable')).toBeNull()
    const ticks = view.getAllByRole('button')
    expect(ticks.map(tick => (tick as HTMLElement).style.top)).toEqual(['6px', '14px', '22px'])
    expect(screen.queryByText('do the thing')).toBeNull()
    expect(screen.queryByText('Found the leak')).toBeNull()
    expect(nav.querySelector('[data-virtual-count]')?.getAttribute('data-virtual-count')).toBe('3')
    fireEvent.click(view.getByRole('button', { name: '消息：do the thing' }))
    expect(screen.getByText('do the thing')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: `消息：${'a'.repeat(79)}…` }))
    fireEvent.click(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-pinned')).toBe('')
    expect(screen.getByText('Found the leak')).toBeTruthy()
    expect(screen.getByText('the fact')).toBeTruthy()
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
    expect(screen.queryByText('Found the leak')).toBeNull()
    first.view.unmount()

    const again = pinnedRail()
    fireEvent.pointerDown(document.body)
    expect(again.nav.getAttribute('data-pinned')).toBeNull()
  })

  it('keeps the pinned preview open on a pointer down inside the rail or the preview', () => {
    const { view, nav } = pinnedRail()
    fireEvent.pointerDown(view.getByRole('button', { name: '里程碑：Found the leak' }))
    expect(nav.getAttribute('data-pinned')).toBe('')
    expect(screen.getByText('Found the leak')).toBeTruthy()
    fireEvent.pointerDown(screen.getByText('Found the leak'))
    expect(nav.getAttribute('data-pinned')).toBe('')
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(nav.getAttribute('data-pinned')).toBe('')
  })

  it('opens a hover preview for mouse pointers and ignores touch hover', () => {
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Only')])}
        t={t}
        onJump={() => {}}
      />,
    )
    const tick = view.getByRole('button')
    fireEvent.pointerEnter(tick, { pointerType: 'touch' })
    expect(view.queryByText('Only')).toBeNull()
    fireEvent.pointerEnter(tick, { pointerType: 'mouse' })
    expect(view.getByText('Only')).toBeTruthy()
    fireEvent.pointerLeave(view.getByRole('navigation', { name: zh['rail.aria'] }))
    expect(view.queryByText('Only')).toBeNull()
  })

  it('keeps a pinned preview after the pointer leaves the rail', () => {
    const { view, nav } = pinnedRail()
    fireEvent.pointerLeave(nav)
    expect(nav.getAttribute('data-pinned')).toBe('')
    expect(view.getByText('Found the leak')).toBeTruthy()
  })

  it('places the preview from the tick rect after a viewport resize', () => {
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Only')])}
        t={t}
        onJump={() => {}}
      />,
    )
    const tick = view.getByRole('button') as HTMLElement
    stubTickRect(tick, { top: 40, right: 100 })
    fireEvent.click(tick)
    const preview = screen.getByText('Only').parentElement as HTMLElement
    Object.defineProperty(preview, 'offsetWidth', { configurable: true, value: 120 })
    Object.defineProperty(preview, 'offsetHeight', { configurable: true, value: 40 })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(preview.style.left).toBe('108px')
    expect(preview.style.top).toBe('24px')
  })

  it('packs many waypoints from the top without listing titles', () => {
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
    const last = view.getAllByRole('button').at(-1) as HTMLElement
    expect(last.style.top).toBe('318px')
    expect(screen.queryByText('Mile 0')).toBeNull()
    expect(screen.queryByText('Mile 39')).toBeNull()
    const scroller = nav.querySelector('[data-virtual-count]') as HTMLElement
    expect((scroller.firstElementChild as HTMLElement).style.height).toBe('332px')
  })

  it('keeps the 8px rhythm past 80 waypoints instead of stretching the column', () => {
    const entries = Array.from({ length: 81 }, (_, index) => milestoneNode(`m${index}`, `Mile ${index}`))
    const view = render(
      <ChatRail
        order={entries.map(entry => entry.key)}
        nodes={store(entries)}
        t={t}
        onJump={() => {}}
      />,
    )
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    const ticks = view.getAllByRole('button')
    expect(ticks).toHaveLength(81)
    expect((ticks[0] as HTMLElement).style.top).toBe('6px')
    expect((ticks.at(-1) as HTMLElement).style.top).toBe('646px')
    const scroller = nav.querySelector('[data-virtual-count]') as HTMLElement
    expect((scroller.firstElementChild as HTMLElement).style.height).toBe('660px')
  })

  it('marks the track scrollable and swallows wheel when the stack overflows', () => {
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Only')])}
        t={t}
        onJump={() => {}}
      />,
    )
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    const scroller = nav.querySelector('[data-virtual-count]') as HTMLElement
    const stop = vi.spyOn(Event.prototype, 'stopPropagation')
    fireEvent.wheel(scroller)
    expect(stop).not.toHaveBeenCalled()
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 80 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 400 })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(nav.getAttribute('data-scrollable')).toBe('')
    stop.mockClear()
    fireEvent.wheel(scroller)
    expect(stop).toHaveBeenCalled()
    stop.mockRestore()
  })

  it('stops following the tail after the pointer scrolls the track up', () => {
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Only')])}
        t={t}
        onJump={() => {}}
      />,
    )
    const nav = view.getByRole('navigation', { name: zh['rail.aria'] })
    const scroller = nav.querySelector('[data-virtual-count]') as HTMLElement
    let top = 0
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => 80 })
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 400 })
    Object.defineProperty(scroller, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (value: number) => { top = value },
    })
    fireEvent.scroll(scroller)
    top = 0
    view.rerender(
      <ChatRail
        order={['m1', 'm2']}
        nodes={store([milestoneNode('m1', 'Only'), milestoneNode('m2', 'Next')])}
        t={t}
        onJump={() => {}}
      />,
    )
    expect(top).toBe(0)
  })

  it('clips a long milestone body in the preview', () => {
    const body = `${'b'.repeat(280)}z`
    const view = render(
      <ChatRail
        order={['m1']}
        nodes={store([milestoneNode('m1', 'Long', body)])}
        t={t}
        onJump={() => {}}
      />,
    )
    fireEvent.click(view.getByRole('button'))
    expect(screen.getByText(`${'b'.repeat(279)}…`)).toBeTruthy()
  })
})
