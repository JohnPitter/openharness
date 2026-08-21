/**
 * Parse the Kimi for Code `GET {baseURL}/usages` body. The code-API envelope
 * is `{ usage, limits }`; `limit`/`used` arrive as string or number.
 *
 * @module dsh-llm-kimi/usages
 */

import type { LlmAccountUsage, LlmAccountUsageWindow } from '@deepseek-ai/dsh-llm'

interface UsageDetail {
  used: number
  limit: number
  percent: number
  resetsAt?: number
}

function asMap(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function jsonNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function resetAt(raw: Record<string, unknown>): number | undefined {
  for (const key of ['resetTime', 'resetAt', 'reset_time', 'reset_at'] as const) {
    const value = raw[key]
    if (typeof value !== 'string' || value.trim().length === 0) continue
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return Math.floor(ms / 1000)
  }
  return undefined
}

function occupancyPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(used / limit * 100)))
}

function detailFrom(raw: Record<string, unknown> | undefined): UsageDetail | undefined {
  if (raw === undefined) return undefined
  const limit = jsonNumber(raw.limit)
  if (limit === undefined || limit <= 0) return undefined
  const usedValue = jsonNumber(raw.used)
  const remaining = jsonNumber(raw.remaining)
  const used = usedValue !== undefined && usedValue >= 0
    ? usedValue
    : remaining !== undefined && remaining >= 0 && remaining <= limit
      ? limit - remaining
      : 0
  const resets = resetAt(raw)
  return {
    used,
    limit,
    percent: occupancyPercent(used, limit),
    ...resets === undefined ? {} : { resetsAt: resets },
  }
}

function windowMinutesOf(raw: unknown): number | undefined {
  const items = Array.isArray(raw) ? raw : []
  const window = asMap(asMap(items[0])?.window)
  if (window === undefined) return undefined
  const duration = jsonNumber(window.duration)
  if (duration === undefined || duration <= 0) return undefined
  const unit = window.timeUnit
  if (unit === 'TIME_UNIT_MINUTE') return duration
  if (unit === 'TIME_UNIT_HOUR') return duration * 60
  if (unit === 'TIME_UNIT_DAY') return duration * 24 * 60
  return undefined
}

function firstRateLimit(raw: unknown): UsageDetail | undefined {
  const items = Array.isArray(raw) ? raw : []
  return detailFrom(asMap(asMap(items[0])?.detail))
}

function windowOf(
  id: string,
  detail: UsageDetail,
  windowMinutes?: number,
): LlmAccountUsageWindow {
  return {
    id,
    used: detail.used,
    limit: detail.limit,
    percent: detail.percent,
    ...detail.resetsAt === undefined ? {} : { resetsAt: detail.resetsAt },
    ...windowMinutes === undefined ? {} : { windowMinutes },
  }
}

/** Plan names Kimi publishes for the weekly request allotment. */
export function kimiPlanLabel(limit: number): string | undefined {
  switch (Math.round(limit)) {
    case 1024: return 'Andante'
    case 2048: return 'Moderato'
    case 7168: return 'Allegretto'
    default: return undefined
  }
}

/**
 * Parse a Kimi for Code `/usages` JSON body into account quota windows.
 * @param body - parsed response body.
 * @returns weekly (and optional rate-limit) windows.
 */
export function parseKimiCodeUsages(body: unknown): LlmAccountUsage {
  const root = asMap(body)
  const weekly = detailFrom(asMap(root?.usage))
  if (weekly === undefined) throw new Error('Invalid Kimi usage response')
  const rate = firstRateLimit(root?.limits)
  const minutes = windowMinutesOf(root?.limits)
  const plan = kimiPlanLabel(weekly.limit)
  const windows: LlmAccountUsageWindow[] = [windowOf('weekly', weekly)]
  if (rate !== undefined) windows.push(windowOf('rate', rate, minutes))
  return {
    ...plan === undefined ? {} : { plan },
    windows,
  }
}
