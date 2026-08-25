// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { CommandNode, CompactionSummaryNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { CompactionCommandCard } from '../src/client/chat/CompactionCommandCard.tsx'
import { CompactionItem } from '../src/client/chat/CompactionItem.tsx'
import {
  COMPACTION_PROGRESS_DEADLINE_MS,
  compactionProgressPercent,
} from '../src/client/chat/CompactionProgress.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
})

const t = makeTranslate(zh, commonZh)

describe('compactionProgressPercent', () => {
  it('stays at zero until time has elapsed, then caps below completion', () => {
    expect(compactionProgressPercent(0)).toBe(0)
    expect(compactionProgressPercent(250)).toBe(1)
    expect(compactionProgressPercent(COMPACTION_PROGRESS_DEADLINE_MS)).toBe(92)
    expect(compactionProgressPercent(COMPACTION_PROGRESS_DEADLINE_MS * 4)).toBe(92)
  })
})

describe('running compaction progress', () => {
  it('shows a determinate bar on an in-flight /compact command', () => {
    const node: CommandNode = {
      kind: 'command',
      seq: 5,
      time: 1_700_000_000_000 - 60_000,
      commandId: 'cmd-1' as CommandNode['commandId'],
      name: 'compact',
      args: null,
      outcome: null,
    }
    render(<CompactionCommandCard node={node} t={t} />)
    const bar = screen.getByRole('progressbar')
    expect(bar.getAttribute('aria-valuenow')).toBe('18')
    expect(bar.getAttribute('aria-label') ?? '').toMatch(/正在压缩/)
  })

  it('keeps a landed checkpoint on the compact command card', () => {
    const node: CommandNode = {
      kind: 'command',
      seq: 5,
      time: 1_700_000_000_000,
      commandId: 'cmd-1' as CommandNode['commandId'],
      name: 'compact',
      args: null,
      outcome: { kind: 'success', text: 'done' },
    }
    const compaction: CompactionSummaryNode = {
      kind: 'compaction',
      seq: 8,
      time: 1_700_000_000_000,
      summary: 'facts',
      summaryEventSeq: 7,
      shadowedItemCount: 4,
      shadowedTokenCount: 20,
    }
    render(<CompactionCommandCard node={node} compaction={compaction} t={t} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText(/4/)).toBeTruthy()
  })

  it('keeps a failed compact outcome on the generic command card', () => {
    const node: CommandNode = {
      kind: 'command',
      seq: 5,
      time: 1_700_000_000_000,
      commandId: 'cmd-1' as CommandNode['commandId'],
      name: 'compact',
      args: null,
      outcome: { kind: 'error', text: 'Compaction cancelled.' },
    }
    render(<CompactionCommandCard node={node} t={t} />)
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.getByText('Compaction cancelled.')).toBeTruthy()
  })

  it('ticks the bar while automatic compaction is locked', async () => {
    const node: CompactionSummaryNode = {
      kind: 'compaction',
      seq: 8,
      time: 1_700_000_000_000,
      summary: null,
      summaryEventSeq: null,
      shadowedItemCount: null,
      shadowedTokenCount: null,
      running: true,
    }
    render(<CompactionItem node={node} t={t} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    await act(async () => {
      vi.advanceTimersByTime(250)
    })
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1')
  })
})
