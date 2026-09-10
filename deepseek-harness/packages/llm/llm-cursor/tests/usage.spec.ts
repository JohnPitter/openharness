import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'

const http2 = vi.hoisted(() => {
  const state = {
    status: 200,
    hang: false,
    body: JSON.stringify({
      billingCycleEnd: '1790791257000',
      planUsage: { autoPercentUsed: 47.08, apiPercentUsed: 100, totalPercentUsed: 53.19 },
    }),
    path: undefined as string | undefined,
    authorization: undefined as string | undefined,
    lastDestroy: undefined as ReturnType<typeof vi.fn> | undefined,
    lastClose: undefined as ReturnType<typeof vi.fn> | undefined,
  }
  const connect = vi.fn(() => {
    const close = vi.fn()
    state.lastClose = close
    return {
      request: vi.fn((headers: Record<string, string>) => {
        state.path = headers[':path']
        state.authorization = headers['authorization']
        const callbacks = new Map<string, (...args: unknown[]) => void>()
        const destroy = vi.fn(() => { callbacks.get('error')?.(new Error('destroyed')) })
        state.lastDestroy = destroy
        return {
          on(event: string, callback: (...args: unknown[]) => void) { callbacks.set(event, callback); return this },
          destroy,
          end() {
            if (state.hang) return
            queueMicrotask(() => {
              callbacks.get('response')?.({ ':status': state.status } as never)
              callbacks.get('data')?.(Buffer.from(state.body))
              callbacks.get('end')?.()
            })
          },
        }
      }),
      close,
    }
  })
  return { state, connect }
})
vi.mock('node:http2', () => ({ connect: http2.connect }))

import { ACCOUNT_USAGE_PROBE_TIMEOUT_MS, fetchCursorAccountUsage } from '../src/usage.ts'

afterEach(() => {
  vi.useRealTimers()
  http2.state.status = 200
  http2.state.hang = false
  http2.state.body = JSON.stringify({
    billingCycleEnd: '1790791257000',
    planUsage: { autoPercentUsed: 47.08, apiPercentUsed: 100, totalPercentUsed: 53.19 },
  })
})

describe('fetchCursorAccountUsage', () => {
  it('maps the auto bucket to one monthly window with the cycle reset', async () => {
    const usage = await fetchCursorAccountUsage('jwt-token')
    expect(http2.state.path).toBe('/aiserver.v1.DashboardService/GetCurrentPeriodUsage')
    expect(http2.state.authorization).toBe('Bearer jwt-token')
    expect(usage.windows).toEqual([
      { id: 'monthly', used: 47, limit: 100, percent: 47, resetsAt: 1_790_791_257 },
    ])
  })

  it('reports auth failures with the AUTH code', async () => {
    http2.state.status = 401
    await expect(fetchCursorAccountUsage('jwt-token')).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('fails loud when the payload carries no auto-bucket percent', async () => {
    http2.state.body = JSON.stringify({ planUsage: {} })
    await expect(fetchCursorAccountUsage('jwt-token')).rejects.toBeInstanceOf(LlmError)
  })

  it('omits the reset when the cycle end is not disclosed', async () => {
    http2.state.body = JSON.stringify({ planUsage: { autoPercentUsed: 12 } })
    const usage = await fetchCursorAccountUsage('jwt-token')
    expect(usage.windows[0]).toEqual({ id: 'monthly', used: 12, limit: 100, percent: 12 })
  })

  it('destroys a hanging request when the caller aborts', async () => {
    http2.state.hang = true
    const ac = new AbortController()
    const pending = fetchCursorAccountUsage('jwt-token', { signal: ac.signal })
    ac.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(http2.state.lastDestroy).toHaveBeenCalled()
    expect(http2.state.lastClose).toHaveBeenCalled()
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(fetchCursorAccountUsage('jwt-token', { signal: ac.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(http2.state.lastDestroy).toHaveBeenCalled()
    expect(http2.state.lastClose).toHaveBeenCalled()
  })

  it('times out a hanging probe when the caller omits a signal', async () => {
    http2.state.hang = true
    vi.useFakeTimers()
    const pending = fetchCursorAccountUsage('jwt-token')
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
    await vi.advanceTimersByTimeAsync(ACCOUNT_USAGE_PROBE_TIMEOUT_MS)
    await assertion
    expect(http2.state.lastDestroy).toHaveBeenCalled()
  })
})
