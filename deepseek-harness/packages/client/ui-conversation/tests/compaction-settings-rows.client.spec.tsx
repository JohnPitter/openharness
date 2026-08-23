// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CompactionAutoRow, CompactionThresholdRow,
} from '../src/client/settings/CompactionSettingsRows.tsx'
import type { CompactionSettingsRowProps } from '../src/client/settings/CompactionSettingsRows.tsx'
import { CompactionSettingsPolicy } from '../src/client/settings/compaction-policy.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
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

function mount() {
  const policy = new CompactionSettingsPolicy()
  const setCompactionAuto = vi.fn((auto: boolean) => { policy.setAuto(auto) })
  const setCompactionThreshold = vi.fn((percent: 25 | 50 | 75 | 100) => {
    policy.setThresholdPercent(percent)
  })
  const props: CompactionSettingsRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useCompactionAuto: bindSnapshotSelector(policy.auto),
    useCompactionThreshold: bindSnapshotSelector(policy.thresholdPercent),
    setCompactionAuto,
    setCompactionThreshold,
    t: makeTranslate(en),
  }
  render(
    <>
      <CompactionAutoRow {...props} />
      <CompactionThresholdRow {...props} />
    </>,
  )
  return { policy, setCompactionAuto, setCompactionThreshold }
}

describe('compaction Settings rows', () => {
  it('shows On and 75% by default', () => {
    mount()
    expect(screen.getByText('Automatic compaction')).toBeDefined()
    expect(screen.getByText('Compaction threshold')).toBeDefined()
    expect(screen.getByRole('button', { name: /On/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: '75%' }).getAttribute('disabled')).toBeNull()
  })

  it('turns automatic compaction off and disables the threshold selector', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /On/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(b.setCompactionAuto).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: /Off/ })).toBeDefined()
    expect(screen.getByRole('button', { name: '75%' })).toHaveProperty('disabled', true)
  })

  it('closes the automatic-compaction menu outside', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /On/ }))
    expect(screen.getByRole('menuitem', { name: 'Off' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Off' })).toBeNull()
  })

  it('selects 50% and follows later preference changes', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: '75%' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '50%' }))
    expect(b.setCompactionThreshold).toHaveBeenCalledWith(50)
    expect(screen.getByRole('button', { name: '50%' })).toBeDefined()

    act(() => { b.policy.setThresholdPercent(25) })
    expect(screen.getByRole('button', { name: '25%' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '25%' }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: '50%' })).toBeNull()
  })
})
