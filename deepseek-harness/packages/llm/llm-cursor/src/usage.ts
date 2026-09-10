/**
 * Account-quota probe for the Cursor coding plan: one unary Connect-JSON call
 * to `aiserver.v1.DashboardService/GetCurrentPeriodUsage` on the same
 * `api2.cursor.sh` origin the agent protocol runs on. The plan meters spend
 * in two buckets — the `auto` bucket serves every composer/grok model this
 * adapter lists, the `api` bucket serves named frontier models — inside one
 * monthly billing cycle; the probe reports the auto bucket as the single
 * `monthly` window, since it is the bucket every route of this adapter draws
 * from.
 *
 * @module @deepseek-ai/dsh-llm-cursor/usage
 */

import { connect } from 'node:http2'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmAccountUsage } from '@deepseek-ai/dsh-llm'
import { DEFAULT_BACKEND_URL } from './auth.ts'

const PERIOD_USAGE_PATH = '/aiserver.v1.DashboardService/GetCurrentPeriodUsage'

/**
 * Bound on GetCurrentPeriodUsage when the caller omits a signal. Same
 * order as the picker catalog listing timeout so a hung HTTP/2 connect
 * cannot stall Settings → Limits.
 */
export const ACCOUNT_USAGE_PROBE_TIMEOUT_MS = 2_500

/** Options for {@link fetchCursorAccountUsage}. */
export interface CursorUsageTransport {
  /** API origin (no trailing slash required); defaults to {@link DEFAULT_BACKEND_URL}. */
  backendURL?: string
  /** Aborts the probe; a pending request is destroyed and the promise rejects with `AbortError`. */
  signal?: AbortSignal
}

/** The fields of the `GetCurrentPeriodUsage` response this adapter reads. */
interface PeriodUsageResponse {
  billingCycleEnd?: string
  planUsage?: { autoPercentUsed?: number }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

/**
 * Read the account's current billing-cycle usage.
 * @param accessToken - the Cursor JWT bearer.
 * @param options - transport override.
 * @returns the monthly window for the auto (composer-model) bucket.
 * @throws LlmError code `AUTH` on 401/403, `PROVIDER_ERROR` otherwise.
 */
export async function fetchCursorAccountUsage(
  accessToken: string,
  options: CursorUsageTransport = {},
): Promise<LlmAccountUsage> {
  const backendURL = (options.backendURL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  const url = new URL(backendURL)
  const timeout = new AbortController()
  const timer = options.signal === undefined
    ? setTimeout(() => {
      timeout.abort(new DOMException('The operation was aborted', 'TimeoutError'))
    }, ACCOUNT_USAGE_PROBE_TIMEOUT_MS)
    : undefined
  const signal = options.signal ?? timeout.signal
  const client = connect(url.origin)
  try {
    const response = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      let settled = false
      const chunks: Buffer[] = []
      const body = Buffer.from('{}')
      const request = client.request({
        ':method': 'POST',
        ':path': PERIOD_USAGE_PATH,
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'connect-protocol-version': '1',
        'content-length': String(body.length),
      })
      const finish = (error: unknown, value?: { status: number; body: Buffer }): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        if (error !== undefined) reject(error)
        else resolve(value!)
      }
      const onAbort = (): void => {
        request.destroy()
        finish(abortReason(signal))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      request.on('response', (headers) => {
        request.on('data', (chunk: Uint8Array) => { chunks.push(Buffer.from(chunk)) })
        request.on('end', () => {
          finish(undefined, { status: headers[':status'] ?? 0, body: Buffer.concat(chunks) })
        })
      })
      request.on('error', (error: unknown) => {
        finish(signal.aborted ? abortReason(signal) : error)
      })
      request.end(body)
    })
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(`Cursor usage probe failed: HTTP ${response.status}`, 'AUTH')
    }
    if (response.status !== 200) {
      throw new LlmError(`Cursor usage probe failed: HTTP ${response.status}`, 'PROVIDER_ERROR')
    }
    const payload = JSON.parse(response.body.toString('utf8')) as PeriodUsageResponse
    const percent = payload.planUsage?.autoPercentUsed
    if (typeof percent !== 'number' || !Number.isFinite(percent)) {
      throw new LlmError('Cursor usage probe returned no planUsage.autoPercentUsed', 'PROVIDER_ERROR')
    }
    const cycleEndMs = Number(payload.billingCycleEnd)
    const rounded = Math.min(100, Math.max(0, Math.round(percent)))
    return {
      windows: [{
        id: 'monthly',
        used: rounded,
        limit: 100,
        percent: rounded,
        ...Number.isFinite(cycleEndMs) && cycleEndMs > 0 ? { resetsAt: Math.floor(cycleEndMs / 1000) } : {},
      }],
    }
  } catch (error) {
    if (error instanceof LlmError) throw error
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw error
    }
    throw new LlmError(
      error instanceof Error ? error.message : 'Cursor usage probe failed', 'PROVIDER_ERROR', { cause: error })
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    client.close()
  }
}
