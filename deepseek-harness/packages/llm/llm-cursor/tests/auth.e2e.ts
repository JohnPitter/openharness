import { describe, expect, it } from 'vitest'
import { decodeJwtExp, exchangeApiKey, refreshTokens } from '../src/auth.ts'

/**
 * Real-API coverage for the headless auth paths, gated on `CURSOR_API_KEY` (a
 * dashboard key, prefixed `crsr_`) exactly like `adapter.e2e.ts` gates on
 * `CURSOR_ACCESS_TOKEN`. `loginInteractive` has no e2e counterpart: it needs a
 * human in a browser, which is what `login-flow.spec.ts` and `auth.spec.ts`
 * already cover against a mocked backend.
 */
describe.skipIf(!process.env.CURSOR_API_KEY)('llm-cursor auth e2e (real API)', () => {
  it('exchanges a dashboard API key for a working access/refresh pair, and refreshes it', async () => {
    const apiKey = process.env.CURSOR_API_KEY!
    const granted = await exchangeApiKey(apiKey)

    expect(granted.accessToken.split('.')).toHaveLength(3)
    expect(granted.refreshToken.length).toBeGreaterThan(0)
    expect(decodeJwtExp(granted.accessToken)).toBeGreaterThan(Date.now())

    const refreshed = await refreshTokens(granted.refreshToken)

    expect(refreshed.accessToken.split('.')).toHaveLength(3)
    expect(decodeJwtExp(refreshed.accessToken)).toBeGreaterThan(Date.now())
    expect(refreshed.refreshToken.length).toBeGreaterThan(0)
  }, 30_000)
})
