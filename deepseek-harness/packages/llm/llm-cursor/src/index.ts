import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { isVolatile } from '@deepseek-ai/cosmokit'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import {
  CursorAgentAdapter, DEFAULT_CLIENT_COMMIT, DEFAULT_CLIENT_VERSION,
} from './agent-adapter.ts'
import {
  defaultMachineId, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS,
  DEFAULT_MODELS, type CursorCatalogModel, type GhostMode,
} from './adapter.ts'
import { CursorCloudAdapter } from './cloud-adapter.ts'
import { createUserApiKey, decodeJwtExp, refreshTokens, DEFAULT_BACKEND_URL, DEFAULT_WEBSITE_URL } from './auth.ts'
import { registerCursorLoginFlow } from './login.ts'
import { handleCursorOauthHttp, OAUTH_HTTP_PREFIX } from './oauth-http.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

export {
  CursorAgentAdapter, DEFAULT_CLIENT_COMMIT, DEFAULT_CLIENT_VERSION,
  type CursorAgentTransportConfig,
} from './agent-adapter.ts'
export {
  CATALOG_LISTING_TIMEOUT_MS, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, DEFAULT_MODELS,
} from './adapter.ts'
export type { CursorCatalogModel, GhostMode } from './adapter.ts'
export { CursorCloudAdapter } from './cloud-adapter.ts'
export {
  createUserApiKey, decodeJwtExp, exchangeApiKey, loginInteractive, refreshTokens,
  AUTH_CLIENT_ID, DEFAULT_BACKEND_URL, DEFAULT_WEBSITE_URL,
} from './auth.ts'
export type { CursorAuthTransport, CursorTokens, LoginInteractiveOptions } from './auth.ts'
export { RECORD_SCOPE, recordKeyFor } from './login.ts'
export { OAUTH_HTTP_PREFIX } from './oauth-http.ts'

/** Plain plugin options; the `llm-cursor` settings section has the same shape. */
export interface Options {
  apiKeyEnv: string
  refreshTokenEnv: string
  defaultModel: string
  models: CursorCatalogModel[]
  defaultContextWindow: number
  maxTokens: number
  baseURL: string
  websiteURL: string
  clientVersion: string
  clientCommit: string
  timezone?: string
  machineId?: string
  macMachineId?: string
  ghostMode: GhostMode
  transportMode?: 'native' | 'sdk'
}

/** Live plugin configuration: volatile references the loader updates in place on a settings change. */
export type Config = { [K in keyof Options]-?: Volatile<Options[K]> }

/**
 * Read the current value behind every reference of a validated Config.
 * @param config - parsed plugin Config.
 * @returns plain options.
 */
export function plainOptions(config: Config): Options {
  return Object.fromEntries(Object.entries(config).map(([key, value]) => [key, isVolatile(value) ? value.get() : value])) as unknown as Options
}

const catalogModel: z<CursorCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
})

export const Config = z.object({
  apiKeyEnv: z.string().default('CURSOR_ACCESS_TOKEN').volatile(),
  refreshTokenEnv: z.string().default('CURSOR_REFRESH_TOKEN').volatile(),
  defaultModel: z.string().default('composer-2.5').volatile(),
  models: z.array(catalogModel).default(DEFAULT_MODELS).volatile(),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW).volatile(),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS).volatile(),
  baseURL: z.string().default(DEFAULT_BACKEND_URL).volatile(),
  websiteURL: z.string().default(DEFAULT_WEBSITE_URL).volatile(),
  clientVersion: z.string().default(DEFAULT_CLIENT_VERSION).volatile(),
  clientCommit: z.string().default(DEFAULT_CLIENT_COMMIT).volatile(),
  timezone: z.string().volatile(),
  machineId: z.string().volatile(),
  macMachineId: z.string().volatile(),
  ghostMode: z.union([z.const(true), z.const(false), z.const('implicit-false')]).default(false).volatile(),
  transportMode: z.union([z.const('native'), z.const('sdk')]).default('native').volatile(),
})

export const name = 'llm-cursor'
export const inject = ['llm']
const NS = 'llm-cursor'

/**
 * Window before `exp` in which a still-valid access token is refreshed
 * proactively, so an in-flight request never races an expiry mid-stream.
 */
const REFRESH_SKEW_MS = 2 * 60 * 1000

/** Install the Cursor provider route, its credential-backed access token, auto-refresh, and its optional interactive-login flow. */
export function apply(ctx: Context, live: Config): void {
  // The Models page owns this section's form, so the generic editor stays off.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  const current = (): Options => plainOptions(live)
  const accessRef = () => credentialRef(current().apiKeyEnv)
  const refreshRef = () => credentialRef(current().refreshTokenEnv)
  const sdkKeyRef = () => credentialRef('CURSOR_SDK_KEY')
  const transportMode = current().transportMode ?? (current().apiKeyEnv === 'CURSOR_ACCESS_TOKEN' ? 'native' : 'sdk')

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
        const tokens = await refreshTokens(refreshToken, { backendURL: current().baseURL })
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
        const key = await createUserApiKey(configured, { backendURL: current().baseURL })
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) await credentials.set(sdkKeyRef(), key)
        return key
      } catch (error) {
        throw new LlmError(error instanceof Error ? error.message : 'Cursor SDK API key creation failed', 'AUTH', { cause: error })
      }
    }
    const token = await readAccessToken()
    if (token === undefined) throw new LlmError('missing provider credential', 'MISSING_CREDENTIAL')
    let expiresAt: number | undefined
    try {
      expiresAt = decodeJwtExp(token)
    } catch {
      // Not a JWT this module can read the expiry of (a hand-set non-JWT
      // value, for instance): use it as-is and let the provider itself reject
      // it if it is not usable, rather than blocking every request on a
      // refresh that may not even apply.
      return token
    }
    if (expiresAt - Date.now() > REFRESH_SKEW_MS) return token
    const refreshToken = await readRefreshToken()
    if (refreshToken === undefined) return token
    return refreshNow(refreshToken)
  }

  const timezone = current().timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  // Live getters: Apply can raise clientVersion without tearing down the HTTP/2 session.
  const adapter = transportMode === 'sdk'
    ? new CursorCloudAdapter(resolveKey, () => current().models ?? DEFAULT_MODELS)
    : new CursorAgentAdapter(resolveKey, () => current().models ?? DEFAULT_MODELS, {
      get baseURL() { return current().baseURL },
      get clientVersion() { return current().clientVersion },
      get clientCommit() { return current().clientCommit },
      get timezone() { return current().timezone ?? timezone },
      get machineId() { return current().machineId ?? defaultMachineId() },
      get ghostMode() { return current().ghostMode },
      ...(current().macMachineId === undefined ? {} : { macMachineId: current().macMachineId }),
    })
  ctx.effect(function* () {
    yield () => { adapter.dispose() }
  }, 'llm-cursor.transport')
  ctx.llm.registerAdapter(['cursor'], adapter)
  ctx.llm.registerConfigurableProviders([{
    provider: 'cursor', displayName: 'Cursor', settingsNs, settingsPath: [],
  }])
  ctx.llm.registerModelDiscovery(settingsNs, async (request) => {
    const configured = current().models ?? DEFAULT_MODELS
    const catalog = new Map(configured.map(row => [row.id, row]))
    // Without a token the picker hides the route, but the Models page still
    // edits the configured catalog.
    const listed = await adapter.listModels(request.provider ?? 'cursor')
    const models = listed.length > 0
      ? listed
      : configured.map(row => ({ provider: 'cursor', id: row.id, name: row.name ?? row.id }))
    return models.map(model => {
      const row = catalog.get(model.id)
      return {
        id: model.id,
        name: model.name,
        ...row?.contextWindow === undefined ? {} : { contextWindow: row.contextWindow },
        ...row?.maxTokens === undefined ? {} : { maxTokens: row.maxTokens },
      }
    })
  })
  // Optional: only a composition that mounts `ctx.authorization` gets a login
  // surface offered at all — a headless deployment with a hand-provisioned
  // token still runs the provider route without one.
  ctx.inject(['authorization'], (actx) => {
    registerCursorLoginFlow(actx, {
      accessRef, refreshRef, backendURL: () => current().baseURL, websiteURL: () => current().websiteURL,
    })
  })

  // The loopback Settings → Models sign-in surface. Mounted only beside the
  // browser connection, whose Host/Origin fence and peer authentication every
  // request must pass: these routes start logins and clear stored tokens.
  ctx.inject(['webServer', 'connection'], (httpCtx) => {
    const webServer = httpCtx.get('webServer') as {
      register: (route: {
        kind: 'prefix'
        path: string
        handler: (req: IncomingMessage, res: ServerResponse) => void
      }) => () => void
    }
    const connection = httpCtx.get('connection') as {
      requestRejection(request: { readonly headers: IncomingMessage['headers'] }): 401 | 403 | undefined
    }
    const rejected = (req: IncomingMessage, res: ServerResponse): boolean => {
      const rejection = connection.requestRejection(req)
      if (rejection === undefined) return false
      res.statusCode = rejection
      res.end()
      return true
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
      backendURL: () => current().baseURL,
      websiteURL: () => current().websiteURL,
    }
    httpCtx.effect(
      () => webServer.register({
        kind: 'prefix',
        path: OAUTH_HTTP_PREFIX,
        handler: (req, res) => {
          if (rejected(req, res)) return
          void handleCursorOauthHttp(store, req, res, () => {
            ctx.emit('llm/adapters-updated')
          })
        },
      }),
      'llm-cursor: oauth http',
    )
  })
}
