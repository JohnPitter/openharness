import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'

const http2 = vi.hoisted(() => {
  const state = { status: 200, body: JSON.stringify({ apiKey: 'crsr_test_key' }), close: vi.fn() }
  const connect = vi.fn(() => ({
    request: vi.fn(() => {
      const callbacks = new Map<string, (...args: unknown[]) => void>()
      return {
        on(event: string, callback: (...args: unknown[]) => void) { callbacks.set(event, callback); return this },
        end() {
          queueMicrotask(() => {
            callbacks.get('response')?.({ ':status': state.status } as never)
            callbacks.get('data')?.(Buffer.from(state.body))
            callbacks.get('end')?.()
          })
        },
      }
    }),
    close: state.close,
  }))
  return { state, connect }
})
vi.mock('node:http2', () => ({ connect: http2.connect }))

import {
  AUTH_CLIENT_ID, createUserApiKey, decodeJwtExp, exchangeApiKey, loginInteractive, refreshTokens,
  windowsBrowserStartCommand,
} from '../src/auth.ts'

/** A minimal unsigned JWT carrying only the claims these tests need. */
function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.`
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('decodeJwtExp', () => {
  it('reads the exp claim as epoch milliseconds', () => {
    expect(decodeJwtExp(jwt({ exp: 1_700_000_000, sub: 'user_1' }))).toBe(1_700_000_000_000)
  })

  it('rejects a value with fewer than three segments', () => {
    expect(() => decodeJwtExp('not-a-jwt')).toThrow(/not a JWT/)
  })

  it('rejects a payload that is not base64url JSON', () => {
    expect(() => decodeJwtExp('a.!!!not-json!!!.c')).toThrow(/base64url JSON/)
  })

  it('rejects a payload carrying no numeric exp', () => {
    expect(() => decodeJwtExp(jwt({ sub: 'user_1' }))).toThrow(/no numeric "exp"/)
    expect(() => decodeJwtExp(jwt({ exp: 'soon' }))).toThrow(/no numeric "exp"/)
  })
})

describe('windowsBrowserStartCommand', () => {
  it('quotes the URL so cmd start does not split on query &', () => {
    const url = 'https://cursor.com/loginDeepControl?challenge=abc&uuid=def&mode=login'
    expect(windowsBrowserStartCommand(url)).toBe(`start "" ${JSON.stringify(url)}`)
    expect(windowsBrowserStartCommand(url)).toContain('&uuid=def')
    expect(windowsBrowserStartCommand(url)).toContain('&mode=login')
  })
})

describe('loginInteractive', () => {
  it('builds the challenge/verifier pair, polls until tokens arrive, and hands the login URL back', async () => {
    let sawUrl: URL | undefined
    let attempts = 0
    const seenVerifiers: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input)
      seenVerifiers.push(url.searchParams.get('verifier')!)
      attempts++
      if (attempts < 2) return new Response(null, { status: 404 })
      return new Response(JSON.stringify({
        authId: 'user_1', accessToken: 'access.jwt.token', refreshToken: 'refresh-token', selectedTeamId: 42,
      }), { status: 200 })
    }))

    const tokens = await loginInteractive({
      openBrowser: false,
      pollIntervalMs: 1,
      onLoginURL: (url) => { sawUrl = new URL(url) },
    })

    expect(sawUrl?.origin).toBe('https://cursor.com')
    expect(sawUrl?.pathname).toBe('/loginDeepControl')
    expect(sawUrl?.searchParams.get('mode')).toBe('login')
    expect(sawUrl?.searchParams.has('challenge')).toBe(true)
    expect(sawUrl?.searchParams.has('uuid')).toBe(true)
    // The verifier travels only in the poll request, never in the browser URL.
    expect(sawUrl?.searchParams.has('verifier')).toBe(false)
    expect(attempts).toBe(2)
    expect(seenVerifiers[0]).toBe(seenVerifiers[1])
    expect(tokens).toEqual({
      accessToken: 'access.jwt.token', refreshToken: 'refresh-token', authId: 'user_1', selectedTeamId: 42,
    })
  })

  it('does not spawn a browser when openBrowser is false, yet still resolves', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      accessToken: 'a', refreshToken: 'r',
    }), { status: 200 })))

    await expect(loginInteractive({ openBrowser: false, pollIntervalMs: 1 })).resolves.toEqual({
      accessToken: 'a', refreshToken: 'r',
    })
  })

  it('rejects on a 403 sign_in_policy_violation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'sign_in_policy_violation' }), { status: 403 })))

    await expect(loginInteractive({ openBrowser: false, pollIntervalMs: 1 })).rejects.toThrow(/sign_in_policy_violation/)
  })

  it('stops polling once the caller aborts', async () => {
    const controller = new AbortController()
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init?: RequestInit) => {
      calls++
      if (calls === 1) controller.abort()
      if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return new Response(null, { status: 404 })
    }))

    await expect(loginInteractive({ openBrowser: false, pollIntervalMs: 1, signal: controller.signal }))
      .rejects.toThrow()
    expect(calls).toBeLessThan(5)
  })

  it('gives up after timeoutMs elapses with no completed session', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))

    await expect(loginInteractive({ openBrowser: false, pollIntervalMs: 1, timeoutMs: 5 }))
      .rejects.toThrow(/timed out/)
  })
})

describe('exchangeApiKey', () => {
  it('sends the api key as a bearer token and returns the granted tokens', async () => {
    let seenAuth: string | null = null
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seenAuth = new Headers(init.headers).get('authorization')
      return new Response(JSON.stringify({ accessToken: 'at', refreshToken: 'rt' }), { status: 200 })
    }))

    await expect(exchangeApiKey('crsr_secret')).resolves.toEqual({ accessToken: 'at', refreshToken: 'rt' })
    expect(seenAuth).toBe('Bearer crsr_secret')
  })

  it('rejects when the response carries no tokens', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))

    await expect(exchangeApiKey('crsr_secret')).rejects.toThrow(/no tokens/)
  })

  it('rejects on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await expect(exchangeApiKey('crsr_secret')).rejects.toThrow(/HTTP 500/)
  })
})

describe('createUserApiKey', () => {
  afterEach(() => { http2.state.status = 200; http2.state.body = JSON.stringify({ apiKey: 'crsr_test_key' }) })

  it('returns the crsr key from a successful HTTP/2 response', async () => {
    await expect(createUserApiKey('access-token', { backendURL: 'https://cursor.test' })).resolves.toBe('crsr_test_key')
  })

  it('maps a 401 response to LlmError AUTH', async () => {
    http2.state.status = 401
    await expect(createUserApiKey('bad-token', { backendURL: 'https://cursor.test' }))
      .rejects.toBeInstanceOf(LlmError)
    await expect(createUserApiKey('bad-token', { backendURL: 'https://cursor.test' }))
      .rejects.toMatchObject({ code: 'AUTH' })
  })
})

describe('refreshTokens', () => {
  it('sends the documented refresh grant body and client_id', async () => {
    let sentBody: unknown
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ access_token: 'new-access' }), { status: 200 })
    }))

    await refreshTokens('old-refresh')

    expect(sentBody).toEqual({ grant_type: 'refresh_token', client_id: AUTH_CLIENT_ID, refresh_token: 'old-refresh' })
  })

  it('keeps the original refresh token when the response supplies none of its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-access' }), { status: 200 })))

    await expect(refreshTokens('old-refresh')).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'old-refresh' })
  })

  it('adopts a fresh refresh token when the response supplies its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh' }), { status: 200 })))

    await expect(refreshTokens('old-refresh')).resolves.toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' })
  })

  it('rejects when the backend reports shouldLogout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ shouldLogout: true, error: 'sign_in_policy_violation' }), { status: 200 })))

    await expect(refreshTokens('old-refresh')).rejects.toThrow(/revoked.*sign_in_policy_violation/)
  })

  it('rejects on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))

    await expect(refreshTokens('old-refresh')).rejects.toThrow(/HTTP 500/)
  })
})
