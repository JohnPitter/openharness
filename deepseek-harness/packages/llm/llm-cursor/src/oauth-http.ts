/**
 * Loopback HTTP API for Settings → Models Cursor Sign in.
 * Mounted at {@link OAUTH_HTTP_PREFIX} when `webServer` is composed.
 * @module dsh-llm-cursor/oauth-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CursorTokens } from './auth.ts'
import {
  clearCursorLoginWatch,
  cursorLoginWatch,
  startCursorLogin,
} from './oauth-login.ts'

/** One OAuth-capable route as the Settings page sees it. Same fields as llm-pi-ai. */
export interface OauthProviderStatus {
  id: string
  name: string
  loggedIn: boolean
  authType?: 'api_key' | 'oauth'
  authSource?: string
  loginStatus?: 'waiting' | 'ok' | 'error'
  loginDetail?: string
  openUrl?: string
  userCode?: string
  methods: readonly string[]
}

/** Full status payload. */
export interface OauthStatusSnapshot {
  authPath: string
  providers: OauthProviderStatus[]
}

/** Exact prefix registered on webServer. */
export const OAUTH_HTTP_PREFIX = '/dsh-llm-cursor/oauth'

/** Credential reads and writes the HTTP handler needs. */
export interface CursorOauthStore {
  /** Current access token, if any. */
  readAccess: () => Promise<string | undefined>
  /** Persist a completed login. */
  persist: (tokens: CursorTokens) => Promise<void>
  /** Drop access, refresh, and minted SDK keys. */
  clear: () => Promise<void>
  /** Live API origin. */
  backendURL: () => string
  /** Live website origin. */
  websiteURL: () => string
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    const total = chunks.reduce((sum, part) => sum + part.length, 0)
    if (total > 64_000) throw new Error('request body too large')
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (raw.length === 0) return {}
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('JSON body must be an object')
  }
  return parsed as Record<string, unknown>
}

function providerOf(body: Record<string, unknown>, url: URL): string | undefined {
  const fromQuery = url.searchParams.get('provider')
  if (fromQuery !== null && fromQuery.length > 0) return fromQuery
  const value = body.provider
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Build the status snapshot the Settings OAuth client already understands. */
export async function cursorOauthStatus(store: CursorOauthStore): Promise<OauthStatusSnapshot> {
  const access = await store.readAccess()
  const current = cursorLoginWatch()
  const provider: OauthProviderStatus = {
    id: 'cursor',
    name: 'Cursor',
    loggedIn: access !== undefined,
    ...access === undefined ? {} : { authType: 'oauth' as const, authSource: 'Cursor' },
    ...current === undefined ? {} : {
      loginStatus: current.status,
      ...current.detail === undefined ? {} : { loginDetail: current.detail },
      ...current.openUrl === undefined ? {} : { openUrl: current.openUrl },
    },
    methods: ['browser'],
  }
  return { authPath: OAUTH_HTTP_PREFIX, providers: [provider] }
}

/**
 * Handle one request under {@link OAUTH_HTTP_PREFIX}.
 * @param store - credential persistence the adapter also reads.
 * @param req - incoming request.
 * @param res - response to write.
 * @param onAuthChanged - fired after a completed login or a logout.
 */
export async function handleCursorOauthHttp(
  store: CursorOauthStore,
  req: IncomingMessage,
  res: ServerResponse,
  onAuthChanged?: () => void,
): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase()
  const host = req.headers.host ?? '127.0.0.1'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'

  try {
    if (method === 'GET' && (path === OAUTH_HTTP_PREFIX || path === `${OAUTH_HTTP_PREFIX}/status`)) {
      sendJson(res, 200, await cursorOauthStatus(store))
      return
    }

    if (method === 'POST' && path === `${OAUTH_HTTP_PREFIX}/logout`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider !== undefined && provider !== 'cursor') {
        sendJson(res, 400, { error: 'unknown provider' })
        return
      }
      clearCursorLoginWatch()
      await store.clear()
      onAuthChanged?.()
      sendJson(res, 200, await cursorOauthStatus(store))
      return
    }

    if (method === 'POST' && path === `${OAUTH_HTTP_PREFIX}/login`) {
      const body = await readJson(req)
      const provider = providerOf(body, url) ?? 'cursor'
      if (provider !== 'cursor') {
        sendJson(res, 400, { error: 'unknown provider' })
        return
      }
      const result = await startCursorLogin(async (tokens) => {
        await store.persist(tokens)
        onAuthChanged?.()
      }, { backendURL: store.backendURL(), websiteURL: store.websiteURL() })
      const status = await cursorOauthStatus(store)
      sendJson(res, result.kind === 'error' ? 400 : 200, { ...status, command: result })
      return
    }

    sendJson(res, 404, { error: `unknown route ${path}` })
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
