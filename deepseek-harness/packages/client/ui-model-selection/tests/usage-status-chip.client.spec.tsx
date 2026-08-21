// @vitest-environment jsdom
/** Sidebar usage chip: route, occupancy, session totals, and Models settings. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountUsageView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import type { UsageStatusChipProps } from '../src/client/UsageStatusChip.tsx'
import { UsageStatusChip } from '../src/client/UsageStatusChip.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const sid = 's1' as SessionId

function directory(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'kimi-for-coding', model: 'k3-256k' },
    routable: true,
    groups: [{
      id: 'kimi-for-coding',
      name: 'Kimi for Code',
      models: [{ id: 'k3-256k', name: 'K3-256k', contextWindow: 262_144 }],
    }],
    failures: [],
    status: 'ready',
    error: null,
    ...overrides,
  }
}

function listState(overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: [sid],
    byId: {
      [sid]: {
        id: sid,
        displayTitle: 'Chat',
        running: false,
        blank: false,
        updatedAt: 0,
        projectionValues: {
          tokenUsage: {
            uncachedInputTokens: 800,
            outputTokens: 200,
            cacheReadTokens: 200,
            cacheWriteTokens: 0,
          },
          contextPressure: { projectedTokens: 40_000, contextWindow: 100_000 },
        },
      },
    },
    current: sid,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
    ...overrides,
  }
}

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

function mount(options: {
  wide?: boolean
  list?: SessionListState
  directory?: ModelDirectoryState
  quota?: AccountUsageView
} = {}) {
  const ensureDirectory = vi.fn()
  const openModels = vi.fn()
  const openUsages = vi.fn()
  const loadAccountUsage = vi.fn(() => Promise.resolve(options.quota ?? { supported: false }))
  const list = options.list ?? listState()
  const dir = options.directory ?? directory()
  const unused = (() => { throw new Error('unused') }) as never
  const props: UsageStatusChipProps = {
    wide: options.wide ?? true,
    useSessions: select => select(list),
    useWorkspaces: unused,
    directory: {
      getSnapshot: () => dir,
      subscribe: () => () => {},
    },
    ensureDirectory,
    openModels,
    openUsages,
    loadAccountUsage,
    t: interpolate as UsageStatusChipProps['t'],
  }
  const view = render(<UsageStatusChip {...props} />)
  return { view, ensureDirectory, openModels, openUsages, loadAccountUsage }
}

describe('UsageStatusChip', () => {
  it('loads the staged directory and shows route plus occupancy', () => {
    const { ensureDirectory } = mount()
    expect(ensureDirectory).toHaveBeenCalledWith(sid)
    const trigger = screen.getByRole('button', {
      name: en['usage.triggerAria']
        .replace('{route}', 'Kimi for Code · K3-256k')
        .replace('{occupancy}', '40%'),
    })
    expect(trigger.textContent).toContain('Kimi for Code · K3-256k')
    expect(trigger.textContent).toContain('40%')
    expect(trigger.textContent).toContain('100K')
  })

  it('opens the panel with session totals and hands Models to settingsNav', () => {
    const { openModels } = mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('dialog', { name: en['usage.panelAria'] })).toBeTruthy()
    expect(screen.getByText(en['usage.session'])).toBeTruthy()
    expect(screen.getByText('1.2K')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en['usage.manageKeys'] }))
    expect(openModels).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and outside pointerdown', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the panel open when the pointer stays inside', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    fireEvent.pointerDown(screen.getByRole('dialog'))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('renders the rail trigger without the wide label', () => {
    mount({ wide: false })
    const trigger = screen.getByRole('button', { expanded: false })
    expect(trigger.textContent).toBe('')
  })

  it('fixes the rail panel to the viewport so the sidebar clip cannot hide it', () => {
    mount({ wide: false })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const dialog = screen.getByRole('dialog', { name: en['usage.panelAria'] })
    expect(dialog.style.width).toBe('240px')
  })

  it('shows advertised context when occupancy is unknown', () => {
    mount({
      list: listState({
        byId: {
          [sid]: {
            id: sid,
            displayTitle: 'Chat',
            running: false,
            blank: false,
            updatedAt: 0,
            projectionValues: {},
          },
        },
      }),
    })
    expect(screen.getByText('262K')).toBeTruthy()
  })

  it('shows idle copy when no model or usage is known', () => {
    mount({
      list: listState({
        current: undefined,
        ids: [],
        byId: {},
      }),
      directory: directory({ current: null, groups: [] }),
    })
    expect(screen.getByText(en['usage.idle'])).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(en['usage.contextUnknown'])).toBeTruthy()
    expect(screen.getByText(en['usage.sessionEmpty'])).toBeTruthy()
  })

  it('loads account quota for the staged provider when the panel opens', async () => {
    const { loadAccountUsage } = mount({
      quota: {
        supported: true,
        plan: 'Moderato',
        windows: [
          { id: 'weekly', used: 214, limit: 2048, percent: 10 },
          { id: 'rate', used: 139, limit: 200, percent: 70, windowMinutes: 300 },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(loadAccountUsage).toHaveBeenCalledWith('kimi-for-coding')
    await waitFor(() => {
      expect(screen.getByText(en['usage.quota'])).toBeTruthy()
    })
    expect(screen.getByText('Moderato')).toBeTruthy()
    expect(screen.getByText(en['usage.quotaShared'])).toBeTruthy()
    expect(screen.getByText(en['usage.quotaWeekly'])).toBeTruthy()
    expect(screen.getByText('214 / 2048')).toBeTruthy()
    expect(screen.getByText(en['usage.quotaRate'].replace('{hours}', '5'))).toBeTruthy()
    expect(screen.getByText('139 / 200')).toBeTruthy()
  })

  it('asks only the staged provider for account quota', async () => {
    const { loadAccountUsage } = mount({
      directory: directory({
        current: { provider: 'claude-code', model: 'claude-sonnet-4-5' },
        groups: [
          {
            id: 'claude-code',
            name: 'Claude Code',
            models: [{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 5', contextWindow: 1_000_000 }],
          },
          {
            id: 'openai-codex',
            name: 'Codex',
            models: [{ id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 272_000 }],
          },
        ],
      }),
      quota: {
        supported: true,
        windows: [
          { id: 'weekly', used: 35, limit: 100, percent: 35 },
          { id: 'rate', used: 6, limit: 100, percent: 6, windowMinutes: 300 },
        ],
      },
    })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    await waitFor(() => {
      expect(screen.getByText(en['usage.quotaPercent'].replace('{percent}', '35'))).toBeTruthy()
    })
    expect(loadAccountUsage).toHaveBeenCalledTimes(1)
    expect(loadAccountUsage).toHaveBeenCalledWith('claude-code')
    expect(screen.queryByText('Codex')).toBeNull()
    expect(screen.getAllByText(en['usage.quotaWeekly'])).toHaveLength(1)
  })

  it('hides the quota section when the provider has no account surface', async () => {
    const { loadAccountUsage } = mount({ quota: { supported: false } })
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(loadAccountUsage).toHaveBeenCalledWith('kimi-for-coding')
    await waitFor(() => {
      expect(screen.queryByText(en['usage.quotaLoading'])).toBeNull()
    })
    expect(screen.queryByText(en['usage.quota'])).toBeNull()
  })
})
