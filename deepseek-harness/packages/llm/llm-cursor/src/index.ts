import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { CursorAdapter, defaultMachineId, type GhostMode } from './adapter.ts'
import { CursorCloudAdapter } from './cloud-adapter.ts'
import { createUserApiKey, decodeJwtExp, refreshTokens, DEFAULT_BACKEND_URL, DEFAULT_WEBSITE_URL } from './auth.ts'
import { registerCursorLoginFlow } from './login.ts'
import { handleCursorOauthHttp, OAUTH_HTTP_PREFIX } from './oauth-http.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

export { CursorAdapter } from './adapter.ts'
export { CursorCloudAdapter } from './cloud-adapter.ts'
export { name as invariantName } from './invariant.ts'
export {
  createUserApiKey, decodeJwtExp, exchangeApiKey, loginInteractive, refreshTokens,
  AUTH_CLIENT_ID, DEFAULT_BACKEND_URL, DEFAULT_WEBSITE_URL,
} from './auth.ts'
export type { CursorAuthTransport, CursorTokens, LoginInteractiveOptions } from './auth.ts'
export { RECORD_SCOPE, recordKeyFor } from './login.ts'
export { OAUTH_HTTP_PREFIX } from './oauth-http.ts'

export interface Config {
  apiKeyEnv: string
  refreshTokenEnv: string
  defaultModel: string
  models: Record<string, string>
  baseURL: string
  websiteURL: string
  clientVersion: string
  timezone?: string
  machineId?: string
  macMachineId?: string
  ghostMode: GhostMode
  transportMode?: 'native' | 'sdk'
}
const DEFAULT_MODELS: Record<string, string> = {
  'composer-2.5': 'Composer 2.5',
}

export const Config = z.object({
  apiKeyEnv: z.string().default('CURSOR_ACCESS_TOKEN'),
  refreshTokenEnv: z.string().default('CURSOR_REFRESH_TOKEN'),
  defaultModel: z.string().default('composer-2.5'),
  models: z.dict(z.string()).default(DEFAULT_MODELS),
  baseURL: z.string().default(DEFAULT_BACKEND_URL),
  websiteURL: z.string().default(DEFAULT_WEBSITE_URL),
  clientVersion: z.string().default('3.17.19'),
  timezone: z.string(),
  machineId: z.string(),
  macMachineId: z.string(),
  ghostMode: z.union([z.const(true), z.const(false), z.const('implicit-false')]).default(false),
  transportMode: z.union([z.const('native'), z.const('sdk')]).default('native'),
})

export const name = 'llm-cursor'
export const inject = ['llm']
const NS = settingsNamespace('llm-cursor')

/**
 * Window before `exp` in which a still-valid access token is refreshed
 * proactively, so an in-flight request never races an expiry mid-stream.
 */
const REFRESH_SKEW_MS = 2 * 60 * 1000

/** Install the Cursor provider route, its credential-backed access token, auto-refresh, and its optional interactive-login flow. */
export function apply(ctx: Context, config: Config): void {
  const accessRef = () => credentialRef(config.apiKeyEnv)
  const refreshRef = () => credentialRef(config.refreshTokenEnv)
  const sdkKeyRef = () => credentialRef('CURSOR_SDK_KEY')
  const transportMode = config.transportMode ?? (config.apiKeyEnv === 'CURSOR_ACCESS_TOKEN' ? 'native' : 'sdk')

  const readRef = async (ref: ReturnType<typeof credentialRef>): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    return value === undefined || value.length === 0 ? undefined : value
  }
  const readAccessToken = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(accessRef()))?.value
      : launchEnvironmentOf(ctx).get(accessRef())?.value
    return value === undefined || value.length === 0 ? undefined : value
  }
  const readRefreshToken = async (): Promise<string | undefined> => {
    const credentials = ctx.get('credentials')
    const value = credentials !== undefined
      ? (await credentials.resolve(refreshRef()))?.value
      : launchEnvironmentOf(ctx).get(refreshRef())?.value
    return value === undefined || value.length === 0 ? undefined : value
  }

  // A single in-flight refresh promise shared by every concurrent caller: a
  // stream and a listModels call racing the same expired token must not each
  // spend the refresh token against the backend, which a strict OAuth2 server
  // would reject on the loser's turn.
  let refreshing: Promise<string> | undefined
  const refreshNow = async (refreshToken: string): Promise<string> => {
    refreshing ??= (async () => {
      try {
        const tokens = await refreshTokens(refreshToken, { backendURL: config.baseURL })
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) {
          await credentials.set(accessRef(), tokens.accessToken)
          if (tokens.refreshToken !== refreshToken) await credentials.set(refreshRef(), tokens.refreshToken)
        }
        return tokens.accessToken
      } catch (error) {
        throw new LlmError(
          error instanceof Error ? error.message : 'Cursor token refresh failed', 'AUTH', { cause: error })
      } finally {
        refreshing = undefined
      }
    })()
    return refreshing
  }

  const resolveKey = async (): Promise<string> => {
    if (transportMode === 'sdk') {
      const cached = await readRef(sdkKeyRef())
      if (cached?.startsWith('crsr_')) return cached
      const configured = await readAccessToken() ?? await readRef(credentialRef('CURSOR_ACCESS_TOKEN'))
      if (configured === undefined) throw new LlmError('missing provider credential', 'MISSING_CREDENTIAL')
      if (configured.startsWith('crsr_')) return configured
      try {
        const key = await createUserApiKey(configured, { backendURL: config.baseURL })
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) await credentials.set(sdkKeyRef(), key)
        return key
      } catch (error) {
        throw new LlmError(error instanceof Error ? error.message : 'Cursor SDK API key creation failed', 'AUTH', { cause: error })
      }
    }
    const current = await readAccessToken()
    if (current === undefined) throw new LlmError('missing provider credential', 'MISSING_CREDENTIAL')
    let expiresAt: number | undefined
    try {
      expiresAt = decodeJwtExp(current)
    } catch {
      // Not a JWT this module can read the expiry of (a hand-set non-JWT
      // value, for instance): use it as-is and let the provider itself reject
      // it if it is not usable, rather than blocking every request on a
      // refresh that may not even apply.
      return current
    }
    if (expiresAt - Date.now() > REFRESH_SKEW_MS) return current
    const refreshToken = await readRefreshToken()
    if (refreshToken === undefined) return current
    return refreshNow(refreshToken)
  }

  const timezone = config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const adapter = transportMode === 'sdk'
    ? new CursorCloudAdapter(resolveKey, () => config.models)
    : new CursorAdapter(resolveKey, () => config.models, {
      baseURL: config.baseURL,
      clientVersion: config.clientVersion,
      timezone,
      machineId: config.machineId ?? defaultMachineId(),
      ghostMode: config.ghostMode,
      ...(config.macMachineId === undefined ? {} : { macMachineId: config.macMachineId }),
    })
  ctx.effect(function* () {
    yield () => { adapter.dispose() }
  }, 'llm-cursor.transport')
  ctx.llm.registerAdapter(['cursor'], adapter)
  ctx.llm.registerConfigurableProviders([{
    provider: 'cursor', displayName: 'Cursor', settingsNs: NS, settingsPath: [],
  }])
  ctx.llm.registerModelDiscovery(NS, async (request) => {
    const models = await adapter.listModels(request.provider ?? 'cursor')
    return models.map(model => ({ id: model.id, name: model.name }))
  })
  installSettingsSection(ctx, NS, Config, config, {
    setSource: () => {},
    onChange: () => {},
  })

  // Optional: only a composition that mounts `ctx.authorization` gets a login
  // surface offered at all — a headless deployment with a hand-provisioned
  // token still runs the provider route without one.
  ctx.inject(['authorization'], (actx) => {
    registerCursorLoginFlow(actx, {
      accessRef, refreshRef, backendURL: () => config.baseURL, websiteURL: () => config.websiteURL,
    })
  })

  ctx.inject(['webServer'], (httpCtx) => {
    const webServer = httpCtx.get('webServer') as {
      register: (route: {
        kind: 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void
      }) => () => void
    }
    const store = {
      readAccess: readAccessToken,
      persist: async (tokens: { accessToken: string, refreshToken: string }) => {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return
        await credentials.set(accessRef(), tokens.accessToken)
        await credentials.set(refreshRef(), tokens.refreshToken)
      },
      clear: async () => {
        const credentials = ctx.get('credentials')
        if (credentials === undefined) return
        await credentials.unset(accessRef())
        await credentials.unset(refreshRef())
        await credentials.unset(sdkKeyRef())
      },
      backendURL: () => config.baseURL,
      websiteURL: () => config.websiteURL,
    }
    httpCtx.effect(
      () => webServer.register({
        kind: 'prefix',
        path: OAUTH_HTTP_PREFIX,
        handler: (req, res) => {
          void handleCursorOauthHttp(store, req, res, () => {
            ctx.emit('llm/adapters-updated')
          })
        },
      }),
      'llm-cursor: oauth http',
    )
  })
}
