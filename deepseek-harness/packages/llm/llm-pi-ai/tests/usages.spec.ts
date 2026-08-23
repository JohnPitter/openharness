import { describe, expect, it } from 'vitest'
import {
  chatgptAccountId,
  parseClaudeCodeUsage,
  parseCodexUsage,
  parseZaiUsage,
  percentFromUtilization,
  zaiQuotaUrl,
} from '../src/usages.ts'

function jwtWithAccount(id: string): string {
  const payload = Buffer.from(JSON.stringify({ chatgpt_account_id: id })).toString('base64url')
  return `header.${payload}.sig`
}

describe('percentFromUtilization', () => {
  it('treats 0–1 as a fraction and values above 1 as already percent', () => {
    expect(percentFromUtilization(0.42)).toBe(42)
    expect(percentFromUtilization(1)).toBe(100)
    expect(percentFromUtilization(35)).toBe(35)
  })
})

describe('parseClaudeCodeUsage', () => {
  it('maps five_hour and seven_day utilization onto rate/weekly windows', () => {
    expect(parseClaudeCodeUsage({
      five_hour: { utilization: 6, resets_at: '2026-04-08T18:59:59Z' },
      seven_day: { utilization: 35, resets_at: '2026-04-14T16:59:59Z' },
      seven_day_opus: { utilization: 12, resets_at: '2026-04-14T17:59:59Z' },
    })).toEqual({
      windows: [
        {
          id: 'weekly',
          used: 35,
          limit: 100,
          percent: 35,
          resetsAt: Math.floor(Date.parse('2026-04-14T16:59:59Z') / 1000),
        },
        {
          id: 'rate',
          used: 6,
          limit: 100,
          percent: 6,
          resetsAt: Math.floor(Date.parse('2026-04-08T18:59:59Z') / 1000),
          windowMinutes: 300,
        },
      ],
    })
  })

  it('accepts fractional utilization and skips null buckets', () => {
    expect(parseClaudeCodeUsage({
      five_hour: { utilization: 0.42, resets_at: '2026-02-28T17:00:00Z' },
      seven_day: null,
    }).windows).toEqual([{
      id: 'rate',
      used: 42,
      limit: 100,
      percent: 42,
      resetsAt: Math.floor(Date.parse('2026-02-28T17:00:00Z') / 1000),
      windowMinutes: 300,
    }])
  })

  it('rejects a body with no usable buckets', () => {
    expect(() => parseClaudeCodeUsage({ extra_usage: { is_enabled: false } }))
      .toThrow('Invalid Claude Code usage response')
  })
})

describe('parseCodexUsage', () => {
  it('maps primary/secondary windows and the plan name', () => {
    expect(parseCodexUsage({
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 18_000,
          reset_at: 1_777_534_802,
        },
        secondary_window: {
          used_percent: 9,
          limit_window_seconds: 604_800,
          reset_at: 1_777_969_707,
        },
      },
    })).toEqual({
      plan: 'Plus',
      windows: [
        { id: 'rate', used: 25, limit: 100, percent: 25, resetsAt: 1_777_534_802, windowMinutes: 300 },
        { id: 'weekly', used: 9, limit: 100, percent: 9, resetsAt: 1_777_969_707, windowMinutes: 10_080 },
      ],
    })
  })

  it('classifies a lone weekly primary window as weekly', () => {
    const usage = parseCodexUsage({
      rate_limit: {
        primary_window: { used_percent: 100, limit_window_seconds: 604_800, reset_at: 1_786_161_204 },
        secondary_window: null,
      },
    })
    expect(usage.windows).toEqual([
      { id: 'weekly', used: 100, limit: 100, percent: 100, resetsAt: 1_786_161_204, windowMinutes: 10_080 },
    ])
  })

  it('rejects a body without rate-limit windows', () => {
    expect(() => parseCodexUsage({ plan_type: 'plus' })).toThrow('Invalid Codex usage response')
  })
})

describe('chatgptAccountId', () => {
  it('reads the claim from a JWT payload', () => {
    expect(chatgptAccountId(jwtWithAccount('acct_123'))).toBe('acct_123')
    expect(chatgptAccountId('not-a-jwt')).toBeUndefined()
  })
})

describe('parseZaiUsage', () => {
  it('maps TOKENS_LIMIT rows onto 5-hour and weekly windows', () => {
    expect(parseZaiUsage({
      data: {
        planName: 'Pro',
        limits: [
          { type: 'TOKENS_LIMIT', unit: 3, percentage: 12, nextResetTime: 1_710_000_000_000 },
          { type: 'TOKENS_LIMIT', unit: 6, percentage: 40, nextResetTime: 1_710_500_000_000 },
          { type: 'TIME_LIMIT', unit: 3, percentage: 8 },
        ],
      },
    })).toEqual({
      plan: 'Pro',
      windows: [
        { id: 'rate', used: 12, limit: 100, percent: 12, resetsAt: 1_710_000_000, windowMinutes: 300 },
        { id: 'weekly', used: 40, limit: 100, percent: 40, resetsAt: 1_710_500_000, windowMinutes: 10_080 },
        { id: 'requests', used: 8, limit: 100, percent: 8, windowMinutes: 300 },
      ],
    })
  })

  it('prefers used/limit counts when the row carries them', () => {
    expect(parseZaiUsage({
      limits: [{ type: 'TOKENS_LIMIT', unit: 6, used: 2_000, limit: 10_000 }],
    }).windows).toEqual([
      { id: 'weekly', used: 2_000, limit: 10_000, percent: 20, windowMinutes: 10_080 },
    ])
  })

  it('maps CREDIT_LIMIT rows (Lite credits) via currentValue/usage and level', () => {
    expect(parseZaiUsage({
      code: 200,
      success: true,
      data: {
        limits: [
          {
            type: 'CREDIT_LIMIT',
            unit: 3,
            number: 5,
            usage: 2_000,
            currentValue: 12,
            remaining: 1_988,
            percentage: 1,
            nextResetTime: 1_787_367_041_072,
          },
          {
            type: 'CREDIT_LIMIT',
            unit: 6,
            number: 1,
            usage: 10_000,
            currentValue: 4_610,
            remaining: 5_390,
            percentage: 46,
            nextResetTime: 1_787_528_017_998,
          },
        ],
        level: 'lite',
      },
    })).toEqual({
      plan: 'Lite',
      windows: [
        {
          id: 'rate',
          used: 12,
          limit: 2_000,
          percent: 1,
          resetsAt: 1_787_367_041,
          windowMinutes: 300,
        },
        {
          id: 'weekly',
          used: 4_610,
          limit: 10_000,
          percent: 46,
          resetsAt: 1_787_528_017,
          windowMinutes: 10_080,
        },
      ],
    })
  })

  it('maps TIME_LIMIT rows onto request-count windows', () => {
    // Captured GLM monitor payload: TIME_LIMIT is the request-window type.
    expect(parseZaiUsage({
      data: { limits: [{ type: 'TIME_LIMIT', unit: 3, percentage: 8 }] },
    })).toEqual({
      windows: [{ id: 'requests', used: 8, limit: 100, percent: 8, windowMinutes: 300 }],
    })
    expect(parseZaiUsage({
      data: { limits: [{ type: 'TIME_LIMIT', unit: 6, used: 40, limit: 2_000 }] },
    }).windows).toEqual([
      { id: 'requests-weekly', used: 40, limit: 2_000, percent: 2, windowMinutes: 10_080 },
    ])
    expect(parseZaiUsage({
      data: { limits: [{ type: 'REQUESTS_LIMIT', unit: 3, percentage: 10 }] },
    }).windows[0]?.id).toBe('requests')
    expect(parseZaiUsage({
      data: { limits: [{ type: 'REQUEST_LIMIT', unit: 6, used: 1, limit: 100 }] },
    }).windows[0]?.id).toBe('requests-weekly')
    expect(parseZaiUsage({
      data: { limits: [{ type: 'RPM_LIMIT', duration: 1, timeUnit: 'TIME_UNIT_MINUTE', percentage: 5 }] },
    }).windows[0]).toMatchObject({ id: 'requests', windowMinutes: 1 })
  })

  it('rejects a body without token or request limits', () => {
    expect(() => parseZaiUsage({ data: { limits: [{ type: 'UNKNOWN_LIMIT', percentage: 1 }] } }))
      .toThrow('Invalid GLM usage response')
  })
})

describe('zaiQuotaUrl', () => {
  it('derives the monitor host from the coding-plan base URL', () => {
    expect(zaiQuotaUrl('https://api.z.ai/api/coding/paas/v4'))
      .toBe('https://api.z.ai/api/monitor/usage/quota/limit')
    expect(zaiQuotaUrl('https://open.bigmodel.cn/api/coding/paas/v4'))
      .toBe('https://open.bigmodel.cn/api/monitor/usage/quota/limit')
    expect(zaiQuotaUrl()).toBe('https://api.z.ai/api/monitor/usage/quota/limit')
  })
})
