/**
 * Account-quota parsers and probe URLs for coding-plan routes (Claude Code,
 * Codex, GLM). The chip already knows weekly + 5-hour windows; these adapters
 * are what fill them. Pay-per-token routes (Anthropic console, OpenAI
 * Platform) have no such surface.
 *
 * @module dsh-llm-pi-ai/usages
 */

import { attributionHeaders, LlmError, userAgent } from '@deepseek-ai/dsh-llm'
import type { LlmAccountUsage, LlmAccountUsageWindow } from '@deepseek-ai/dsh-llm'

/** Claude Code `/usage` — undocumented, same path the CLI slash-command hits. */
export const CLAUDE_CODE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/** Codex ChatGPT usage snapshot (`wham/usage`). */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** Product token Anthropic's usage bucket requires as the User-Agent prefix. */
const CLAUDE_CODE_UA = 'claude-code/2.1.80'

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

function occupancyPercent(used: number, limit: number): number {
  if (limit <= 0) return 0
  return Math.min(100, Math.max(0, Math.round(used / limit * 100)))
}

/**
 * Utilization arrives as 0–1 or 0–100 depending on the build. Values ≤ 1 are
 * treated as fractions (`1` = exhausted); anything above is already percent.
 */
export function percentFromUtilization(value: number): number {
  const raw = value <= 1 ? value * 100 : value
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return Math.floor(ms / 1000)
  }
  return undefined
}

function percentWindow(
  id: string,
  percent: number,
  resetsAt?: number,
  windowMinutes?: number,
): LlmAccountUsageWindow {
  return {
    id,
    used: percent,
    limit: 100,
    percent,
    ...resetsAt === undefined ? {} : { resetsAt },
    ...windowMinutes === undefined ? {} : { windowMinutes },
  }
}

function countWindow(
  id: string,
  used: number,
  limit: number,
  resetsAt?: number,
  windowMinutes?: number,
): LlmAccountUsageWindow {
  return {
    id,
    used,
    limit,
    percent: occupancyPercent(used, limit),
    ...resetsAt === undefined ? {} : { resetsAt },
    ...windowMinutes === undefined ? {} : { windowMinutes },
  }
}

function titleCase(value: string): string {
  if (value.length === 0) return value
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`
}

function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  return 'TRANSPORT'
}

/** Headers for Claude Code usage. UA must start with `claude-code/` or Anthropic 429s. */
export function claudeCodeUsageHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    'anthropic-beta': 'oauth-2025-04-20',
    ...attributionHeaders(),
    'user-agent': `${CLAUDE_CODE_UA} ${userAgent()}`,
  }
}

function claudeBucket(
  id: string,
  raw: unknown,
  windowMinutes?: number,
): LlmAccountUsageWindow | undefined {
  const bucket = asMap(raw)
  if (bucket === undefined) return undefined
  const utilization = jsonNumber(bucket.utilization)
  if (utilization === undefined) return undefined
  return percentWindow(
    id,
    percentFromUtilization(utilization),
    unixSeconds(bucket.resets_at ?? bucket.resetsAt),
    windowMinutes,
  )
}

/** Parse Claude Code `GET /api/oauth/usage`. */
export function parseClaudeCodeUsage(body: unknown): LlmAccountUsage {
  const root = asMap(body)
  const fiveHour = claudeBucket('rate', root?.five_hour, 300)
  const weekly = claudeBucket('weekly', root?.seven_day)
  const windows = [weekly, fiveHour].filter((window): window is LlmAccountUsageWindow => window !== undefined)
  if (windows.length === 0) throw new Error('Invalid Claude Code usage response')
  return { windows }
}

/** `chatgpt_account_id` claim from a Codex JWT, when the token carries one. */
export function chatgptAccountId(token: string): string | undefined {
  const parts = token.split('.')
  if (parts.length < 2 || parts[1] === undefined) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown
    const root = asMap(payload)
    const nested = asMap(root?.['https://api.openai.com/auth'])
    const id = root?.chatgpt_account_id ?? nested?.chatgpt_account_id
    return typeof id === 'string' && id.length > 0 ? id : undefined
  } catch {
    return undefined
  }
}

/** Headers for Codex `wham/usage`. */
export function codexUsageHeaders(token: string): Record<string, string> {
  const accountId = chatgptAccountId(token)
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...attributionHeaders(),
    ...accountId === undefined ? {} : { 'chatgpt-account-id': accountId },
  }
}

function codexWindow(
  id: string,
  raw: unknown,
): LlmAccountUsageWindow | undefined {
  const window = asMap(raw)
  if (window === undefined) return undefined
  const percent = jsonNumber(window.used_percent ?? window.usedPercent)
  if (percent === undefined) return undefined
  const seconds = jsonNumber(window.limit_window_seconds ?? window.limitWindowSeconds)
  const minutes = seconds !== undefined && seconds > 0 ? Math.round(seconds / 60) : undefined
  return percentWindow(
    id,
    Math.min(100, Math.max(0, Math.round(percent))),
    unixSeconds(window.reset_at ?? window.resetAt ?? window.resetsAt),
    minutes,
  )
}

function windowIdForMinutes(minutes: number | undefined, fallback: 'rate' | 'weekly'): 'rate' | 'weekly' {
  if (minutes === undefined) return fallback
  return minutes < 24 * 60 ? 'rate' : 'weekly'
}

/** Parse Codex `GET /backend-api/wham/usage`. */
export function parseCodexUsage(body: unknown): LlmAccountUsage {
  const root = asMap(body)
  const rateLimit = asMap(root?.rate_limit) ?? asMap(root?.rateLimit)
  const primary = codexWindow('rate', rateLimit?.primary_window ?? rateLimit?.primaryWindow)
  const secondary = codexWindow('weekly', rateLimit?.secondary_window ?? rateLimit?.secondaryWindow)
  const windows: LlmAccountUsageWindow[] = []
  if (primary !== undefined) {
    windows.push({ ...primary, id: windowIdForMinutes(primary.windowMinutes, 'rate') })
  }
  if (secondary !== undefined) {
    windows.push({ ...secondary, id: windowIdForMinutes(secondary.windowMinutes, 'weekly') })
  }
  if (windows.length === 0) throw new Error('Invalid Codex usage response')
  const planRaw = root?.plan_type ?? root?.planType
  const plan = typeof planRaw === 'string' && planRaw.length > 0 ? titleCase(planRaw) : undefined
  return {
    ...plan === undefined ? {} : { plan },
    windows,
  }
}

/** GLM Coding Plan quota URL from the coding-plan base, or the public host. */
export function zaiQuotaUrl(baseURL?: string): string {
  let origin = 'https://api.z.ai'
  if (baseURL !== undefined && baseURL.length > 0) {
    try {
      origin = new URL(baseURL).origin
    } catch {
      origin = 'https://api.z.ai'
    }
  }
  return `${origin}/api/monitor/usage/quota/limit`
}

/** Headers for GLM `/api/monitor/usage/quota/limit`. */
export function zaiQuotaHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    ...attributionHeaders(),
  }
}

function zaiLimitMinutes(raw: Record<string, unknown>): number | undefined {
  const unit = jsonNumber(raw.unit)
  if (unit === 3) return 300
  if (unit === 6) return 10_080
  const duration = jsonNumber(raw.duration)
  if (duration === undefined || duration <= 0) return undefined
  const timeUnit = raw.timeUnit ?? raw.time_unit
  if (timeUnit === 'TIME_UNIT_MINUTE' || timeUnit === 'minute') return duration
  if (timeUnit === 'TIME_UNIT_HOUR' || timeUnit === 'hour') return duration * 60
  if (timeUnit === 'TIME_UNIT_DAY' || timeUnit === 'day') return duration * 24 * 60
  return duration
}

/** Token / credit windows the chip maps onto 5-hour and weekly meters. */
const ZAI_TOKEN_LIMIT_TYPES = new Set(['TOKENS_LIMIT', 'CREDIT_LIMIT'])

function zaiLimitWindow(raw: unknown): LlmAccountUsageWindow | undefined {
  const limit = asMap(raw)
  if (limit === undefined) return undefined
  const type = limit.type
  if (typeof type === 'string' && !ZAI_TOKEN_LIMIT_TYPES.has(type)) return undefined
  const minutes = zaiLimitMinutes(limit)
  const id = windowIdForMinutes(minutes, 'weekly')
  const resetsAt = unixSeconds(limit.nextResetTime ?? limit.next_reset_time ?? limit.resetTime)
  // Monitor rows name the cap `usage` and the consumed amount `currentValue`
  // (Lite coding-plan credits). Older fixtures used `used`/`limit`.
  const used = jsonNumber(limit.currentValue ?? limit.used)
  const cap = jsonNumber(limit.limit ?? (used !== undefined ? limit.usage : undefined))
  if (used !== undefined && cap !== undefined && cap > 0) {
    return countWindow(id, used, cap, resetsAt, minutes)
  }
  const percent = jsonNumber(limit.percentage ?? limit.percent)
  if (percent === undefined) return undefined
  return percentWindow(id, Math.min(100, Math.max(0, Math.round(percent))), resetsAt, minutes)
}

function zaiPlanName(data: Record<string, unknown>): string | undefined {
  const named = data.planName ?? data.plan_name ?? data.plan ?? data.plan_type ?? data.packageName
  if (typeof named === 'string' && named.length > 0) return named
  const level = data.level
  return typeof level === 'string' && level.length > 0 ? titleCase(level) : undefined
}

/** Parse GLM `GET /api/monitor/usage/quota/limit`. */
export function parseZaiUsage(body: unknown): LlmAccountUsage {
  const root = asMap(body)
  const data = asMap(root?.data) ?? root
  const items = data?.limits
  if (!Array.isArray(items)) throw new Error('Invalid GLM usage response')
  const windows = items
    .map(zaiLimitWindow)
    .filter((window): window is LlmAccountUsageWindow => window !== undefined)
  if (windows.length === 0) throw new Error('Invalid GLM usage response')
  const plan = zaiPlanName(data)
  return {
    ...plan === undefined ? {} : { plan },
    windows,
  }
}

/**
 * GET one JSON usage body. Failures stay coded so the chip can show them
 * beside session meters instead of failing the RPC.
 */
export async function fetchUsageJson(
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers, ...signal === undefined ? {} : { signal } })
  } catch (error: unknown) {
    if (signal?.aborted) {
      throw new LlmError('usage request aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`usage request to ${url} failed`, 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `usage error (HTTP ${response.status})`,
      httpErrorCode(response.status),
      { status: response.status },
    )
  }
  try {
    return await response.json()
  } catch (error: unknown) {
    throw new LlmError('usage response was not JSON', 'INVALID_USAGE', { cause: error })
  }
}
