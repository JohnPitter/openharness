/**
 * Display helpers for the sidebar usage chip. Token formatting mirrors the
 * composer StatsLine compact scale so the two surfaces read as one meter.
 */

import type { ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
import type { ModelDirectoryState } from './directory.ts'

/** Compact token count: 517 / 12.2K / 517K / 1.2M. */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Sum the three disjoint prompt-side billing buckets. */
export function billedInputTokens(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Cache-hit share of prompt-side input; null when nothing was billed. */
export function cacheHitPercent(usage: TokenUsageProjection): number | null {
  const denominator = billedInputTokens(usage)
  return denominator === 0 ? null : Math.round(usage.cacheReadTokens / denominator * 100)
}

export interface ContextOccupancy {
  percent: number
  usedTokens: number
  contextWindow: number
}

/** Occupancy percent from projected pressure over advertised capacity. */
export function contextOccupancy(
  pressure: ContextPressureProjection | undefined,
): ContextOccupancy | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round(usedTokens / pressure.contextWindow * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

export interface UsageRouteLabel {
  provider: string
  model: string
}

/** Provider/model labels from the advisory directory, falling back to ids. */
export function routeLabelOf(directory: ModelDirectoryState): UsageRouteLabel | undefined {
  const current = directory.current
  if (current === null) return undefined
  const group = directory.groups.find(entry => entry.id === current.provider)
  const model = group?.models.find(entry => entry.id === current.model)
  return {
    provider: group?.name ?? current.provider,
    model: model?.name ?? current.model,
  }
}

/** Advertised context capacity of the staged model, when the catalog disclosed it. */
export function currentModelContextWindow(directory: ModelDirectoryState): number | undefined {
  const current = directory.current
  if (current === null) return undefined
  const group = directory.groups.find(entry => entry.id === current.provider)
  return group?.models.find(entry => entry.id === current.model)?.contextWindow
}

/** Session billed total: prompt-side buckets plus output. */
export function sessionTokens(usage: TokenUsageProjection | undefined): number {
  if (usage === undefined) return 0
  return billedInputTokens(usage) + usage.outputTokens
}

/** Compact integer quota count (request allotments, not tokens). */
export function formatQuotaCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0'
  return n >= 10_000 ? formatTokens(n) : String(Math.round(n))
}

/**
 * Relative remaining time until a unix-seconds reset, or undefined when
 * the timestamp is missing or already past.
 */
export function formatResetWhen(resetsAt: number | undefined, now = Date.now()): string | undefined {
  if (resetsAt === undefined || resetsAt <= 0) return undefined
  const ms = resetsAt * 1000 - now
  if (ms <= 0) return undefined
  const hours = Math.max(1, Math.round(ms / 3_600_000))
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}
