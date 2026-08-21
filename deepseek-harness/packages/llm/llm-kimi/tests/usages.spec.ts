import { describe, expect, it } from 'vitest'
import { kimiPlanLabel, parseKimiCodeUsages } from '../src/usages.ts'

const CODE_API_BODY = {
  usage: {
    limit: '2048',
    used: '214',
    remaining: '1834',
    resetTime: '2026-01-09T15:23:13.716839300Z',
  },
  limits: [{
    window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
    detail: {
      limit: '200',
      used: '139',
      remaining: '61',
      resetTime: '2026-01-06T13:33:02.717479433Z',
    },
  }],
}

describe('parseKimiCodeUsages', () => {
  it('reads string counts, weekly plan, and the 5-hour rate window', () => {
    const usage = parseKimiCodeUsages(CODE_API_BODY)
    expect(usage.plan).toBe('Moderato')
    expect(usage.windows).toEqual([
      {
        id: 'weekly',
        used: 214,
        limit: 2048,
        percent: 10,
        resetsAt: Math.floor(Date.parse('2026-01-09T15:23:13.716839300Z') / 1000),
      },
      {
        id: 'rate',
        used: 139,
        limit: 200,
        percent: 70,
        resetsAt: Math.floor(Date.parse('2026-01-06T13:33:02.717479433Z') / 1000),
        windowMinutes: 300,
      },
    ])
  })

  it('derives used from remaining when used is absent', () => {
    const usage = parseKimiCodeUsages({
      usage: { limit: 1024, remaining: 768 },
    })
    expect(usage.plan).toBe('Andante')
    expect(usage.windows).toEqual([{ id: 'weekly', used: 256, limit: 1024, percent: 25 }])
  })

  it('rejects a body without a weekly usage object', () => {
    expect(() => parseKimiCodeUsages({ limits: [] })).toThrow('Invalid Kimi usage response')
  })
})

describe('kimiPlanLabel', () => {
  it('names the published weekly allotments', () => {
    expect(kimiPlanLabel(1024)).toBe('Andante')
    expect(kimiPlanLabel(2048)).toBe('Moderato')
    expect(kimiPlanLabel(7168)).toBe('Allegretto')
    expect(kimiPlanLabel(99)).toBeUndefined()
  })
})
