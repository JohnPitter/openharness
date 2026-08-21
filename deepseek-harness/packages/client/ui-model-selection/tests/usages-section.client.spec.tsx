// @vitest-environment jsdom
/** Settings Usages section: lists every provider that reports account quotas. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountUsageView, ConfigurableProviderView } from '@deepseek-ai/dsh-api-remotes/client'
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
  }
  render(<UsagesSection api={api as unknown as UsagesSectionInjected['api']} t={interpolate as never} />)
  return { api }
}

describe('UsagesSection', () => {
  it('shows only providers that report quotas', async () => {
    mount()
    await waitFor(() => {
      expect(screen.getByText('Kimi for Code')).toBeTruthy()
    })
    expect(screen.getByText('Claude Code')).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
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
  })
})
