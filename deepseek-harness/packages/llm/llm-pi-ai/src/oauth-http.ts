/**
 * Loopback HTTP API for Settings → Models OAuth buttons.
 * Mounted at {@link OAUTH_HTTP_PREFIX} when `webServer` is composed.
 * @module dsh-llm-pi-ai/oauth-http
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PiAiAdapter } from './adapter.ts'
import { clearLoginWatch, listLoginWatches, startOauthLogin } from './oauth-login.ts'
import { oauthAuthPath } from './oauth-path.ts'

/** Exact prefix registered on webServer. */
export const OAUTH_HTTP_PREFIX = '/dsh-llm-pi-ai/oauth'

/** One OAuth-capable route as the Settings page sees it. */
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

function methodsOf(provider: string): readonly string[] {
  return provider === 'openai-codex' ? ['browser', 'device_code'] : ['browser']
}

/** Build the status snapshot for every OAuth-capable registered route. */
export async function oauthStatus(adapter: PiAiAdapter): Promise<OauthStatusSnapshot> {
  const watches = new Map(listLoginWatches().map(watch => [watch.provider, watch]))
  const providers: OauthProviderStatus[] = []
  for (const id of adapter.oauthRouteIds()) {
    const auth = await adapter.checkAuth(id)
    const watch = watches.get(id)
    providers.push({
      id,
      name: adapter.providerInfo(id).name,
      loggedIn: auth !== undefined,
      ...auth === undefined ? {} : {
        authType: auth.type,
        ...auth.source === undefined ? {} : { authSource: auth.source },
      },
      ...watch === undefined ? {} : {
        loginStatus: watch.status,
        ...watch.detail === undefined ? {} : { loginDetail: watch.detail },
        ...watch.openUrl === undefined ? {} : { openUrl: watch.openUrl },
        ...watch.userCode === undefined ? {} : { userCode: watch.userCode },
      },
      methods: methodsOf(id),
    })
  }
  return { authPath: oauthAuthPath(), providers }
}

/**
 * Handle one request under {@link OAUTH_HTTP_PREFIX}.
 * @param onAuthChanged - fired after a completed login or a logout so the
 *   picker can drop or restore the route without a topology change.
 */
export async function handleOauthHttp(
  adapter: PiAiAdapter,
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
      sendJson(res, 200, await oauthStatus(adapter))
      return
    }

    if (method === 'POST' && path === `${OAUTH_HTTP_PREFIX}/logout`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      clearLoginWatch(provider)
      await adapter.logout(provider)
      onAuthChanged?.()
      sendJson(res, 200, await oauthStatus(adapter))
      return
    }

    if (method === 'POST' && path === `${OAUTH_HTTP_PREFIX}/login`) {
      const body = await readJson(req)
      const provider = providerOf(body, url)
      if (provider === undefined) {
        sendJson(res, 400, { error: 'missing provider' })
        return
      }
      const preferred = typeof body.method === 'string' ? body.method : undefined
      const result = await startOauthLogin(adapter, provider, preferred, onAuthChanged)
      const status = await oauthStatus(adapter)
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
