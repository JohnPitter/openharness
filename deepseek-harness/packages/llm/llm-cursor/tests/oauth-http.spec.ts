import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleCursorOauthHttp, OAUTH_HTTP_PREFIX } from '../src/oauth-http.ts'
import { resetCursorLoginWatch } from '../src/oauth-login.ts'
import type { CursorOauthStore } from '../src/oauth-http.ts'
import type { CursorTokens } from '../src/auth.ts'

const loginInteractive = vi.hoisted(() => vi.fn())

vi.mock('../src/auth.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/auth.ts')>()),
  loginInteractive,
}))

afterEach(() => {
  resetCursorLoginWatch()
  loginInteractive.mockReset()
})

function request(method: string, url: string, body?: Record<string, unknown>): IncomingMessage {
  const stream = Readable.from([body === undefined ? '' : JSON.stringify(body)]) as IncomingMessage
  stream.method = method
  stream.url = url
  stream.headers = { host: '127.0.0.1' }
  return stream
}

function response(): ServerResponse & { statusCodeWritten: number, body: string } {
  const state = { statusCodeWritten: 0, body: '' }
  return {
    writeHead(status: number) {
      state.statusCodeWritten = status
      return this
    },
    end(chunk?: string) {
      state.body = chunk ?? ''
    },
    get statusCodeWritten() { return state.statusCodeWritten },
    get body() { return state.body },
  } as unknown as ServerResponse & { statusCodeWritten: number, body: string }
}

function store(access?: string): CursorOauthStore & { tokens?: CursorTokens | undefined; cleared: boolean } {
  const state: { access: string | undefined, tokens?: CursorTokens, cleared: boolean } = {
    access,
    cleared: false,
  }
  return {
    readAccess: async () => state.access,
    persist: async (tokens) => {
      state.tokens = tokens
      state.access = tokens.accessToken
    },
    clear: async () => {
      state.cleared = true
      state.access = undefined
    },
    backendURL: () => 'https://api2.cursor.sh',
    websiteURL: () => 'https://cursor.com',
    get tokens() { return state.tokens },
    get cleared() { return state.cleared },
  }
}

describe('llm-cursor oauth http', () => {
  it('reports signed-out status and the Cursor route', async () => {
    const res = response()
    await handleCursorOauthHttp(store(), request('GET', `${OAUTH_HTTP_PREFIX}/status`), res)
    expect(res.statusCodeWritten).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      authPath: OAUTH_HTTP_PREFIX,
      providers: [{ id: 'cursor', name: 'Cursor', loggedIn: false, methods: ['browser'] }],
    })
  })

  it('starts a browser login and returns the URL without waiting for the poll', async () => {
    loginInteractive.mockImplementation(async (options: { onLoginURL?: (url: string) => void }) => {
      options.onLoginURL?.('https://cursor.com/loginDeepControl?challenge=x')
      return new Promise<CursorTokens>(() => { /* still polling */ })
    })
    const res = response()
    await handleCursorOauthHttp(
      store(),
      request('POST', `${OAUTH_HTTP_PREFIX}/login`, { provider: 'cursor' }),
      res,
    )
    expect(res.statusCodeWritten).toBe(200)
    const body = JSON.parse(res.body) as {
      providers: Array<{ loginStatus?: string, openUrl?: string }>
      command: { openUrl: string }
    }
    expect(body.command.openUrl).toContain('loginDeepControl')
    expect(body.providers[0]?.loginStatus).toBe('waiting')
    expect(body.providers[0]?.openUrl).toContain('loginDeepControl')
  })

  it('clears stored tokens on logout', async () => {
    const oauth = store('jwt')
    const res = response()
    await handleCursorOauthHttp(
      oauth,
      request('POST', `${OAUTH_HTTP_PREFIX}/logout`, { provider: 'cursor' }),
      res,
    )
    expect(oauth.cleared).toBe(true)
    expect(JSON.parse(res.body).providers[0].loggedIn).toBe(false)
  })
})
