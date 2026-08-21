/** Pure display helpers for the sidebar usage chip. */
import { describe, expect, it } from 'vitest'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import {
  billedInputTokens, cacheHitPercent, contextOccupancy, currentModelContextWindow, formatTokens, routeLabelOf, sessionTokens,
} from '../src/client/usage-format.ts'

const usage = {
  uncachedInputTokens: 80,
  outputTokens: 20,
  cacheReadTokens: 20,
  cacheWriteTokens: 0,
}

describe('formatTokens', () => {
  it('scales at the thousand and million boundaries', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(1_220)).toBe('1.2K')
    expect(formatTokens(12_200)).toBe('12.2K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_200_000)).toBe('1.2M')
  })
})

describe('usage accounting', () => {
  it('sums disjoint prompt buckets and reports cache-hit share', () => {
    expect(billedInputTokens(usage)).toBe(100)
    expect(cacheHitPercent(usage)).toBe(20)
    expect(sessionTokens(usage)).toBe(120)
    expect(cacheHitPercent({ ...usage, uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }))
      .toBeNull()
    expect(sessionTokens(undefined)).toBe(0)
  })
})

describe('contextOccupancy', () => {
  it('prefers projectedTokens and clamps at 100', () => {
    expect(contextOccupancy(undefined)).toBeNull()
    expect(contextOccupancy({ projectedTokens: 40, contextWindow: 100 }))
      .toEqual({ percent: 40, usedTokens: 40, contextWindow: 100 })
    expect(contextOccupancy({ pressureTokens: 10, contextWindow: 100 }))
      .toEqual({ percent: 10, usedTokens: 10, contextWindow: 100 })
    expect(contextOccupancy({ projectedTokens: 250, contextWindow: 100 }))
      .toEqual({ percent: 100, usedTokens: 250, contextWindow: 100 })
  })
})

describe('routeLabelOf', () => {
  it('prefers catalog names and falls back to ids', () => {
    const directory: ModelDirectoryState = {
      current: { provider: 'kimi-for-coding', model: 'k3-256k' },
      routable: true,
      groups: [{
        id: 'kimi-for-coding',
        name: 'Kimi for Code',
        models: [{ id: 'k3-256k', name: 'K3-256k' }],
      }],
      failures: [],
      status: 'ready',
      error: null,
    }
    expect(routeLabelOf(directory)).toEqual({ provider: 'Kimi for Code', model: 'K3-256k' })
    expect(currentModelContextWindow(directory)).toBeUndefined()
    expect(routeLabelOf({ ...directory, current: null })).toBeUndefined()
    expect(routeLabelOf({ ...directory, groups: [] }))
      .toEqual({ provider: 'kimi-for-coding', model: 'k3-256k' })
    expect(currentModelContextWindow({
      ...directory,
      groups: [{
        id: 'kimi-for-coding',
        name: 'Kimi for Code',
        models: [{ id: 'k3-256k', name: 'K3-256k', contextWindow: 262_144 }],
      }],
    })).toBe(262_144)
  })
})
