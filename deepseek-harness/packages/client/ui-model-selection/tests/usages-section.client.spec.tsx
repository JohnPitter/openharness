// @vitest-environment jsdom
/** Settings Usages section: local usage panel plus provider account quotas. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountUsageView, ConfigurableProviderView, UsagePanelView } from '@deepseek-ai/dsh-api-remotes/client'
import { UsagesSection } from '../src/client/UsagesSection.tsx'
import type { UsagesSectionInjected } from '../src/client/UsagesSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

const emptyPanel = (): UsagePanelView => ({
  days: [],
  models: [],
  totals: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
})

function mount(options: {
  providers?: ConfigurableProviderView[]
  usages?: Record<string, AccountUsageView>
  panel?: UsagePanelView
  panelError?: string
} = {}) {
  const providers = options.providers ?? [
    {
      provider: 'kimi-for-coding',
      displayName: 'Kimi for Code',
      settingsNs: 'llm-kimi',
      settingsPath: [],
      active: true,
    },
    {
      provider: 'deepseek-official',
      displayName: 'DeepSeek',
      settingsNs: 'llm-deepseek',
      settingsPath: [],
      active: true,
    },
    {
      provider: 'claude-code',
      displayName: 'Claude Code',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'claude-code'],
      active: true,
    },
  ]
  const usages = options.usages ?? {
    'kimi-for-coding': {
      supported: true,
      plan: 'Moderato',
      windows: [
        { id: 'weekly', used: 10, limit: 100, percent: 10 },
        { id: 'rate', used: 5, limit: 100, percent: 5, windowMinutes: 300 },
      ],
    },
    'deepseek-official': { supported: false },
    'claude-code': {
      supported: true,
      windows: [{ id: 'weekly', used: 35, limit: 100, percent: 35 }],
    },
  }
  const panel = options.panel ?? emptyPanel()
  const api = {
    llm: {
      providers: vi.fn(async () => ({
        result: { ok: true as const, value: { providers } },
      })),
      accountUsage: vi.fn(async (request: { provider: string }) => ({
        result: {
          ok: true as const,
          value: usages[request.provider] ?? { supported: false },
        },
      })),
    },
    usage: {
      panel: vi.fn(async () => options.panelError === undefined
        ? { result: { ok: true as const, value: panel } }
        : { result: { ok: false as const, error: { code: 'internal', message: options.panelError, details: {} } } }),
    },
  }
  render(<UsagesSection api={api as unknown as UsagesSectionInjected['api']} t={interpolate as never} />)
  return { api }
}

describe('UsagesSection', () => {
  it('shows the empty history copy when the ledger has no usage', async () => {
    mount({ usages: { 'deepseek-official': { supported: false } }, providers: [] })
    await waitFor(() => {
      expect(screen.getAllByText(en['usages.emptyHistory']).length).toBeGreaterThan(0)
    })
    expect(screen.getByText(en['usages.today'])).toBeTruthy()
    expect(screen.getByText(en['usages.empty'])).toBeTruthy()
  })

  it('lists daily history, ranked models, and quota cards', async () => {
    const today = (() => {
      const date = new Date()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${String(date.getFullYear())}-${month}-${day}`
    })()
    const old = (() => {
      const date = new Date()
      date.setDate(date.getDate() - 8)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${String(date.getFullYear())}-${month}-${day}`
    })()
    mount({
      panel: {
        days: [{
          date: today,
          requests: 3,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }, {
          date: old,
          requests: 1,
          inputTokens: 50,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
        models: [{
          provider: 'kimi-for-coding',
          model: 'kimi-for-coding',
          requests: 3,
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
        totals: {
          requests: 4,
          inputTokens: 1050,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      usages: {
        'kimi-for-coding': {
          supported: true,
          plan: 'Moderato',
          windows: [
            { id: 'weekly', used: 10, limit: 100, percent: 10 },
            { id: 'rate', used: 5, limit: 100, percent: 5, windowMinutes: 300 },
          ],
        },
        'deepseek-official': { supported: false },
        'claude-code': {
          supported: true,
          windows: [{ id: 'weekly', used: 35, limit: 100, percent: 35 }],
        },
        'plan-only': { supported: true, plan: 'Solo' },
        'empty-windows': { supported: true, windows: [] },
      },
      providers: [
        {
          provider: 'kimi-for-coding',
          displayName: 'Kimi for Code',
          settingsNs: 'llm-kimi',
          settingsPath: [],
          active: true,
        },
        {
          provider: 'deepseek-official',
          displayName: 'DeepSeek',
          settingsNs: 'llm-deepseek',
          settingsPath: [],
          active: true,
        },
        {
          provider: 'claude-code',
          displayName: 'Claude Code',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'claude-code'],
          active: true,
        },
        {
          provider: 'plan-only',
          displayName: 'Plan Only',
          settingsNs: 'llm-kimi',
          settingsPath: [],
          active: true,
        },
        {
          provider: 'empty-windows',
          displayName: 'Empty Windows',
          settingsNs: 'llm-kimi',
          settingsPath: [],
          active: true,
        },
      ],
    })
    await waitFor(() => {
      expect(screen.getAllByText('kimi-for-coding').length).toBeGreaterThan(0)
    })
    expect(screen.getByText('Kimi for Code')).toBeTruthy()
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText('Plan Only')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.queryByText('Empty Windows')).toBeNull()
    expect(screen.getByText('Moderato')).toBeTruthy()
    expect(screen.getByText(en['usage.quotaPercent'].replace('{percent}', '35'))).toBeTruthy()
    expect(screen.getByText(en['usages.models'])).toBeTruthy()
  })

  it('refreshes the panel and quotas when asked', async () => {
    const { api } = mount()
    await waitFor(() => {
      expect(screen.getByText('Kimi for Code')).toBeTruthy()
    })
    expect(api.llm.providers).toHaveBeenCalledTimes(1)
    expect(api.usage.panel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en['usages.refresh'] }))
    await waitFor(() => {
      expect(api.llm.providers).toHaveBeenCalledTimes(2)
      expect(api.usage.panel).toHaveBeenCalledTimes(2)
    })
  })

  it('surfaces a panel load failure', async () => {
    mount({ panelError: 'ledger unreadable' })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('ledger unreadable')
    })
  })

  it('renders nothing without an injected api', () => {
    const { container } = render(<UsagesSection t={interpolate as never} />)
    expect(container.textContent).toBe('')
  })

  it('surfaces a provider-list failure', async () => {
    const api = {
      llm: {
        providers: vi.fn(async () => ({
          result: { ok: false as const, error: { message: 'no catalog' } },
        })),
        accountUsage: vi.fn(),
      },
      usage: {
        panel: vi.fn(async () => ({ result: { ok: true as const, value: emptyPanel() } })),
      },
    }
    render(<UsagesSection api={api as unknown as UsagesSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('no catalog')
    })
  })

  it('keeps quota cards that fail or throw while checking', async () => {
    const api = {
      llm: {
        providers: vi.fn(async () => ({
          result: {
            ok: true as const,
            value: {
              providers: [
                {
                  provider: 'broken',
                  displayName: 'Broken Plan',
                  settingsNs: 'llm-kimi',
                  settingsPath: [],
                  active: true,
                },
                {
                  provider: 'boom',
                  displayName: 'Boom Plan',
                  settingsNs: 'llm-kimi',
                  settingsPath: [],
                  active: true,
                },
                {
                  provider: 'stringy',
                  displayName: 'String Plan',
                  settingsNs: 'llm-kimi',
                  settingsPath: [],
                  active: true,
                },
              ],
            },
          },
        })),
        accountUsage: vi.fn(async (request: { provider: string }) => {
          if (request.provider === 'boom') throw new Error('network')
          if (request.provider === 'stringy') throw 'nope'
          return {
            result: { ok: false as const, error: { message: 'quota refused' } },
          }
        }),
      },
      usage: {
        panel: vi.fn(async () => ({ result: { ok: true as const, value: emptyPanel() } })),
      },
    }
    render(<UsagesSection api={api as unknown as UsagesSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByText('Broken Plan')).toBeTruthy()
    })
    expect(screen.getByText('Boom Plan')).toBeTruthy()
    expect(screen.getByText('quota refused')).toBeTruthy()
    expect(screen.getByText('network')).toBeTruthy()
    expect(screen.getByText('nope')).toBeTruthy()
  })

  it('shows request-only days on the bar row', async () => {
    const today = (() => {
      const date = new Date()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${String(date.getFullYear())}-${month}-${day}`
    })()
    mount({
      panel: {
        days: [{
          date: today,
          requests: 2,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }],
        models: [],
        totals: {
          requests: 2,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
      },
      providers: [],
      usages: {},
    })
    await waitFor(() => {
      expect(screen.getByLabelText(en['usages.byDay'])).toBeTruthy()
    })
  })

  it('surfaces a non-Error panel failure', async () => {
    const api = {
      llm: {
        providers: vi.fn(async () => ({
          result: { ok: true as const, value: { providers: [] } },
        })),
        accountUsage: vi.fn(),
      },
      usage: {
        panel: vi.fn(async () => {
          throw 'ledger down'
        }),
      },
    }
    render(<UsagesSection api={api as unknown as UsagesSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('ledger down')
    })
  })

  it('does not apply a load that settles after unmount', async () => {
    let settleSuccess!: () => void
    const successGate = new Promise<void>(resolve => { settleSuccess = resolve })
    const successApi = {
      llm: {
        providers: vi.fn(async () => {
          await successGate
          return { result: { ok: true as const, value: { providers: [] } } }
        }),
        accountUsage: vi.fn(),
      },
      usage: {
        panel: vi.fn(async () => {
          await successGate
          return { result: { ok: true as const, value: emptyPanel() } }
        }),
      },
    }
    const first = render(
      <UsagesSection api={successApi as unknown as UsagesSectionInjected['api']} t={interpolate as never} />,
    )
    first.unmount()
    settleSuccess()
    await successGate

    let settleFailure!: () => void
    const failureGate = new Promise<void>(resolve => { settleFailure = resolve })
    const failureApi = {
      llm: {
        providers: vi.fn(async () => {
          await failureGate
          throw 'ignored'
        }),
        accountUsage: vi.fn(),
      },
      usage: {
        panel: vi.fn(async () => {
          await failureGate
          throw 'ignored'
        }),
      },
    }
    const second = render(
      <UsagesSection api={failureApi as unknown as UsagesSectionInjected['api']} t={interpolate as never} />,
    )
    second.unmount()
    settleFailure()
    await failureGate
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
