/**
 * The `ctx.authorization` flow for Cursor's interactive browser login. This is
 * the whole of the translation between {@link loginInteractive}'s plain
 * callback/poll shape and the harness's authorization-session vocabulary:
 * `run()` opens the login page through `session.notify()` and commits the
 * granted tokens through `ctx.credentials` before resolving, which is what
 * the authorization seam requires to report the attempt as `authorized`.
 *
 * @module @deepseek-ai/dsh-llm-cursor/login
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRef } from '@deepseek-ai/dsh-credentials'
import { loginInteractive } from './auth.ts'

/** The record scope this plugin's authorization flow is addressed under. */
export const RECORD_SCOPE = 'llm-cursor'

/**
 * The authorization-flow key for a Cursor route. There is exactly one route
 * today (`cursor`), but the key is still id-shaped rather than a constant so
 * a future multi-route configuration (two accounts under two apiKeyEnv pairs)
 * has somewhere to register a second flow without a naming collision.
 * @param routeId - the settings route id; `'cursor'` for the single route this plugin declares.
 * @returns the scoped authorization-flow / credential key.
 */
export function recordKeyFor(routeId: string): CredentialKey {
  return credentialKey(RECORD_SCOPE, routeId)
}

/** What {@link registerCursorLoginFlow} needs to run and commit a login. */
export interface CursorLoginInjection {
  /** The reference the access token is written to — the same one `resolveKey` reads. Live: settings may rename it between attempts. */
  accessRef: () => CredentialRef
  /** The reference the refresh token is written to. Live, on the same terms as {@link accessRef}. */
  refreshRef: () => CredentialRef
  /** Live API origin (settings may change it between attempts). */
  backendURL: () => string
  /** Live website origin (settings may change it between attempts). */
  websiteURL: () => string
}

/**
 * Register the Cursor interactive-login authorization flow.
 *
 * `run()` commits two things for two different readers. The authorization
 * seam requires a `CredentialRecord` write under `flow.key` — that is what it
 * observes to confirm the attempt actually produced a credential — so the
 * granted tokens are written there as a `grant` record. The adapter's
 * `resolveKey`, though, reads the reference-space `apiKeyEnv`/`refreshTokenEnv`
 * config already documents (the same refs a deployment can hand-populate from
 * `state.vscdb` without ever running this flow), so the same tokens are
 * mirrored there too. Both writes land before `run()` resolves, so a
 * concurrent request sees the fresh token from whichever store it reads.
 * @param ctx - the plugin context carrying `ctx.authorization` and `ctx.credentials`.
 * @param injection - the refs to mirror and the live transport origins.
 * @returns disposer that withdraws the flow.
 */
export function registerCursorLoginFlow(ctx: Context, injection: CursorLoginInjection): () => void {
  return ctx.authorization.registerFlow({
    key: recordKeyFor('cursor'),
    label: 'Cursor',
    methods: [{ id: 'browser', label: 'Sign in with browser' }],
    async run(session: AuthorizationSession) {
      const tokens = await loginInteractive({
        backendURL: injection.backendURL(),
        websiteURL: injection.websiteURL(),
        // The surface renders the URL itself (browser tab, terminal link); a
        // second local `spawn` would open two.
        openBrowser: false,
        onLoginURL: (url) => {
          session.notify({ message: 'Open this page to sign in to Cursor.', url })
        },
        signal: session.signal,
      })
      await ctx.credentials.modifyRecord(recordKeyFor('cursor'), () => Promise.resolve({
        kind: 'grant',
        payload: { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken },
      }))
      await ctx.credentials.set(injection.accessRef(), tokens.accessToken)
      await ctx.credentials.set(injection.refreshRef(), tokens.refreshToken)
    },
  })
}
