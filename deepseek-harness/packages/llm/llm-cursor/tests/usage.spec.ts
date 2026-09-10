import { describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'

const http2 = vi.hoisted(() => {
  const state = {
    status: 200,
    body: JSON.stringify({
      billingCycleEnd: '1790791257000',
      planUsage: { autoPercentUsed: 47.08, apiPercentUsed: 100, totalPercentUsed: 53.19 },
    }),
    path: undefined as string | undefined,
    authorization: undefined as string | undefined,
  }
  const connect = vi.fn(() => ({
    request: vi.fn((headers: Record<string, string>) => {
      state.path = headers[':path']
      state.authorization = headers['authorization']
      const callbacks = new Map<string, (...args: unknown[]) => void>()
      return {
        on(event: string, callback: (...args: unknown[]) => void) { callbacks.set(event, callback); return this },
        destroy() { callbacks.get('error')?.(new Error('destroyed')) },
        end() {
          queueMicrotask(() => {
            callbacks.get('response')?.({ ':status': state.status } as never)
            callbacks.get('data')?.(Buffer.from(state.body))
            callbacks.get('end')?.()
          })
        },
      }
    }),
    close: vi.fn(),
  }))
  return { state, connect }
})
vi.mock('node:http2', () => ({ connect: http2.connect }))

import { fetchCursorAccountUsage } from '../src/usage.ts'

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
    http2.state.status = 200
  })

  it('fails loud when the payload carries no auto-bucket percent', async () => {
    http2.state.body = JSON.stringify({ planUsage: {} })
    await expect(fetchCursorAccountUsage('jwt-token')).rejects.toBeInstanceOf(LlmError)
    http2.state.body = JSON.stringify({ planUsage: { autoPercentUsed: 12 } })
  })

  it('omits the reset when the cycle end is not disclosed', async () => {
    http2.state.body = JSON.stringify({ planUsage: { autoPercentUsed: 12 } })
    const usage = await fetchCursorAccountUsage('jwt-token')
    expect(usage.windows[0]).toEqual({ id: 'monthly', used: 12, limit: 100, percent: 12 })
  })
})
