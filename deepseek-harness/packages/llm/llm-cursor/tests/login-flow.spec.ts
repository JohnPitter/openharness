import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationInteraction, AuthorizationNotice } from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

// This module's whole job is running one login attempt against the harness
// credential/authorization seams, so `loginInteractive` is the boundary worth
// mocking; a real attempt would open a browser and wait on a human.
const loginInteractive = vi.hoisted(() => vi.fn())
vi.mock('../src/auth.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/auth.ts')>(),
  loginInteractive,
}))

const { registerCursorLoginFlow, recordKeyFor } = await import('../src/login.ts')

const ACCESS_REF = credentialRef('CURSOR_ACCESS_TOKEN')
const REFRESH_REF = credentialRef('CURSOR_REFRESH_TOKEN')
const dirs: string[] = []

/** A context with a real credential store, the authorization seam, and the Cursor login flow. */
async function harness(): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cursor-login-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  registerCursorLoginFlow(ctx, {
    accessRef: () => ACCESS_REF,
    refreshRef: () => REFRESH_REF,
    backendURL: () => 'https://api2.cursor.sh',
    websiteURL: () => 'https://cursor.com',
  })
  return ctx
}

/** An interaction recording every notice, answering nothing (this flow never prompts). */
function surface(): AuthorizationInteraction & { notices: AuthorizationNotice[] } {
  const notices: AuthorizationNotice[] = []
  return {
    notices,
    notify: (notice) => { notices.push(notice) },
    prompt: () => Promise.reject(new Error('the Cursor browser flow never prompts')),
  }
}

afterEach(async () => {
  loginInteractive.mockReset()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('Cursor login authorization flow', () => {
  it('offers exactly the browser method', async () => {
    const ctx = await harness()

    expect(ctx.authorization.list()).toEqual([{
      key: recordKeyFor('cursor'),
      label: 'Cursor',
      methods: [{ id: 'browser', label: 'Sign in with browser' }],
      inFlight: false,
    }])
  })

  it('relays the login URL as a notice and commits both refs plus the grant record', async () => {
    const ctx = await harness()
    loginInteractive.mockImplementation(async (options: { onLoginURL?: (url: string) => void }) => {
      options.onLoginURL?.('https://cursor.com/loginDeepControl?challenge=x&uuid=y&mode=login')
      return { accessToken: 'granted-access', refreshToken: 'granted-refresh' }
    })
    const ui = surface()

    await expect(ctx.authorization.begin({ key: recordKeyFor('cursor'), interaction: ui }))
      .resolves.toEqual({ status: 'authorized' })

    expect(ui.notices).toEqual([{
      message: 'Open this page to sign in to Cursor.',
      url: 'https://cursor.com/loginDeepControl?challenge=x&uuid=y&mode=login',
    }])
    await expect(ctx.credentials.resolve(ACCESS_REF)).resolves.toMatchObject({ value: 'granted-access' })
    await expect(ctx.credentials.resolve(REFRESH_REF)).resolves.toMatchObject({ value: 'granted-refresh' })
    await expect(ctx.credentials.readRecord(recordKeyFor('cursor'))).resolves.toEqual({
      kind: 'grant',
      payload: { accessToken: 'granted-access', refreshToken: 'granted-refresh' },
    })
  })

  it('never opens a second local browser — the flow renders the URL itself', async () => {
    const ctx = await harness()
    let sawOpenBrowser: boolean | undefined
    loginInteractive.mockImplementation(async (options: { openBrowser?: boolean }) => {
      sawOpenBrowser = options.openBrowser
      return { accessToken: 'a', refreshToken: 'r' }
    })

    await ctx.authorization.begin({ key: recordKeyFor('cursor'), interaction: surface() })

    expect(sawOpenBrowser).toBe(false)
  })

  it('fails the attempt when the poll rejects, committing nothing', async () => {
    const ctx = await harness()
    loginInteractive.mockRejectedValue(new Error('Cursor login timed out after 5ms'))

    await expect(ctx.authorization.begin({ key: recordKeyFor('cursor'), interaction: surface() }))
      .rejects.toThrow(/timed out/)
    await expect(ctx.credentials.describeRecord(recordKeyFor('cursor'))).resolves.toMatchObject({ configured: false })
  })

  it('cancels the attempt when the caller withdraws mid-login', async () => {
    const ctx = await harness()
    let seenSignal: AbortSignal | undefined
    loginInteractive.mockImplementation((options: { signal?: AbortSignal }) => {
      seenSignal = options.signal
      return new Promise(() => {})
    })
    const controller = new AbortController()

    const attempt = ctx.authorization.begin({ key: recordKeyFor('cursor'), interaction: surface(), signal: controller.signal })
    controller.abort()

    await expect(attempt).resolves.toEqual({ status: 'cancelled' })
    expect(seenSignal?.aborted).toBe(true)
  })
})
