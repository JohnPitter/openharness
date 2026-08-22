/**
 * Settings-page interrogation of the Kimi for Code `GET {baseURL}/models`
 * listing. Unlike the adapter's resolve-time catalog merge, a failed listing
 * here is reported to the form rather than silently falling back.
 *
 * @module @deepseek-ai/dsh-llm-kimi/discovery
 */

import { attributionHeaders, INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { mergeCatalogs, parseLiveCatalog } from './adapter.ts'
import type { KimiCatalogModel } from './adapter.ts'

const MAX_RESPONSE_BYTES = 1_048_576

function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

function toDiscovered(entry: KimiCatalogModel): LlmDiscoveredModel {
  return {
    id: entry.id,
    ...entry.name === undefined ? {} : { name: entry.name },
    ...entry.contextWindow === undefined ? {} : { contextWindow: entry.contextWindow },
    ...entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens },
  }
}

/**
 * Fetch the live model listing for the draft the Models page is editing.
 * @param request - endpoint and one-shot credential from the form.
 * @param storedApiKey - the route's already-stored key, asked only when the draft carries none.
 * @param defaultBaseURL - public or configured endpoint when the draft names none.
 * @param configured - advisory catalog merged under live entries.
 * @returns live models overlaid on the configured catalog.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  storedApiKey: () => Promise<string | undefined>,
  defaultBaseURL: string,
  configured: readonly KimiCatalogModel[],
): Promise<readonly LlmDiscoveredModel[]> {
  const baseURL = request.baseURL === undefined || request.baseURL.length === 0
    ? defaultBaseURL
    : request.baseURL
  const url = listingUrl(baseURL)
  const supplied = request.apiKey ?? await storedApiKey()
  if (supplied === undefined) {
    throw new LlmError(
      'Kimi model listing requires an API key; enter it on this card',
      'DISCOVERY_FAILED',
    )
  }
  const apiKey = usableProbeKey(supplied)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
        ...attributionHeaders(),
      },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  }
  let text: string
  try {
    text = await response.text()
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not read ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) {
    throw new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  const live = parseLiveCatalog(body as { data?: unknown })
  if (live.length === 0) {
    throw new LlmError(
      'the endpoint\'s model listing has no usable ids; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  return mergeCatalogs(configured, live).map(toDiscovered)
}
