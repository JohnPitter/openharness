/**
 * Non-interactive OAuth login for the desktop Settings page.
 *
 * pi-ai's Anthropic and Codex flows notify an authorization URL (and Codex
 * may also emit a device code), then race a localhost callback against a
 * `manual_code` prompt. The Web UI has no stdin, so this interaction:
 * - auto-picks the login method (browser on this desktop app; device code
 *   when the caller asks);
 * - opens the URL in the system browser;
 * - hangs on `manual_code` until the callback aborts it, so the local
 *   listener can finish the exchange.
 *
 * The HTTP handler returns as soon as a URL or device code exists; the
 * token poll continues in the background.
 * @module dsh-llm-pi-ai/oauth-login
 */

import { exec, execFile } from 'node:child_process'
import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai'
import type { PiAiAdapter } from './adapter.ts'

/** In-flight or last-finished login, keyed by provider id. */
export interface LoginWatch {
  readonly provider: string
  status: 'waiting' | 'ok' | 'error'
  detail?: string
  openUrl?: string
  userCode?: string
  method?: string
  readonly lines: string[]
}

/** Result the HTTP/command layer returns without waiting for token exchange. */
export interface OauthLoginResult {
  readonly kind: 'success' | 'error'
  readonly text: string
  readonly openUrl?: string
  readonly userCode?: string
}

const watches = new Map<string, LoginWatch>()

/** Snapshot of background login watches. */
export function listLoginWatches(): readonly LoginWatch[] {
  return [...watches.values()]
}

/** Drop every background login watch (tests). */
export function resetLoginWatches(): void {
  watches.clear()
}

/**
 * Pick a select-prompt option without a terminal.
 * Desktop OpenHarness prefers Codex browser login (`localhost:1455`); pass
 * `device_code` when the caller asked for the headless flow.
 */
export function pickSelectOption(
  provider: string,
  options: readonly { id: string, label: string, description?: string }[],
  preferred?: string,
): { id: string, label: string } {
  const byId = (id: string) => options.find(option => option.id === id)
  if (preferred !== undefined) {
    const named = byId(preferred)
    if (named !== undefined) return named
  }
  if (provider === 'openai-codex') {
    const browser = byId('browser')
    if (browser !== undefined) return browser
  }
  const headless = options.find(option =>
    /device[_-]?code|headless|cli/i.test(`${option.id} ${option.label} ${option.description ?? ''}`))
  if (headless !== undefined && byId('browser') === undefined) return headless
  return options[0]!
}

/** Open a URL with the platform handler; failures stay diagnostic, not fatal. */
export function openSystemUrl(url: string): void {
  try {
    if (process.platform === 'win32') {
      exec(`start "" ${JSON.stringify(url)}`)
      return
    }
    execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
  } catch {
    // The Settings page still shows the URL; the user can open it by hand.
  }
}

function extras(watch: LoginWatch): Pick<OauthLoginResult, 'openUrl' | 'userCode'> {
  return {
    ...watch.openUrl === undefined ? {} : { openUrl: watch.openUrl },
    ...watch.userCode === undefined ? {} : { userCode: watch.userCode },
  }
}

function waitingText(watch: LoginWatch): string {
  return [
    ...watch.lines,
    '',
    `Finish signing in to ${watch.provider} in the browser.`,
    'This page is not stuck; the login continues in the background.',
  ].join('\n')
}

function waitUntilAborted(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
      return
    }
    signal?.addEventListener('abort', () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'))
    }, { once: true })
  })
}

/**
 * Start OAuth and return as soon as the user has a URL or device code.
 * @param adapter - live pi-ai adapter (same Models + CredentialStore as streams).
 * @param provider - registered route id (`claude-code`, `openai-codex`, …).
 * @param preferredMethod - Codex `browser` or `device_code`; ignored otherwise.
 * @param onAuthChanged - fired after a successful token exchange so the picker can list the route.
 */
export async function startOauthLogin(
  adapter: PiAiAdapter,
  provider: string,
  preferredMethod?: string,
  onAuthChanged?: () => void,
): Promise<OauthLoginResult> {
  const existing = watches.get(provider)
  if (existing?.status === 'waiting') {
    return { kind: 'success', text: waitingText(existing), ...extras(existing) }
  }

  const lines: string[] = []
  const watch: LoginWatch = { provider, status: 'waiting', lines }
  watches.set(provider, watch)

  let released = false
  let release!: (error?: Error) => void
  const firstNotice = new Promise<void>((resolve, reject) => {
    release = (error?: Error): void => {
      if (released) return
      released = true
      if (error === undefined) resolve()
      else reject(error)
    }
  })

  const interaction: AuthInteraction = {
    prompt: async (prompt: AuthPrompt): Promise<string> => {
      if (prompt.type === 'select' && prompt.options.length > 0) {
        const preferred = pickSelectOption(provider, prompt.options, preferredMethod)
        watch.method = preferred.id
        lines.push(`${prompt.message} → ${preferred.label} (${preferred.id})`)
        return preferred.id
      }
      if (prompt.type === 'manual_code') {
        // Localhost callback wins this race; resolving would cancel the wait.
        await waitUntilAborted(prompt.signal)
      }
      if (prompt.type === 'text') {
        const blob = `${prompt.message} ${prompt.placeholder ?? ''}`.toLowerCase()
        if (/\bblank\b|\boptional\b|\bleave empty\b/.test(blob)) return ''
      }
      throw new Error(
        `Interactive prompt required (${prompt.type}: ${prompt.message}). `
        + 'Paste an API key in Settings → Models, or retry Sign in.',
      )
    },
    notify: (event: AuthEvent): void => {
      if (event.type === 'auth_url') {
        watch.openUrl = event.url
        lines.push(`Open this URL:\n${event.url}`)
        if (event.instructions !== undefined) lines.push(event.instructions)
        openSystemUrl(event.url)
        release()
        return
      }
      if (event.type === 'device_code') {
        watch.openUrl = event.verificationUri
        watch.userCode = event.userCode
        lines.push(`Open this URL:\n${event.verificationUri}`, `Enter code: ${event.userCode}`)
        openSystemUrl(event.verificationUri)
        release()
        return
      }
      if ((event.type === 'info' || event.type === 'progress') && event.message) {
        lines.push(event.message)
      }
    },
  }

  const finished = adapter.login(provider, interaction).then(
    () => {
      watch.status = 'ok'
      watch.detail = `Signed in to ${provider}.`
      onAuthChanged?.()
    },
    (error: unknown) => {
      watch.status = 'error'
      watch.detail = error instanceof Error ? error.message : String(error)
      release(error instanceof Error ? error : new Error(watch.detail))
    },
  )

  try {
    await firstNotice
  } catch (error) {
    return {
      kind: 'error',
      text: watch.detail ?? (error instanceof Error ? error.message : String(error)),
      ...extras(watch),
    }
  }

  void finished
  if (watch.status === 'ok') {
    return { kind: 'success', text: watch.detail ?? `Signed in to ${provider}.`, ...extras(watch) }
  }
  return { kind: 'success', text: waitingText(watch), ...extras(watch) }
}

/** Forget a login watch after logout so a later Sign in starts fresh. */
export function clearLoginWatch(provider: string): void {
  watches.delete(provider)
}
