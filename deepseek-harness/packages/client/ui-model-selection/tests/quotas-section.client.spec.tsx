// @vitest-environment jsdom
/** Settings Limits section: provider account quotas only. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountUsageView, ConfigurableProviderView } from '@deepseek-ai/dsh-api-remotes/client'
import { QuotasSection } from '../src/client/QuotasSection.tsx'
import type { QuotasSectionInjected } from '../src/client/QuotasSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

function hanging(): Promise<never> {
  return new Promise(() => {})
}

function mount(options: {
  providers?: ConfigurableProviderView[]
  usages?: Record<string, AccountUsageView>
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
      panel: vi.fn(hanging),
    },
  }
  render(<QuotasSection api={api as unknown as QuotasSectionInjected['api']} t={interpolate as never} />)
  return { api }
}

describe('QuotasSection', () => {
  it('shows the empty copy when no provider reports a quota', async () => {
    const { api } = mount({ usages: { 'deepseek-official': { supported: false } }, providers: [] })
    await waitFor(() => {
      expect(screen.getByText(en['usages.empty'])).toBeTruthy()
    })
    expect(screen.getByText(en['quotas.title'])).toBeTruthy()
    expect(screen.queryByText(en['usages.today'])).toBeNull()
    expect(api.usage.panel).not.toHaveBeenCalled()
  })

  it('paints quota cards while usage.panel never settles', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('Kimi for Code')).toBeTruthy()
    })
    expect(screen.queryByText(en['usages.today'])).toBeNull()
  })

  it('lists quota cards and omits pay-per-token or empty windows', async () => {
    mount({
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
      expect(screen.getByText('Kimi for Code')).toBeTruthy()
    })
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.getByText('Plan Only')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.queryByText('Empty Windows')).toBeNull()
    expect(screen.getByText('Moderato')).toBeTruthy()
    expect(screen.getByText(en['usage.quotaPercent'].replace('{percent}', '35'))).toBeTruthy()
  })

  it('refreshes quotas when asked', async () => {
    const { api } = mount()
    await waitFor(() => {
      expect(screen.getByText('Kimi for Code')).toBeTruthy()
    })
    expect(api.llm.providers).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en['usages.refresh'] }))
    await waitFor(() => {
      expect(api.llm.providers).toHaveBeenCalledTimes(2)
    })
    expect(api.usage.panel).not.toHaveBeenCalled()
  })

  it('renders nothing without an injected api', () => {
    const { container } = render(<QuotasSection t={interpolate as never} />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing without a translate seat', () => {
    const { container } = render(<QuotasSection api={{ llm: { providers: vi.fn(), accountUsage: vi.fn() } } as never} />)
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
    }
    render(<QuotasSection api={api as unknown as QuotasSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('no catalog')
    })
  })

  it('surfaces a non-Error provider-list throw', async () => {
    const api = {
      llm: {
        providers: vi.fn(async () => {
          throw 'catalog down'
        }),
        accountUsage: vi.fn(),
      },
    }
    render(<QuotasSection api={api as unknown as QuotasSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('catalog down')
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
    }
    render(<QuotasSection api={api as unknown as QuotasSectionInjected['api']} t={interpolate as never} />)
    await waitFor(() => {
      expect(screen.getByText('Broken Plan')).toBeTruthy()
    })
    expect(screen.getByText('Boom Plan')).toBeTruthy()
    expect(screen.getByText('quota refused')).toBeTruthy()
    expect(screen.getByText('network')).toBeTruthy()
    expect(screen.getByText('nope')).toBeTruthy()
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
    }
    const first = render(
      <QuotasSection api={successApi as unknown as QuotasSectionInjected['api']} t={interpolate as never} />,
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
    }
    const second = render(
      <QuotasSection api={failureApi as unknown as QuotasSectionInjected['api']} t={interpolate as never} />,
    )
    second.unmount()
    settleFailure()
    await failureGate
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
