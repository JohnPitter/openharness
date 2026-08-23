/**
 * `@deepseek-ai/dsh-web-search-duckduckgo`: registers a keyless DuckDuckGo HTML
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): a search provider does not own the `ctx.web` key —
 * it registers INTO the seam's provider registry. The HTML endpoint is a
 * provider-private detail and does not use `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-web-search-duckduckgo
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  DuckDuckGoSearchProvider,
  DUCKDUCKGO_DEFAULT_BASE_URL,
} from './provider.ts'

export {
  DUCKDUCKGO_DEFAULT_BASE_URL,
  DUCKDUCKGO_PROVIDER_ID,
  DuckDuckGoSearchProvider,
  decodeHtmlText,
  mapDuckDuckGoHtml,
  parseDuckDuckGoHtml,
  unwrapDuckDuckGoHref,
} from './provider.ts'
export type { DuckDuckGoSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-duckduckgo'

/** The web seam this provider registers into. */
export const inject = ['web']

/**
 * Environment variable naming this provider's HTML endpoint. Distinct from any
 * LLM base URL: this provider only POSTs `q=` to the DuckDuckGo HTML search page.
 */
const SEARCH_BASE_URL_ENV = 'DUCKDUCKGO_SEARCH_BASE_URL'

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** HTML search endpoint; the provider POSTs `q=` here. Defaults to DuckDuckGo's no-JS page. */
  baseURL?: string
}

export const Config: z<Config> = z.object({
  baseURL: z.string(),
})

/** Register the DuckDuckGo search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new DuckDuckGoSearchProvider({
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(SEARCH_BASE_URL_ENV)?.value
      ?? DUCKDUCKGO_DEFAULT_BASE_URL,
  }))
}
