/**
 * usage domain zod schemas (names derived from map keys: usagePanelRequestSchema /
 * usagePanelValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { UsageBuckets, UsageDayView, UsageModelView } from './usage.ts'

/** Shared request/token bucket fields. */
export const usageBucketsSchema = z.object({
  requests: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
}) satisfies z.ZodType<Wire<UsageBuckets>>

/** One local-calendar day row of usage.panel. */
export const usageDayViewSchema = usageBucketsSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}) satisfies z.ZodType<Wire<UsageDayView>>

/** One provider/model row of usage.panel. */
export const usageModelViewSchema = usageBucketsSchema.extend({
  provider: z.string().min(1),
  model: z.string().min(1),
}) satisfies z.ZodType<Wire<UsageModelView>>

/** usage.panel request payload. */
export const usagePanelRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'usage.panel'>>>

/** usage.panel response value. */
export const usagePanelValueSchema = z.object({
  days: z.array(usageDayViewSchema),
  models: z.array(usageModelViewSchema),
  totals: usageBucketsSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'usage.panel'>>>
