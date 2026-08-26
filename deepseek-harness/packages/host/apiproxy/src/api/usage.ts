/**
 * usage domain contract: Host-local request and token history for the
 * Settings panel. `usage.panel` is the folded ledger, not provider account
 * quotas (`llm.accountUsage`).
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Request and token buckets attributed to one day or one model route. */
export interface UsageBuckets {
  /** Distinct model steps that reported usage (a later sample for the same turn/step replaces, and does not increment). */
  requests: number
  /** Uncached prompt tokens. */
  inputTokens: number
  /** Completion tokens. */
  outputTokens: number
  /** Prompt tokens served from cache. */
  cacheReadTokens: number
  /** Prompt tokens written into cache. */
  cacheWriteTokens: number
}

/** One local-calendar day in the usage panel. */
export interface UsageDayView extends UsageBuckets {
  /** Local calendar day `YYYY-MM-DD` taken from the usage event's `time`. */
  date: string
}

/** One provider/model route in the usage panel. */
export interface UsageModelView extends UsageBuckets {
  /** Provider route key. */
  provider: string
  /** Provider-owned model id. */
  model: string
}

/** Folded Host-local usage history returned by `usage.panel`. */
export interface UsagePanelView {
  /** Daily buckets, newest calendar day first. */
  days: UsageDayView[]
  /** Per-route buckets, highest token total first. */
  models: UsageModelView[]
  /** Sum of every retained day. */
  totals: UsageBuckets
}

/** Usage-domain unary methods (the map keys usage.* of RpcMethodMap). */
export interface UsageApi {
  /**
   * Host-local request and token history folded from session logs and live
   * `session/event` ingest. The durable file at `$DSH_HOME/usage-panel.json`
   * keeps deleted sessions in the totals. Empty when nothing has reported usage.
   */
  panel(request: RpcRequest<{}>): Promise<RpcResponse<UsagePanelView>>
}
