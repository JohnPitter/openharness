import { describe, expect, it, vi } from 'vitest'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import {
  DESKTOP_PREVIEW_SOUND,
  DESKTOP_TASK_COMPLETE,
  isRootTaskSession,
  postDesktopPreviewSound,
  postDesktopTaskComplete,
  rootTaskCompletions,
  watchDesktopTaskComplete,
} from '../src/client/desktop-complete.ts'

function sid(id: string): SessionId {
  return id as SessionId
}

function row(id: string, running: boolean, extra?: Partial<SessionSummary>): SessionSummary {
  return {
    id: sid(id),
    displayTitle: extra?.displayTitle ?? id,
    running,
    blank: false,
    updatedAt: 1,
    ...extra,
  }
}

describe('desktop-complete', () => {
  it('treats only parent-less non-subagent rows as the user-facing task', () => {
    expect(isRootTaskSession(row('root', false))).toBe(true)
    expect(isRootTaskSession(row('child', false, { parentId: sid('root') }))).toBe(false)
    expect(isRootTaskSession(row('worker', false, { origin: 'subagent' }))).toBe(false)
  })

  it('does not chime on first observation of an already-idle session', () => {
    const { next, completed } = rootTaskCompletions(new Map(), {
      [sid('a')]: row('a', false, { title: 'Ship the client' }),
    }, 'ding')
    expect(completed).toEqual([])
    expect(next.get(sid('a'))).toBe(false)
  })

  it('emits a root that went running → idle and prefers the durable title', () => {
    const prev = new Map<SessionId, boolean>([[sid('a'), true], [sid('child'), true]])
    const { completed } = rootTaskCompletions(prev, {
      [sid('a')]: row('a', false, { title: 'Ship the client', displayTitle: 'a' }),
      [sid('child')]: row('child', false, { parentId: sid('a'), displayTitle: 'worker' }),
    }, 'chimes')
    expect(completed).toEqual([{
      sessionId: sid('a'), title: 'Ship the client', sound: 'chimes',
    }])
  })

  it('falls back to the list label when no durable title exists', () => {
    const prev = new Map<SessionId, boolean>([[sid('a'), true]])
    const { completed } = rootTaskCompletions(prev, {
      [sid('a')]: row('a', false, { displayTitle: 'openharness' }),
    })
    expect(completed).toEqual([{
      sessionId: sid('a'), title: 'openharness', sound: 'notify-email',
    }])
  })

  it('does not emit a still-running root or a child going idle', () => {
    const prev = new Map<SessionId, boolean>([[sid('a'), true], [sid('child'), true]])
    const { completed } = rootTaskCompletions(prev, {
      [sid('a')]: row('a', true),
      [sid('child')]: row('child', false, { origin: 'subagent' }),
    })
    expect(completed).toEqual([])
  })

  it.each(['approval', 'plan-review', 'question'] as const)(
    'does not chime when a root only stopped to block on a pending %s',
    (pendingInteraction) => {
      const prev = new Map<SessionId, boolean>([[sid('a'), true]])
      const { next, completed } = rootTaskCompletions(prev, {
        [sid('a')]: row('a', false, { title: 'Ship the client', pendingInteraction }),
      }, 'ding')
      expect(completed).toEqual([])
      // The pause is still recorded, so a later real idle correctly diffs against it.
      expect(next.get(sid('a'))).toBe(false)
    },
  )

  it('chimes on the real idle once a pending interaction clears, not on the pause that preceded it', () => {
    let prev = new Map<SessionId, boolean>()

    // Task starts running.
    prev = rootTaskCompletions(prev, { [sid('a')]: row('a', true, { title: 'Ship the client' }) }).next
    // It pauses to ask the user something — no chime yet.
    let result = rootTaskCompletions(prev, {
      [sid('a')]: row('a', false, { title: 'Ship the client', pendingInteraction: 'question' }),
    })
    expect(result.completed).toEqual([])
    prev = result.next
    // The user answers and the agent resumes.
    prev = rootTaskCompletions(prev, { [sid('a')]: row('a', true, { title: 'Ship the client' }) }).next
    // The task actually finishes.
    result = rootTaskCompletions(prev, { [sid('a')]: row('a', false, { title: 'Ship the client' }) }, 'chord')
    expect(result.completed).toEqual([{ sessionId: sid('a'), title: 'Ship the client', sound: 'chord' }])
  })

  it('watches the list store and posts each new idle edge once', () => {
    let snapshot: Pick<SessionListState, 'byId'> = { byId: { [sid('a')]: row('a', true) } }
    const listeners = new Set<() => void>()
    const list = {
      getSnapshot: () => snapshot as SessionListState,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    }
    const posted: string[] = []
    const stop = watchDesktopTaskComplete(
      list,
      (event) => { posted.push(`${event.title}:${event.sound}`) },
      () => 'tada',
    )
    expect(posted).toEqual([])

    snapshot = { byId: { [sid('a')]: row('a', false, { title: 'Done' }) } }
    for (const fn of listeners) fn()
    expect(posted).toEqual(['Done:tada'])

    for (const fn of listeners) fn()
    expect(posted).toEqual(['Done:tada'])
    stop()
    expect(listeners.size).toBe(0)
  })

  it('posts through the embedding window when no sink is injected', () => {
    const posted: unknown[] = []
    vi.stubGlobal('window', {
      parent: { postMessage: (data: unknown) => { posted.push(data) } },
    })
    let snapshot: Pick<SessionListState, 'byId'> = { byId: { [sid('a')]: row('a', true) } }
    const listeners = new Set<() => void>()
    const list = {
      getSnapshot: () => snapshot as SessionListState,
      subscribe: (fn: () => void) => {
        listeners.add(fn)
        return () => { listeners.delete(fn) }
      },
    }
    const stop = watchDesktopTaskComplete(list, undefined, () => 'ding')
    snapshot = { byId: { [sid('a')]: row('a', false, { title: 'Done' }) } }
    for (const fn of listeners) fn()
    expect(posted).toEqual([{ type: DESKTOP_TASK_COMPLETE, title: 'Done', sound: 'ding' }])
    stop()
    vi.unstubAllGlobals()
  })
})

describe('postDesktopTaskComplete', () => {
  it('is a no-op without a window', () => {
    expect(() => postDesktopTaskComplete({
      sessionId: sid('a'), title: 'Done', sound: 'ding',
    })).not.toThrow()
  })

  it('posts to a distinct parent window', () => {
    const posted: unknown[] = []
    vi.stubGlobal('window', {
      parent: { postMessage: (data: unknown, origin: string) => { posted.push([data, origin]) } },
    })
    postDesktopTaskComplete({ sessionId: sid('a'), title: 'Done', sound: 'chord' })
    expect(posted).toEqual([[{
      type: DESKTOP_TASK_COMPLETE, title: 'Done', sound: 'chord',
    }, '*']])
    vi.unstubAllGlobals()
  })

  it('skips a top-level window', () => {
    const posted: unknown[] = []
    const w: { parent?: unknown; postMessage: (data: unknown) => void } = {
      postMessage: (data) => { posted.push(data) },
    }
    w.parent = w
    vi.stubGlobal('window', w)
    postDesktopTaskComplete({ sessionId: sid('a'), title: 'Done', sound: 'ding' })
    expect(posted).toEqual([])
    vi.unstubAllGlobals()
  })
})

describe('postDesktopPreviewSound', () => {
  it('posts a preview request to the parent shell', () => {
    const posted: unknown[] = []
    vi.stubGlobal('window', {
      parent: { postMessage: (data: unknown) => { posted.push(data) } },
    })
    postDesktopPreviewSound('chimes')
    expect(posted).toEqual([{ type: DESKTOP_PREVIEW_SOUND, sound: 'chimes' }])
    vi.unstubAllGlobals()
  })
})
