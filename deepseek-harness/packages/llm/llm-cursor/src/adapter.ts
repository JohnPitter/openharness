/**
 * Shared constants, catalog helpers, and client-identity utilities for the
 * Cursor provider. The live transports are {@link CursorAgentAdapter}
 * (`agent.v1.AgentService/Run`, the protocol current Cursor clients speak)
 * and {@link CursorCloudAdapter} (Cloud Agent SDK opt-in); the retired
 * `aiserver.v1.ChatService` stream is rejected by the backend.
 */

import { createHash } from 'node:crypto'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'

export type GhostMode = true | false | 'implicit-false'

/**
 * Value sent as `x-cursor-client-version`. The backend rejects older pins: the
 * retired ChatService answered `resource_exhausted` trailers, while
 * AgentService simply gates the old request shapes. Bump this when the
 * installed Cursor (`product.json` `version`) or the
 * `stable`/`win32-x64-user` updater channel publishes a newer build, and keep
 * {@link DEFAULT_CLIENT_COMMIT} as the matching `commitSha`.
 */
export const DEFAULT_CLIENT_VERSION = '3.19.13'

/**
 * Value sent as `x-cursor-client-commit`, the `commitSha` of the
 * {@link DEFAULT_CLIENT_VERSION} build (Cursor download API `commitSha`, also
 * `product.json` `commit` of the installed client).
 */
export const DEFAULT_CLIENT_COMMIT = 'dd066f332fcea7382764400fde902f61920648d0'

/** One advisory catalog row, the same fields the Settings model-list editor writes. */
export interface CursorCatalogModel {
  /** Wire model id Cursor accepts. */
  id: string
  /** Selector label; defaults to {@link id}. */
  name?: string
  /** Combined request/response context when known. */
  contextWindow?: number
  /** Per-request output cap when known. */
  maxTokens?: number
}

/** Combined context used when a catalog row omits {@link CursorCatalogModel.contextWindow}. */
export const DEFAULT_CONTEXT_WINDOW = 200_000
/** Output cap used when a catalog row omits {@link CursorCatalogModel.maxTokens}. */
export const DEFAULT_MAX_TOKENS = 32_768
/**
 * Bound on `listModels` credential resolution and the GetUsableModels RPC.
 * Must stay below the host picker catalog's 4s per-provider bound so a hung
 * listing falls back to {@link DEFAULT_MODELS} instead of dropping the Cursor group.
 */
export const CATALOG_LISTING_TIMEOUT_MS = 2_500

/** Schema and adapter fallback when live listing is empty, times out, or fails. */
export const DEFAULT_MODELS: CursorCatalogModel[] = [
  {
    id: 'composer-2.5',
    name: 'Composer 2.5',
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  },
]

/** Map configured catalog rows to picker identities.
 * @param models - advisory catalog rows.
 * @returns picker identities, one per row.
 */
export function catalogModelInfo(models: readonly CursorCatalogModel[]): LlmModelInfo[] {
  return models.map(model => ({
    provider: 'cursor',
    id: model.id,
    name: model.name ?? model.id,
  }))
}

/**
 * Exact-model metadata for one catalog id, or the default capacities when the
 * id is unlisted (a live listing the Settings array has not adopted yet).
 * @param models - advisory catalog rows.
 * @param provider - registered route id.
 * @param model - exact model id.
 * @returns identity plus default or row capacities.
 */
export function resolveCatalogModel(
  models: readonly CursorCatalogModel[],
  provider: string,
  model: string,
): LlmResolvedModelInfo {
  const row = models.find(entry => entry.id === model)
  return {
    provider,
    id: model,
    name: row?.name ?? model,
    context: { contextWindow: row?.contextWindow ?? DEFAULT_CONTEXT_WINDOW },
    defaultMaxTokens: row?.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
}

/** Reject once `signal` aborts, including when it is already aborted.
 * @param signal - abort that settles this promise.
 * @returns a promise that rejects with `LlmError` code `ABORTED`.
 */
export function rejectedWhenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (): void => { reject(new LlmError('request aborted', 'ABORTED')) }
    if (signal.aborted) {
      fail()
      return
    }
    signal.addEventListener('abort', fail, { once: true })
  })
}

function base64urlNoPad(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Implements Cursor's timestamp prefix checksum for a request. */
export function checksum(machineId: string, macMachineId: string | undefined, nowMs: number): string {
  const c = BigInt(Math.floor(nowMs / 1e6))
  const raw = new Uint8Array([
    Number((c >> 40n) & 0xffn),
    Number((c >> 32n) & 0xffn),
    Number((c >> 24n) & 0xffn),
    Number((c >> 16n) & 0xffn),
    Number((c >> 8n) & 0xffn),
    Number(c & 0xffn),
  ])
  let previous = 165
  for (let i = 0; i < raw.length; i++) {
    const current = raw[i] ?? 0
    const obfuscated = (current ^ previous) + (i % 256)
    raw[i] = obfuscated
    previous = obfuscated
  }
  return base64urlNoPad(raw) + machineId + (macMachineId ? `/${macMachineId}` : '')
}

/** Derives a stable, non-secret identity for hosts without configured identity. */
export function defaultMachineId(): string {
  const user = process.env.USERNAME ?? process.env.USER ?? 'unknown'
  const host = process.env.COMPUTERNAME ?? 'unknown'
  return createHash('sha256').update(`${process.platform}:${process.arch}:${user}:${host}`).digest('hex')
}
