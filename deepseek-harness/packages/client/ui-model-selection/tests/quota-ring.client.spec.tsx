// @vitest-environment jsdom
/** Composer account-quota ring: lead-window readout beside the send button. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountUsageView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import type { QuotaRingProps } from '../src/client/QuotaRing.tsx'
import { QuotaRing } from '../src/client/QuotaRing.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

function directory(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'kimi-for-coding', model: 'k3-256k' },
    routable: true,
    currentMetering: 'requests',
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

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

function mount(options: {
  quota?: AccountUsageView
  directory?: ModelDirectoryState
  loadAccountUsage?: (provider: string) => Promise<AccountUsageView>
} = {}) {
  const openQuotas = vi.fn()
  const loadAccountUsage = vi.fn(options.loadAccountUsage ?? (() => Promise.resolve(options.quota ?? { supported: false })))
  const dir = options.directory ?? directory()
  const props = {
    directory: { getSnapshot: () => dir, subscribe: () => () => {} },
    loadAccountUsage,
    openQuotas,
    t: interpolate as QuotaRingProps['t'],
  } as unknown as QuotaRingProps
  const view = render(<QuotaRing {...props} />)
  return { view, openQuotas, loadAccountUsage }
}

describe('QuotaRing', () => {
  it('shows the 5-hour lead window with its percent and opens Limits on click', async () => {
    const { openQuotas, loadAccountUsage } = mount({
      quota: {
        supported: true,
        windows: [
          { id: 'weekly', used: 214, limit: 2048, percent: 10 },
          { id: 'rate', used: 70, limit: 200, percent: 35, windowMinutes: 300 },
        ],
      },
    })
    const tip = en['usage.quotaRingTip']
      .replace('{label}', en['usage.quotaRate'].replace('{hours}', '5'))
      .replace('{percent}', '35')
    const trigger = await screen.findByRole('button', { name: tip })
    expect(trigger.textContent).toContain('35%')
    expect(loadAccountUsage).toHaveBeenCalledWith('kimi-for-coding')
    fireEvent.click(trigger)
    expect(openQuotas).toHaveBeenCalledOnce()
  })

  it('leads with the weekly window when no short window is disclosed', async () => {
    mount({
      quota: {
        supported: true,
        windows: [{ id: 'weekly', used: 214, limit: 2048, percent: 10 }],
      },
    })
    const tip = en['usage.quotaRingTip']
      .replace('{label}', en['usage.quotaWeekly'])
      .replace('{percent}', '10')
    expect(await screen.findByRole('button', { name: tip })).toBeTruthy()
  })

  it('names the reset in the tooltip when the window discloses one', async () => {
    mount({
      quota: {
        supported: true,
        windows: [
          { id: 'rate', used: 70, limit: 200, percent: 35, windowMinutes: 300, resetsAt: Math.floor(Date.now() / 1000) + 10_800 },
        ],
      },
    })
    const trigger = await screen.findByRole('button')
    expect(trigger.getAttribute('aria-label')).toContain(en['usage.quotaReset'].replace('{when}', '3h'))
  })

  it('renders nothing while the provider exposes no quota surface', () => {
    mount({ quota: { supported: false } })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing when the probe failed', () => {
    mount({ quota: { supported: true, error: 'usage error (HTTP 401)' } })
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing without a staged provider', () => {
    mount({ directory: directory({ current: null, groups: [] }) })
    expect(screen.queryByRole('button')).toBeNull()
  })
})
