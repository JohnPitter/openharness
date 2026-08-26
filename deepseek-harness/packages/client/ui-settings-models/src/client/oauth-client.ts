/**
 * Same-origin HTTP client for Settings → Models Sign in.
 * pi-ai routes (Claude Code, Codex) live under {@link OAUTH_HTTP_PREFIX};
 * Cursor lives under {@link CURSOR_OAUTH_HTTP_PREFIX}. Status merges both.
 * @module dsh-client-ui-settings-models/oauth-client
 */

/** Prefix the pi-ai host plugin registers on webServer. */
export const OAUTH_HTTP_PREFIX = '/dsh-llm-pi-ai/oauth'

/** Prefix the Cursor host plugin registers on webServer. */
export const CURSOR_OAUTH_HTTP_PREFIX = '/dsh-llm-cursor/oauth'

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

function prefixFor(provider: string): string {
  return provider === 'cursor' ? CURSOR_OAUTH_HTTP_PREFIX : OAUTH_HTTP_PREFIX
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

async function fetchOne(prefix: string): Promise<OauthStatusSnapshot | undefined> {
  try {
    const response = await fetch(`${prefix}/status`, { cache: 'no-store' })
    if (response.status === 404) return undefined
    return await parse(response)
  } catch {
    return undefined
  }
}

/** GET the OAuth status snapshot, or undefined when no host route answers. */
export async function fetchOauthStatus(): Promise<OauthStatusSnapshot | undefined> {
  const [piAi, cursor] = await Promise.all([
    fetchOne(OAUTH_HTTP_PREFIX),
    fetchOne(CURSOR_OAUTH_HTTP_PREFIX),
  ])
  if (piAi === undefined && cursor === undefined) return undefined
  return {
    authPath: piAi?.authPath ?? cursor?.authPath ?? OAUTH_HTTP_PREFIX,
    providers: [...(piAi?.providers ?? []), ...(cursor?.providers ?? [])],
  }
}

/** Start OAuth for one route. */
export async function startOauthLogin(
  provider: string,
  method?: string,
): Promise<OauthStatusSnapshot> {
  const response = await fetch(`${prefixFor(provider)}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, ...method === undefined ? {} : { method } }),
  })
  return parse(response)
}

/** Drop stored OAuth tokens for one route. */
export async function logoutOauth(provider: string): Promise<OauthStatusSnapshot> {
  const response = await fetch(`${prefixFor(provider)}/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  return parse(response)
}
