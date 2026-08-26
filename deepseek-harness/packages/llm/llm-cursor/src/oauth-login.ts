/**
 * Background Cursor browser-login for Settings → Models. The HTTP handler
 * returns as soon as the login URL exists; polling continues until tokens
 * land, the user logs out, or the attempt is replaced.
 * @module dsh-llm-cursor/oauth-login
 */

import { loginInteractive } from './auth.ts'
import type { CursorTokens } from './auth.ts'

/** In-flight or last-finished Cursor login as the Settings page sees it. */
export interface CursorLoginWatch {
  status: 'waiting' | 'ok' | 'error'
  detail?: string
  openUrl?: string
}

/** Result the HTTP layer returns without waiting for the poll to finish. */
export interface CursorOauthLoginResult {
  readonly kind: 'success' | 'error'
  readonly text: string
  readonly openUrl?: string
}

const PROVIDER = 'cursor'

let watch: CursorLoginWatch | undefined
let inFlight: AbortController | undefined

/** Snapshot of the current Cursor login watch, when one exists. */
export function cursorLoginWatch(): CursorLoginWatch | undefined {
  return watch
}

/** Drop the login watch (tests). */
export function resetCursorLoginWatch(): void {
  inFlight?.abort()
  inFlight = undefined
  watch = undefined
}

/**
 * Persist granted tokens into the credential store the adapter reads.
 * @param tokens - access and refresh tokens from {@link loginInteractive}.
 */
export type PersistCursorTokens = (tokens: CursorTokens) => Promise<void>

/**
 * Start a Cursor browser login and return once the URL is ready to open.
 * A second call while waiting cancels the previous poll.
 * @param persist - writes tokens when the poll succeeds.
 * @param origins - live API and website origins from settings.
 * @returns the URL the Settings page should show; polling continues in the background.
 */
export async function startCursorLogin(
  persist: PersistCursorTokens,
  origins: { backendURL: string, websiteURL: string },
): Promise<CursorOauthLoginResult> {
  inFlight?.abort()
  const controller = new AbortController()
  inFlight = controller
  watch = { status: 'waiting' }

  let published: ((url: string) => void) | undefined
  const firstUrl = new Promise<string>((resolve) => {
    published = resolve
  })

  void loginInteractive({
    backendURL: origins.backendURL,
    websiteURL: origins.websiteURL,
    openBrowser: true,
    signal: controller.signal,
    onLoginURL: (url) => {
      if (watch !== undefined) watch.openUrl = url
      published?.(url)
    },
  }).then(async (tokens) => {
    if (controller.signal.aborted) return
    await persist(tokens)
    if (controller.signal.aborted) return
    watch = { status: 'ok' }
  }).catch((error: unknown) => {
    if (controller.signal.aborted) return
    watch = {
      status: 'error',
      detail: error instanceof Error ? error.message : String(error),
      ...watch?.openUrl === undefined ? {} : { openUrl: watch.openUrl },
    }
  })

  const openUrl = await firstUrl
  return {
    kind: 'success',
    text: `Finish signing in to ${PROVIDER} in the browser.`,
    openUrl,
  }
}

/** Mark the watch idle after a logout so the card does not keep a stale URL. */
export function clearCursorLoginWatch(): void {
  inFlight?.abort()
  inFlight = undefined
  watch = undefined
}
