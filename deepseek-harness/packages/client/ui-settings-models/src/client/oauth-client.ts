/**
 * Same-origin HTTP client for llm-pi-ai OAuth login on Settings → Models.
 * @module dsh-client-ui-settings-models/oauth-client
 */

/** Prefix the host plugin registers on webServer. */
export const OAUTH_HTTP_PREFIX = '/dsh-llm-pi-ai/oauth'

/** One OAuth-capable route as the host reports it. */
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
  command?: { kind: 'success' | 'error'; text: string; openUrl?: string; userCode?: string }
}

async function parse(response: Response): Promise<OauthStatusSnapshot> {
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new Error('oauth: empty response')
  const snapshot = body as OauthStatusSnapshot
  if (!response.ok) {
    const error = (body as { error?: string }).error
    throw new Error(snapshot.command?.text ?? error ?? `oauth HTTP ${response.status}`)
  }
  return snapshot
}

/** GET the OAuth status snapshot, or undefined when the host has no route. */
export async function fetchOauthStatus(): Promise<OauthStatusSnapshot | undefined> {
  try {
    const response = await fetch(`${OAUTH_HTTP_PREFIX}/status`, { cache: 'no-store' })
    if (response.status === 404) return undefined
    return await parse(response)
  } catch {
    return undefined
  }
}

/** Start OAuth for one route. */
export async function startOauthLogin(
  provider: string,
  method?: string,
): Promise<OauthStatusSnapshot> {
  const response = await fetch(`${OAUTH_HTTP_PREFIX}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, ...method === undefined ? {} : { method } }),
  })
  return parse(response)
}

/** Drop stored OAuth tokens for one route. */
export async function logoutOauth(provider: string): Promise<OauthStatusSnapshot> {
  const response = await fetch(`${OAUTH_HTTP_PREFIX}/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  return parse(response)
}
