// @vitest-environment jsdom
/** Shared live-quota probe: timeout, abort, and chip/ring single-flight cache. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { AccountUsageView } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import type { QuotaRingProps } from '../src/client/QuotaRing.tsx'
import { QuotaRing } from '../src/client/QuotaRing.tsx'
import { en } from '../src/client/locales.ts'
import {
  ACCOUNT_USAGE_CACHE_TTL_MS,
  ACCOUNT_USAGE_PROBE_TIMEOUT_MS,
  awaitWithAbort,
  createUsageProbeSignal,
  isAbortFailure,
  leadQuotaWindow,
  loadAccountUsageCached,
  pickLeadWindow,
  quotaProbeErrorText,
} from '../src/client/usage-quota-live.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const view: AccountUsageView = {
  supported: true,
  windows: [{ id: 'rate', used: 70, limit: 200, percent: 35, windowMinutes: 300 }],
}

function directory(): ModelDirectoryState {
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
  }
}

function interpolate(key: keyof typeof en, vars?: Record<string, string>): string {
  let text = en[key]
  if (vars === undefined) return text
  for (const [name, value] of Object.entries(vars)) text = text.replaceAll(`{${name}}`, value)
  return text
}

describe('isAbortFailure', () => {
  it('accepts AbortError and TimeoutError and rejects other values', () => {
    expect(isAbortFailure(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortFailure(new DOMException('timed out', 'TimeoutError'))).toBe(true)
    expect(isAbortFailure({ name: 'AbortError' })).toBe(true)
    expect(isAbortFailure(new Error('network'))).toBe(false)
    expect(isAbortFailure('nope')).toBe(false)
    expect(isAbortFailure(null)).toBe(false)
  })
})

describe('quotaProbeErrorText', () => {
  it('uses the timeout copy for abort/timeout and the thrown text otherwise', () => {
    expect(quotaProbeErrorText(new DOMException('aborted', 'TimeoutError'), 'timed out'))
      .toBe('timed out')
    expect(quotaProbeErrorText(new Error('network'), 'timed out')).toBe('network')
    expect(quotaProbeErrorText('nope', 'timed out')).toBe('nope')
  })
})

describe('awaitWithAbort', () => {
  it('rejects an already-aborted signal, including a non-Error reason', async () => {
    const ac = new AbortController()
    ac.abort('stop')
    await expect(awaitWithAbort(new Promise(() => {}), ac.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('rejects when the signal aborts while the probe is outstanding', async () => {
    const ac = new AbortController()
    const pending = awaitWithAbort(new Promise(() => {}), ac.signal)
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('resolves and rejects with the underlying promise when the signal stays open', async () => {
    const ac = new AbortController()
    await expect(awaitWithAbort(Promise.resolve('ok'), ac.signal)).resolves.toBe('ok')
    await expect(awaitWithAbort(Promise.reject(new Error('boom')), ac.signal))
      .rejects.toMatchObject({ message: 'boom' })
  })
})

describe('createUsageProbeSignal', () => {
  it('aborts immediately when the external signal is already aborted', () => {
    const ac = new AbortController()
    ac.abort()
    const probe = createUsageProbeSignal(ac.signal)
    expect(probe.signal.aborted).toBe(true)
    probe.dispose()
  })

  it('forwards a later external abort and disposes the timer', () => {
    const ac = new AbortController()
    const probe = createUsageProbeSignal(ac.signal)
    ac.abort()
    expect(probe.signal.aborted).toBe(true)
    probe.dispose()
  })

  it('times out when no external signal is given', async () => {
    vi.useFakeTimers()
    const probe = createUsageProbeSignal()
    const pending = expect(awaitWithAbort(new Promise(() => {}), probe.signal))
      .rejects.toSatisfy((error: unknown) => isAbortFailure(error))
    await vi.advanceTimersByTimeAsync(ACCOUNT_USAGE_PROBE_TIMEOUT_MS)
    await pending
    probe.dispose()
  })
})

describe('loadAccountUsageCached', () => {
  it('reuses a successful probe for the cache TTL and refetches after it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const load = vi.fn(() => Promise.resolve(view))
    const ac = new AbortController()
    await expect(loadAccountUsageCached('kimi-for-coding', load, ac.signal)).resolves.toEqual(view)
    await expect(loadAccountUsageCached('kimi-for-coding', load, ac.signal)).resolves.toEqual(view)
    expect(load).toHaveBeenCalledTimes(1)
    vi.setSystemTime(ACCOUNT_USAGE_CACHE_TTL_MS)
    await expect(loadAccountUsageCached('kimi-for-coding', load, ac.signal)).resolves.toEqual(view)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('joins an in-flight probe and does not cache a rejection', async () => {
    let settle!: (value: AccountUsageView) => void
    const first = new Promise<AccountUsageView>(resolve => { settle = resolve })
    const load = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(view)
    const ac = new AbortController()
    const joined = [
      loadAccountUsageCached('kimi-for-coding', load, ac.signal),
      loadAccountUsageCached('kimi-for-coding', load, ac.signal),
    ]
    expect(load).toHaveBeenCalledTimes(1)
    settle(view)
    await expect(Promise.all(joined)).resolves.toEqual([view, view])

    const boom = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(view)
    await expect(loadAccountUsageCached('claude-code', boom, ac.signal)).rejects.toMatchObject({ message: 'boom' })
    await expect(loadAccountUsageCached('claude-code', boom, ac.signal)).resolves.toEqual(view)
    expect(boom).toHaveBeenCalledTimes(2)
  })

  it('lets one caller abort without cancelling a shared in-flight probe', async () => {
    let settle!: (value: AccountUsageView) => void
    const first = new Promise<AccountUsageView>(resolve => { settle = resolve })
    const load = vi.fn(() => first)
    const left = new AbortController()
    const right = new AbortController()
    const p1 = loadAccountUsageCached('kimi-for-coding', load, left.signal)
    const p2 = loadAccountUsageCached('kimi-for-coding', load, right.signal)
    left.abort()
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' })
    settle(view)
    await expect(p2).resolves.toEqual(view)
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('pickLeadWindow', () => {
  it('returns undefined when no windows are present', () => {
    expect(pickLeadWindow({ supported: true })).toBeUndefined()
    expect(leadQuotaWindow({ supported: true, error: 'nope' })).toBeUndefined()
  })
})

describe('QuotaRing cache', () => {
  it('single-flights two rings that share a loader', async () => {
    const load = vi.fn(() => Promise.resolve(view))
    const dir = directory()
    const props = {
      directory: { getSnapshot: () => dir, subscribe: () => () => {} },
      loadAccountUsage: load,
      t: interpolate as QuotaRingProps['t'],
    } as unknown as QuotaRingProps
    render(
      <div>
        <QuotaRing {...props} />
        <QuotaRing {...props} />
      </div>,
    )
    const tip = en['usage.quotaRingTip']
      .replace('{label}', en['usage.quotaRate'].replace('{hours}', '5'))
      .replace('{percent}', '35')
    expect((await screen.findAllByRole('img', { name: tip }))).toHaveLength(2)
    expect(load).toHaveBeenCalledTimes(1)
  })
})
