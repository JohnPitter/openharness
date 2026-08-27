// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskCompleteSoundRow } from '../src/client/settings/TaskCompleteSoundRow.tsx'
import type { TaskCompleteSoundRowProps } from '../src/client/settings/TaskCompleteSoundRow.tsx'
import { TaskCompleteSoundPolicy } from '../src/client/settings/sound-policy.ts'
import { DESKTOP_PREVIEW_SOUND } from '../src/client/desktop-complete.ts'
import { en } from '../src/client/locales.ts'
import type { TaskCompleteSound } from '../src/desktop-sound-settings.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  Object.defineProperty(window, 'parent', { configurable: true, value: window })
})

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  }))
}

function mountDesktop() {
  const posted: unknown[] = []
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: (data: unknown) => { posted.push(data) } },
  })

  const policy = new TaskCompleteSoundPolicy()
  const setTaskCompleteSound = vi.fn((sound: TaskCompleteSound) => {
    policy.setSound(sound)
  })
  const props: TaskCompleteSoundRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useTaskCompleteSound: bindSnapshotSelector(policy.sound),
    setTaskCompleteSound,
    t: makeTranslate(en),
  }
  render(<TaskCompleteSoundRow {...props} />)
  return { policy, setTaskCompleteSound, posted }
}

describe('TaskCompleteSoundRow', () => {
  it('hides outside the desktop shell', () => {
    Object.defineProperty(window, 'parent', { configurable: true, value: window })
    const policy = new TaskCompleteSoundPolicy()
    render(<TaskCompleteSoundRow
      useSessions={emptySessions()}
      useWorkspaces={emptyWorkspaces()}
      useTaskCompleteSound={bindSnapshotSelector(policy.sound)}
      setTaskCompleteSound={() => {}}
      t={makeTranslate(en)}
    />)
    expect(screen.queryByText('Task complete sound')).toBeNull()
  })

  it('selects a sound and previews through the shell', () => {
    const b = mountDesktop()
    expect(screen.getByText('Task complete sound')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Email notify/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ding' }))
    expect(b.setTaskCompleteSound).toHaveBeenCalledWith('ding')

    act(() => { b.policy.setSound('ding') })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(b.posted).toEqual([{ type: DESKTOP_PREVIEW_SOUND, sound: 'ding' }])
  })
})
