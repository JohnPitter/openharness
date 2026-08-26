/**
 * Native OAuth-like login for Cursor's `api2.cursor.sh` backend: the browser
 * polling flow the desktop client runs (PKCE-shaped challenge/verifier over
 * plain JSON, no protobuf), the headless API-key exchange, and the refresh
 * grant. Every request here targets the same two endpoints the official
 * client uses; nothing in this module is Cursor-adapter-specific, so
 * `index.ts` is the only caller that knows about credential storage.
 *
 * @module @deepseek-ai/dsh-llm-cursor/auth
 */

import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { exec, spawn } from 'node:child_process'
import { connect } from 'node:http2'
import { LlmError } from '@deepseek-ai/dsh-llm'

/** Production website origin serving `/loginDeepControl`. */
export const DEFAULT_WEBSITE_URL = 'https://cursor.com'

/** Production API origin serving `/auth/poll`, `/auth/exchange_user_api_key`, and `/oauth/token`. */
export const DEFAULT_BACKEND_URL = 'https://api2.cursor.sh'

/** OAuth `client_id` the production desktop client sends on `POST /oauth/token`; changes per environment, not per build. */
export const AUTH_CLIENT_ID = 'KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB'

/** Tokens returned by the browser poll, the api-key exchange, and normalized after a refresh. */
export interface CursorTokens {
  /** Bearer JWT sent as `Authorization: Bearer <accessToken>` on every authenticated request. */
  accessToken: string
  /** Opaque or JWT token exchanged for a new `accessToken` via `POST /oauth/token`. */
  refreshToken: string
  /** Present on a fresh interactive login; absent from a refresh response. */
  authId?: string
  /** Present when the account has a team selected at login time. */
  selectedTeamId?: number
}

/** Options shared by every request in this module. */
export interface CursorAuthTransport {
  /** API origin (no trailing slash required); defaults to {@link DEFAULT_BACKEND_URL}. */
  backendURL?: string
}

/** Options for {@link loginInteractive}. */
export interface LoginInteractiveOptions extends CursorAuthTransport {
  /** Website origin serving `/loginDeepControl`; defaults to {@link DEFAULT_WEBSITE_URL}. */
  websiteURL?: string
  /** Spawn the OS default browser at the login URL; defaults to `true`. */
  openBrowser?: boolean
  /** Called once the login URL is built, before polling starts — the caller's chance to render or log it. */
  onLoginURL?: (url: string) => void
  /** Aborts the poll loop; a pending `fetch` is cancelled and the promise rejects with `AbortError`. */
  signal?: AbortSignal
  /** Poll interval in milliseconds; defaults to `500`, matching the desktop client. */
  pollIntervalMs?: number
  /** Overall wait budget in milliseconds before giving up; defaults to five minutes. */
  timeoutMs?: number
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/**
 * Decode a JWT's `exp` claim without verifying its signature — this module
 * only ever reads a token this same backend just issued, so verification
 * would check nothing an attacker could not already forge by other means.
 * @param token - a JWT (`header.payload.signature`).
 * @returns the expiry as epoch milliseconds.
 * @throws Error when `token` is not a three-segment JWT or carries no numeric `exp`.
 */
export function decodeJwtExp(token: string): number {
  const segments = token.split('.')
  if (segments.length !== 3 || segments[1] === undefined || segments[1].length === 0) {
    throw new Error('decodeJwtExp: not a JWT (expected header.payload.signature)')
  }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch (error) {
    throw new Error('decodeJwtExp: JWT payload is not valid base64url JSON', { cause: error })
  }
  const exp = (payload as { exp?: unknown } | null)?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    throw new Error('decodeJwtExp: JWT payload carries no numeric "exp" claim')
  }
  return exp * 1000
}

/**
 * `cmd start` treats an unquoted `&` as a command separator, so a login URL
 * that only keeps `?challenge=` is what the browser actually opens. Quote the
 * whole URL the same way `llm-pi-ai` does.
 * @param url - the login URL, including query parameters.
 * @returns a `start "" "<url>"` command line.
 */
export function windowsBrowserStartCommand(url: string): string {
  return `start "" ${JSON.stringify(url)}`
}

/**
 * Spawn the OS default browser at `url`. Fire-and-forget: a headless host with
 * no display still lets the caller hand the URL to the human another way
 * (`onLoginURL`), so a spawn failure here is swallowed rather than thrown.
 * @param url - the URL to open.
 */
function openInBrowser(url: string): void {
  try {
    if (process.platform === 'win32') {
      exec(windowsBrowserStartCommand(url))
      return
    }
    const [command, args] = process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]]
    spawn(command, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // No display, no such binary, or a sandboxed host: the caller still has
    // the URL through `onLoginURL` and can present it another way.
  }
}

/** A poll attempt found no completed session yet (`404`); the caller should keep polling. */
class PendingLogin extends Error {}

/**
 * One `GET /auth/poll` attempt.
 * @param backendURL - the API origin.
 * @param uuid - the flow id from {@link loginInteractive}'s challenge.
 * @param verifier - the PKCE-shaped verifier from the same challenge.
 * @param signal - aborts the underlying `fetch`.
 * @returns the tokens once the human finishes in the browser.
 * @throws {PendingLogin} on `404` (not yet completed).
 * @throws Error on `403 sign_in_policy_violation` or any other non-OK status.
 */
async function pollOnce(backendURL: string, uuid: string, verifier: string, signal: AbortSignal): Promise<CursorTokens> {
  const response = await fetch(`${backendURL}/auth/poll?uuid=${uuid}&verifier=${verifier}`, {
    headers: { 'x-cursor-client-type': 'ide' },
    signal,
  })
  if (response.status === 404) throw new PendingLogin()
  if (response.status === 403) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined
    throw new Error(`Cursor login denied: ${body?.error ?? 'sign_in_policy_violation'}`)
  }
  if (!response.ok) throw new Error(`Cursor auth poll failed: HTTP ${response.status}`)
  const body = await response.json() as Partial<CursorTokens>
  if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') throw new PendingLogin()
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    ...body.authId === undefined ? {} : { authId: body.authId },
    ...body.selectedTeamId === undefined ? {} : { selectedTeamId: body.selectedTeamId },
  }
}

/**
 * Run Cursor's interactive browser login: generate a PKCE-shaped
 * verifier/challenge pair, open `{websiteURL}/loginDeepControl` with the
 * challenge, and poll `{backendURL}/auth/poll` with the verifier every
 * `pollIntervalMs` until the human finishes signing in or `timeoutMs` elapses.
 *
 * The verifier never travels in the browser URL — only its SHA-256 does —
 * which is what lets the backend confirm the poller is the same process that
 * opened the browser (see the RE report's PKCE-shaped analysis).
 * @param options - transport, browser, and timing overrides.
 * @returns the granted tokens.
 * @throws Error when the login is denied by policy, the poll fails, the signal aborts, or `timeoutMs` elapses first.
 */
export async function loginInteractive(options: LoginInteractiveOptions = {}): Promise<CursorTokens> {
  const backendURL = (options.backendURL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  const websiteURL = (options.websiteURL ?? DEFAULT_WEBSITE_URL).replace(/\/$/, '')
  const openBrowser = options.openBrowser ?? true
  const pollIntervalMs = options.pollIntervalMs ?? 500
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000

  const verifier = base64url(randomBytes(32))
  const challenge = base64url(new Uint8Array(createHash('sha256').update(verifier).digest()))
  const uuid = randomUUID()
  const loginUrl = `${websiteURL}/loginDeepControl?challenge=${challenge}&uuid=${uuid}&mode=login&supportsSelectedTeamLogin=true`

  options.onLoginURL?.(loginUrl)
  if (openBrowser) openInBrowser(loginUrl)

  const deadline = Date.now() + timeoutMs
  while (true) {
    if (options.signal?.aborted === true) {
      throw options.signal.reason instanceof Error ? options.signal.reason : new Error('Cursor login aborted')
    }
    if (Date.now() >= deadline) throw new Error(`Cursor login timed out after ${timeoutMs}ms`)
    try {
      return await pollOnce(backendURL, uuid, verifier, options.signal ?? new AbortController().signal)
    } catch (error) {
      if (!(error instanceof PendingLogin)) throw error
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error(`Cursor login timed out after ${timeoutMs}ms`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(pollIntervalMs, remaining))
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(options.signal?.reason instanceof Error ? options.signal.reason : new Error('Cursor login aborted'))
      }, { once: true })
    })
  }
}

/**
 * Exchange a dashboard API key (`crsr_...`) for session tokens, headlessly —
 * `POST /auth/exchange_user_api_key` with `Authorization: Bearer <apiKey>`.
 * @param apiKey - a Cursor dashboard API key, prefixed `crsr_`.
 * @param options - transport override.
 * @returns the granted tokens.
 * @throws Error when the exchange is rejected or the response carries no tokens.
 */
export async function exchangeApiKey(apiKey: string, options: CursorAuthTransport = {}): Promise<CursorTokens> {
  const backendURL = (options.backendURL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  const response = await fetch(`${backendURL}/auth/exchange_user_api_key`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'x-cursor-client-type': 'ide' },
    body: JSON.stringify({}),
  })
  if (response.status === 403) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined
    throw new Error(`Cursor API key exchange denied: ${body?.error ?? 'sign_in_policy_violation'}`)
  }
  if (!response.ok) throw new Error(`Cursor API key exchange failed: HTTP ${response.status}`)
  const body = await response.json() as Partial<CursorTokens>
  if (typeof body.accessToken !== 'string' || typeof body.refreshToken !== 'string') {
    throw new Error('Cursor API key exchange returned no tokens')
  }
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    ...body.authId === undefined ? {} : { authId: body.authId },
    ...body.selectedTeamId === undefined ? {} : { selectedTeamId: body.selectedTeamId },
  }
}

/**
 * Exchange a refresh token for a new access token — `POST /oauth/token` with
 * `grant_type: "refresh_token"`.
 *
 * The RE report documents that the desktop client's own bundle writes the
 * response's `access_token` into *both* its access and refresh storage slots
 * (`storeAccessRefreshToken(body.access_token, body.access_token)`) — flagged
 * there as possibly a minification bug rather than confirmed server
 * behavior. This function does not replicate that: it normalizes toward
 * standard OAuth2 semantics instead, keeping the original `refreshToken` when
 * the response carries none of its own, so a caller never loses a working
 * refresh token to an ambiguous client-side quirk.
 * @param refreshToken - the refresh token from a prior login or refresh.
 * @param options - transport override.
 * @returns the new access token, with `refreshToken` carried over unless the response supplies its own.
 * @throws Error when the backend reports `shouldLogout` or the request otherwise fails.
 */
/** Mint a `crsr_` SDK key through DashboardService over HTTP/2 using a JWT bearer. */
export async function createUserApiKey(accessToken: string, options: CursorAuthTransport = {}): Promise<string> {
  const backendURL = (options.backendURL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  const url = new URL(backendURL)
  const client = connect(url.origin)
  try {
    const body = Buffer.from('{}')
    const request = client.request({
      ':method': 'POST',
      ':path': '/aiserver.v1.DashboardService/CreateUserApiKey',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
      'connect-protocol-version': '1',
      'content-length': String(body.length),
    })
    const chunks: Buffer[] = []
    const response = await new Promise<{ status: number; body: Buffer }>((resolve, reject) => {
      request.on('response', (headers) => {
        request.on('data', (chunk: Uint8Array) => { chunks.push(Buffer.from(chunk)) })
        request.on('end', () => {
          resolve({ status: headers[':status'] ?? 0, body: Buffer.concat(chunks) })
        })
      })
      request.on('error', reject)
      request.end(body)
    })
    if (response.status !== 200) throw new Error(`Cursor SDK API key creation failed: HTTP ${response.status}`)
    const value = (JSON.parse(response.body.toString('utf8')) as { apiKey?: unknown }).apiKey
    if (typeof value !== 'string' || !value.startsWith('crsr_')) throw new Error('Cursor SDK API key creation returned no apiKey')
    return value
  } catch (error) {
    if (error instanceof LlmError) throw error
    throw new LlmError(
      error instanceof Error ? error.message : 'Cursor SDK API key creation failed', 'AUTH', { cause: error })
  } finally {
    client.close()
  }
}

export async function refreshTokens(refreshToken: string, options: CursorAuthTransport = {}): Promise<CursorTokens> {
  const backendURL = (options.backendURL ?? DEFAULT_BACKEND_URL).replace(/\/$/, '')
  const response = await fetch(`${backendURL}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cursor-client-type': 'ide' },
    body: JSON.stringify({ grant_type: 'refresh_token', client_id: AUTH_CLIENT_ID, refresh_token: refreshToken }),
  })
  if (!response.ok) throw new Error(`Cursor token refresh failed: HTTP ${response.status}`)
  const body = await response.json() as { access_token?: string; refresh_token?: string; shouldLogout?: boolean; error?: string }
  if (body.shouldLogout === true) throw new Error(`Cursor session revoked${body.error === undefined ? '' : `: ${body.error}`}`)
  if (typeof body.access_token !== 'string' || body.access_token.length === 0) {
    throw new Error('Cursor token refresh returned no access_token')
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : refreshToken,
  }
}
