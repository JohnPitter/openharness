/**
 * `KimiAdapter`: fetch + SSE against a Kimi for Code (OpenAI-compatible)
 * chat-completions endpoint, emitting harness StreamChunks. The adapter is
 * transport-only: connection facts arrive through a thunk resolved once per
 * operation and the bearer token through a per-request resolver, so the
 * registering plugin owns validation, layering, and credential policy.
 *
 * @module dsh-llm-kimi/adapter
 */

import { attributionHeaders, CONTEXT_WINDOW_EXCEEDED_CODE, INVALID_CREDENTIAL_CODE, isContextWindowExceededError, isMissingCredential, isQuotaExceededError, LlmAdapter, LlmError, ProviderRequestId, QUOTA_EXCEEDED_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmAccountUsage,
  LlmModelInfo,
  LlmModelReasoningInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import { serializeRequest, reasoningFamilyOf } from './serialize.ts'
import { parseKimiCodeUsages } from './usages.ts'
import type { RequestDefaults } from './serialize.ts'
import { parseSse } from './sse.ts'
import { translate } from './translate.ts'
import type { WireError } from './types.ts'

/** One optional model entry advertised by the direct-fetch adapter. */
export interface KimiCatalogModel {
  /** Wire model id accepted by the configured endpoint. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Optional selector detail for deployments with similar model variants. */
  description?: string
  /** Known combined request/response context capacity; omitted when deployment metadata is unavailable. */
  contextWindow?: number
  /** Per-request output cap for this model; omission falls back to the profile's {@link KimiConnectionOptions.maxTokens}. */
  maxTokens?: number
}

/**
 * Validated connection facts for one operation. The plugin's
 * `resolveAdapterOptions` is the one explicit resolve step producing this
 * shape; the adapter trusts it and re-reads it per operation, which is what
 * makes a configuration change reach the next request without re-registration.
 */
export interface KimiConnectionOptions {
  /** Endpoint base; `/chat/completions` is appended. */
  baseURL: string
  /**
   * Credential reference of this same resolution, resolved per request.
   * Travelling with the endpoint is the point: a request can never pair one
   * generation's URL with another generation's secret. Configuration carries
   * only this name — a literal key is not a configuration value.
   */
  apiKeyEnv: CredentialRef
  /** Request defaults applied to every call (thinking mode, effort). */
  defaults: RequestDefaults
  /** Default per-request output cap; explicit request values win. */
  maxTokens: number
  /** Positive context capacity used when the selected model has no exact value. */
  defaultContextWindow: number
  /** Advisory models exposed to discovery consumers; requests remain unrestricted. */
  models: readonly KimiCatalogModel[]
  /** Maximum provider idle time while one stream read is outstanding. */
  streamIdleTimeoutMs: number
  /** Provider-owned model-request retry policy, already resolved. */
  retryPolicy: ResolvedRetryPolicy
}

/** Constructor options for {@link KimiAdapter}: the operation-local resolution hooks the plugin owns. */
export interface KimiAdapterOptions {
  /** Current validated connection facts; called once per operation. */
  options: () => KimiConnectionOptions
  /**
   * Resolve the bearer token for the connection facts of one request. The
   * snapshot is passed in — never re-read — so the key can only ever come
   * from the same resolution as the endpoint it is sent to. Throws `LlmError`
   * `MISSING_CREDENTIAL` when no key is available anywhere.
   */
  resolveApiKey: (connection: KimiConnectionOptions) => Promise<string>
}

/** Default maximum idle interval while an adapter stream read is outstanding. */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
/** Default combined request/response context capacity. */
export const DEFAULT_CONTEXT_WINDOW = 262_144
/** Default per-request output-token cap. */
export const DEFAULT_MAX_TOKENS = 32_768
const STREAM_IDLE_TIMEOUT_CODE = 'LLM_STREAM_IDLE_TIMEOUT'
const OFF_REASONING_EFFORT = ReasoningEffortId('off')
const LOW_REASONING_EFFORT = ReasoningEffortId('low')
const HIGH_REASONING_EFFORT = ReasoningEffortId('high')
const MAX_REASONING_EFFORT = ReasoningEffortId('max')
const K2_TOGGLE_REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
] as const
const K3_REASONING_EFFORTS = [
  { id: LOW_REASONING_EFFORT, name: 'Low' },
  { id: HIGH_REASONING_EFFORT, name: 'High' },
  { id: MAX_REASONING_EFFORT, name: 'Max' },
] as const
const K2_ALWAYS_REASONING_EFFORTS = [
  { id: HIGH_REASONING_EFFORT, name: 'High' },
] as const
const OFF_ONLY_REASONING_EFFORTS = [
  { id: OFF_REASONING_EFFORT, name: 'Off' },
] as const

function k3DefaultEffort(defaults: RequestDefaults): typeof LOW_REASONING_EFFORT | typeof HIGH_REASONING_EFFORT | typeof MAX_REASONING_EFFORT {
  if (defaults.reasoningEffort === 'low' || defaults.reasoningEffort === 'off') {
    return LOW_REASONING_EFFORT
  }
  if (defaults.reasoningEffort === 'max') return MAX_REASONING_EFFORT
  return HIGH_REASONING_EFFORT
}

function reasoningForModel(model: string, defaults: RequestDefaults): LlmModelReasoningInfo {
  const family = reasoningFamilyOf(model)
  if (family === 'k3') {
    return { efforts: [...K3_REASONING_EFFORTS], defaultEffort: k3DefaultEffort(defaults) }
  }
  if (family === 'k2-always') {
    return { efforts: [...K2_ALWAYS_REASONING_EFFORTS], defaultEffort: HIGH_REASONING_EFFORT }
  }
  if (defaults.thinking === 'disabled') {
    return { efforts: [...OFF_ONLY_REASONING_EFFORTS], defaultEffort: OFF_REASONING_EFFORT }
  }
  return {
    efforts: [...K2_TOGGLE_REASONING_EFFORTS],
    defaultEffort: defaults.reasoningEffort === 'off' ? OFF_REASONING_EFFORT : HIGH_REASONING_EFFORT,
  }
}

function modelInfo(provider: string, model: KimiCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: ['text'],
  }
}

/** One entry of the endpoint's `GET {baseURL}/models` listing, before narrowing. */
interface LiveModelEntry {
  id?: unknown
  display_name?: unknown
  description?: unknown
  context_length?: unknown
  max?: unknown
}

/** Response envelope of `GET {baseURL}/models` (OpenAI-compatible listing). */
interface LiveModelList {
  data?: unknown
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined
}

/**
 * Narrow the live `/models` body to catalog entries, keeping the response's
 * declared capacities; entries without a string id are dropped.
 * @param body - parsed response body of the models listing.
 * @returns catalog entries for every listable model.
 */
export function parseLiveCatalog(body: LiveModelList): KimiCatalogModel[] {
  if (!Array.isArray(body.data)) return []
  const models: KimiCatalogModel[] = []
  for (const raw of body.data) {
    const entry = raw as LiveModelEntry
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    const name = typeof entry.display_name === 'string' && entry.display_name.length > 0
      ? entry.display_name
      : undefined
    const description = typeof entry.description === 'string' && entry.description.length > 0
      ? entry.description
      : undefined
    const contextWindow = positiveInteger(entry.context_length)
    const maxTokens = positiveInteger(entry.max)
    models.push({
      id: entry.id,
      ...name === undefined ? {} : { name },
      ...description === undefined ? {} : { description },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Overlay the live listing on the configured catalog: live capacities win per
 * id, configured entries absent from the listing are kept (the endpoint may
 * not advertise a configured alias), live-only ids are appended.
 * @param configured - catalog from the plugin's settings.
 * @param live - catalog parsed from the endpoint's listing.
 * @returns the merged catalog for discovery consumers.
 */
export function mergeCatalogs(
  configured: readonly KimiCatalogModel[],
  live: readonly KimiCatalogModel[],
): KimiCatalogModel[] {
  const liveById = new Map(live.map(entry => [entry.id, entry]))
  const merged = configured.map(entry => ({ ...entry, ...liveById.get(entry.id) }))
  const configuredIds = new Set(configured.map(entry => entry.id))
  for (const entry of live) {
    if (!configuredIds.has(entry.id)) merged.push(entry)
  }
  return merged
}

function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1_000
    return Number.isFinite(delay) && delay > 0 ? delay : undefined
  }
  const delay = Date.parse(value) - Date.now()
  return Number.isFinite(delay) && delay > 0 ? delay : undefined
}

function requestId(headers: Headers): ReturnType<typeof ProviderRequestId> | undefined {
  const value = headers.get('x-request-id') ?? headers.get('x-trace-id')
  return value === null || value.length === 0 ? undefined : ProviderRequestId(value)
}

/**
 * Map an HTTP status to a stable LlmError code.
 * @param status - status of a non-2xx provider response.
 * @param error - parsed provider error body, when available.
 * @returns the normalized harness error code.
 */
export function httpErrorCode(status: number, error?: WireError['error']): string {
  if (status === 401 || status === 403) return 'AUTH'
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(' ')
  if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) {
    if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE
    return 'INVALID_REQUEST'
  }
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * The Kimi for Code `LlmAdapter`. One instance serves every model name it was
 * registered under (the harness model name IS the wire model name).
 *
 * One stable signal reaches both initial fetch and body reads. Caller aborts
 * map to `ABORTED`; the configured per-read idle watchdog maps to `TIMEOUT`.
 */
export class KimiAdapter extends LlmAdapter {
  /** Last successful live `/models` listing, enriching uncatalogued resolutions. */
  private liveCatalog: readonly KimiCatalogModel[] = []

  constructor(private readonly config: KimiAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Kimi for Code', metering: 'requests' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy {
    return this.config.options().retryPolicy
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return (await this.catalog()).map(model => modelInfo(provider, model))
  }

  override async advertiseModels(_provider: string): Promise<boolean> {
    try {
      await this.config.resolveApiKey(this.config.options())
      return true
    } catch (error: unknown) {
      if (isMissingCredential(error)) return false
      if (error instanceof LlmError && error.code === INVALID_CREDENTIAL_CODE) return true
      throw error
    }
  }

  /**
   * Read the code-API weekly/rate quota with the same stored key as chat.
   * Account-level: every session on this route shares the returned windows.
   */
  override async accountUsage(_provider: string, signal?: AbortSignal): Promise<LlmAccountUsage> {
    const connection = this.config.options()
    const apiKey = await this.config.resolveApiKey(connection)
    let response: Response
    try {
      response = await fetch(`${connection.baseURL}/usages`, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          ...attributionHeaders(),
        },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (signal?.aborted) {
        throw new LlmError('Kimi usage request aborted by caller', 'ABORTED', { cause: error })
      }
      throw new LlmError(
        `Kimi usage request to ${connection.baseURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new LlmError(
        `Kimi usage error (HTTP ${response.status})`,
        httpErrorCode(response.status),
        { status: response.status },
      )
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error: unknown) {
      throw new LlmError('Kimi usage response was not JSON', 'INVALID_USAGE', { cause: error })
    }
    try {
      return parseKimiCodeUsages(body)
    } catch (error: unknown) {
      throw new LlmError(
        error instanceof Error ? error.message : 'Invalid Kimi usage response',
        'INVALID_USAGE',
        { cause: error },
      )
    }
  }

  /**
   * Fetch the endpoint's live model listing, merged over the configured
   * catalog. The listing needs the bearer token, so a missing credential, a
   * network failure, or an unreadable body degrades to the configured
   * advisory catalog — discovery must survive an endpoint that is down or a
   * key that is not set yet.
   * @returns the merged catalog for discovery consumers.
   */
  private async catalog(): Promise<readonly KimiCatalogModel[]> {
    const connection = this.config.options()
    try {
      const apiKey = await this.config.resolveApiKey(connection)
      const response = await fetch(`${connection.baseURL}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (!response.ok) return connection.models
      const live = parseLiveCatalog(await response.json() as LiveModelList)
      if (live.length === 0) return connection.models
      this.liveCatalog = live
      return mergeCatalogs(connection.models, live)
    } catch {
      return connection.models
    }
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const configured = connection.models.find(entry => entry.id === model)
      // The live listing enriches uncatalogued ids (e.g. a model the endpoint
      // added after this build) without requiring a settings round-trip.
      ?? this.liveCatalog.find(entry => entry.id === model)
    const contextWindow = configured?.contextWindow
      ?? connection.defaultContextWindow
    return Promise.resolve({
      // The chat-completions wire route is text-only regardless of catalog
      // membership, so the uncatalogued fallback declares the same negative
      // capability — "unknown" here would let the host accept and persist
      // images the serializer must then reject.
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured),
      context: { contextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      reasoning: reasoningForModel(model, connection.defaults),
    })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // One resolution per stream call: connection facts and the credential
    // freeze here and hold for this whole request, so an in-flight stream
    // never observes a configuration change and the next call re-resolves.
    // The key resolves *from this snapshot*, so an endpoint and the secret
    // sent to it can never come from different configuration generations.
    const connection = this.config.options()
    const apiKey = await this.config.resolveApiKey(connection)
    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    using watchdog = idleWatchdog(upstream, connection.streamIdleTimeoutMs, STREAM_IDLE_TIMEOUT_CODE)
    const iterator = this.request(
      options,
      watchdog.signal,
      connection,
      apiKey,
      () => { watchdog.pulse() },
    )[Symbol.asyncIterator]()
    let exhausted = false
    try {
      while (true) {
        const result = await watchdog.next(iterator)
        if (result.done) {
          exhausted = true
          return
        }
        yield result.value
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, STREAM_IDLE_TIMEOUT_CODE) !== undefined) {
        throw new LlmError(
          `Kimi stream idle timeout after ${connection.streamIdleTimeoutMs}ms`,
          'TIMEOUT',
          { cause: error },
        )
      }
      if (options.signal?.aborted) {
        throw new LlmError('Kimi request aborted by caller', 'ABORTED', { cause: error })
      }
      if (error instanceof LlmError) throw error
      throw new LlmError(`Kimi API stream from ${connection.baseURL} failed`, 'TRANSPORT', { cause: error })
    } finally {
      consumer.abort('Kimi stream consumer stopped')
      if (!exhausted && iterator.return !== undefined) {
        try {
          await iterator.return()
        } catch (_abortedTransportTeardown) {
          // The consumer controller already owns termination; a return-time abort cannot add a second outcome.
        }
      }
    }
  }

  private async * request(
    options: GenerateOptions,
    signal: AbortSignal,
    connection: KimiConnectionOptions,
    apiKey: string,
    onComment: () => void,
  ): AsyncIterable<StreamChunk> {
    const body = serializeRequest(options, connection.defaults)
    // Prepared outside the try so the TRANSPORT label below covers exactly the
    // transport boundary, never a serialization failure.
    const payload = JSON.stringify(body)
    const headers = {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'accept': 'text/event-stream',
      ...attributionHeaders(),
    }

    // TODO(http): adopt the Cordis HTTP service when shared transport configuration
    // outweighs its additional runtime dependencies.
    let response: Response
    try {
      response = await fetch(`${connection.baseURL}/chat/completions`, {
        method: 'POST',
        headers,
        body: payload,
        signal,
      })
    } catch (error: unknown) {
      // The outer stream distinguishes caller cancellation and watchdog expiry.
      if (signal.aborted) throw error
      // fetch wraps every transport failure (DNS, refused connection, TLS,
      // proxy) in a bare `TypeError: fetch failed` whose actionable detail
      // lives on `cause`. Wrapping with the endpoint and chaining the cause
      // lets `errorChain` render the full diagnosis at every reporting boundary.
      throw new LlmError(
        `Kimi API request to ${connection.baseURL} failed`,
        'TRANSPORT',
        { cause: error },
      )
    }

    if (!response.ok) {
      let message = `Kimi API error (HTTP ${response.status})`
      let providerError: WireError['error']
      try {
        const parsed = await response.json() as WireError
        providerError = parsed.error
        if (providerError?.message) message = providerError.message
      } catch {
        // Only swallow error-body parsing: the HTTP status still identifies the
        // failure, so malformed gateway JSON must not mask it.
      }
      const delay = providerRetryAfterMs(response.headers.get('retry-after'))
      const id = requestId(response.headers)
      throw new LlmError(message, httpErrorCode(response.status, providerError), {
        status: response.status,
        ...delay === undefined ? {} : { providerRetryAfterMs: delay },
        ...id === undefined ? {} : { requestId: id },
      })
    }
    if (!response.body) {
      throw new LlmError('Kimi API returned no response body', 'EMPTY_RESPONSE')
    }

    yield* translate(parseSse(response.body, onComment))
  }
}
