/**
 * `DuckDuckGoSearchProvider`: a keyless `WebSearchProvider` over DuckDuckGo's no-JS HTML
 * endpoint. It POSTs `q=` to a fixed search URL, maps `result__a` / `result__snippet`
 * rows into `WebSearchSource`, unwraps `uddg=` redirect wrappers, and drops ads.
 * Absence of result rows is an empty source list, not an error.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const DUCKDUCKGO_PROVIDER_ID = 'duckduckgo'

/** Default DuckDuckGo HTML search endpoint; the provider POSTs `q=` to this URL. */
export const DUCKDUCKGO_DEFAULT_BASE_URL = 'https://html.duckduckgo.com/html/'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface DuckDuckGoSearchProviderOptions {
  /** HTML search endpoint; the provider POSTs the query here. */
  baseURL: string
}

/**
 * Decode the few HTML entities DuckDuckGo emits in titles and snippets.
 * @param text - raw inner HTML text of one title or snippet node.
 * @returns the decoded plain text, with tags stripped.
 */
export function decodeHtmlText(text: string): string {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve a result href to the destination page. DuckDuckGo wraps some links as
 * `//duckduckgo.com/l/?uddg=<urlencoded url>`; those unwrap to the `uddg` value.
 * Advertisement and javascript URLs are rejected.
 * @param href - the `href` attribute from a `result__a` anchor.
 * @returns an http(s) URL, or `undefined` when the href is not a usable page.
 */
export function unwrapDuckDuckGoHref(href: string): string | undefined {
  const trimmed = href.trim()
  if (trimmed.length === 0) return undefined
  const absolute = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed
  let parsed: URL
  try {
    parsed = new URL(absolute)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined
  const wrapped = parsed.searchParams.get('uddg')
  if (wrapped !== null && wrapped.length > 0) {
    try {
      const destination = new URL(wrapped)
      if (destination.protocol !== 'http:' && destination.protocol !== 'https:') return undefined
      return destination.href
    } catch {
      return undefined
    }
  }
  if (isDuckDuckGoHost(parsed.hostname)) return undefined
  return absolute
}

/** True for DuckDuckGo's own hosts, which are wrappers or ads rather than result pages. */
function isDuckDuckGoHost(hostname: string): boolean {
  return hostname === 'duckduckgo.com' || hostname.endsWith('.duckduckgo.com')
}

/**
 * Map DuckDuckGo HTML into normalized sources. Ad blocks (`result--ad`) and
 * hrefs that do not resolve to an http(s) page are dropped. Duplicate URLs
 * keep the first occurrence. A missing snippet omits that field rather than
 * inventing excerpt text.
 * @param html - the HTML body of one HTML-endpoint response.
 * @returns the sources in document order.
 */
export function parseDuckDuckGoHtml(html: string): WebSearchSource[] {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)
  for (const match of anchors) {
    const attrs = match[1]
    if (attrs === undefined || !/\bclass\s*=\s*(["'])[^"']*\bresult__a\b/.test(attrs)) continue
    const index = match.index!
    const preceding = html.slice(0, index)
    const lastResultAttr = Math.max(
      preceding.lastIndexOf('class="result'),
      preceding.lastIndexOf("class='result"),
    )
    const block = html.slice(lastResultAttr === -1 ? Math.max(0, index - 120) : lastResultAttr, index)
    if (/\bresult--ad\b/.test(block)) continue
    const href = /\bhref\s*=\s*(["'])([^"']+)\1/.exec(attrs)?.[2]
    if (href === undefined) continue
    const url = unwrapDuckDuckGoHref(href)
    if (url === undefined || seen.has(url)) continue
    const title = decodeHtmlText(match[2]!)
    const ahead = html.slice(index + match[0].length, index + match[0].length + 2000)
    const snippetMatch = /<a\b[^>]*class\s*=\s*(["'])[^"']*\bresult__snippet\b[^"']*\1[^>]*>([\s\S]*?)<\/a>/i
      .exec(ahead)
    const snippet = snippetMatch?.[2] === undefined ? undefined : decodeHtmlText(snippetMatch[2])
    seen.add(url)
    sources.push({
      url,
      ...title.length > 0 ? { title } : {},
      ...snippet !== undefined && snippet.length > 0 ? { snippet } : {},
    })
  }
  return sources
}

/**
 * Map an HTML body to a normalized search result. DuckDuckGo returns no
 * generated answer, so `content` is omitted. The web service owns `maxResults`
 * truncation, so this provider reports `truncated: false`.
 * @param html - the HTML body of one HTML-endpoint response.
 * @returns the normalized result.
 */
export function mapDuckDuckGoHtml(html: string): WebSearchResult {
  return { sources: parseDuckDuckGoHtml(html), truncated: false }
}

/** The DuckDuckGo HTML search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class DuckDuckGoSearchProvider implements WebSearchProvider {
  readonly id = DUCKDUCKGO_PROVIDER_ID

  constructor(private readonly options: DuckDuckGoSearchProviderOptions) {}

  available(): boolean {
    return isValidBaseUrl(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    let response: Response
    try {
      response = await fetch(this.options.baseURL, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'accept': 'text/html',
          'user-agent': USER_AGENT,
        },
        body: new URLSearchParams({ q: request.query }).toString(),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      throw new WebError(`DuckDuckGo search error (HTTP ${String(response.status)})`, 'WEB_PROVIDER_ERROR')
    }

    try {
      const html = await response.text()
      return mapDuckDuckGoHtml(html)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('DuckDuckGo search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`DuckDuckGo returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
