// @vitest-environment jsdom
/** Settings Status section: local usage panel only. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { UsagePanelView } from '@deepseek-ai/dsh-api-remotes/client'
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

function hanging(): Promise<never> {
  return new Promise(() => {})
}

function mount(options: {
  panel?: UsagePanelView
  panelError?: string
} = {}) {
  const panel = options.panel ?? emptyPanel()
  const api = {
    llm: {
      providers: vi.fn(hanging),
      accountUsage: vi.fn(hanging),
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
    const { api } = mount()
    await waitFor(() => {
      expect(screen.getAllByText(en['usages.emptyHistory']).length).toBeGreaterThan(0)
    })
    expect(screen.getByText(en['usages.today'])).toBeTruthy()
    expect(screen.queryByText(en['usages.empty'])).toBeNull()
    expect(api.llm.providers).not.toHaveBeenCalled()
    expect(api.llm.accountUsage).not.toHaveBeenCalled()
  })

  it('paints history while provider quota HTTP never settles', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText(en['usages.today'])).toBeTruthy()
    })
    expect(screen.getByText(en['usages.title'])).toBeTruthy()
  })

  it('lists daily history and ranked models', async () => {
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
    })
    await waitFor(() => {
      expect(screen.getAllByText('kimi-for-coding').length).toBeGreaterThan(0)
    })
    expect(screen.getByText(en['usages.models'])).toBeTruthy()
    expect(screen.queryByText('Kimi for Code')).toBeNull()
  })

  it('refreshes the panel when asked', async () => {
    const { api } = mount()
    await waitFor(() => {
      expect(screen.getByText(en['usages.today'])).toBeTruthy()
    })
    expect(api.usage.panel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: en['usages.refresh'] }))
    await waitFor(() => {
      expect(api.usage.panel).toHaveBeenCalledTimes(2)
    })
    expect(api.llm.providers).not.toHaveBeenCalled()
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

  it('renders nothing without a translate seat', () => {
    const { container } = render(<UsagesSection api={{ usage: { panel: vi.fn() } } as never} />)
    expect(container.textContent).toBe('')
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
    })
    await waitFor(() => {
      expect(screen.getByLabelText(en['usages.byDay'])).toBeTruthy()
    })
  })

  it('surfaces a non-Error panel failure', async () => {
    const api = {
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
