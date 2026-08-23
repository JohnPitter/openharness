# @deepseek-ai/dsh-web-search-duckduckgo

English | [中文](README.zh.md)

A keyless [DuckDuckGo](https://duckduckgo.com) HTML `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It POSTs `q=` to DuckDuckGo's no-JS HTML endpoint and maps `result__a` / `result__snippet` rows into the seam's normalized `WebSearchResult`. No API key and no auxiliary model call are involved.

This is an **implementation** package: it registers a provider into `ctx.web`, it does not own the `ctx.web` key and it does not register a model-facing tool (that is `@deepseek-ai/dsh-tool-web`). Like `@deepseek-ai/dsh-web-search-exa`, it is a function/namespace plugin (`inject: ['web']`) that registers its backend, not a default-export service.

## Config

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com/html/` | HTML search endpoint; the provider POSTs `q=` here. Falls back to `$DUCKDUCKGO_SEARCH_BASE_URL`. An unparseable value makes the provider unavailable. |

```yaml
- id: web-search-duckduckgo
  name: '@deepseek-ai/dsh-web-search-duckduckgo'
```

## Mapping

DuckDuckGo returns HTML result rows and no generated answer, so `content` is omitted. Each `result__a` maps to a `WebSearchSource`: `url` ← the href, unwrapping `uddg=` redirect wrappers, `title` ← the anchor text, `snippet` ← the following `result__snippet` when present. Advertisement blocks (`result--ad`), DuckDuckGo-hosted hrefs without `uddg`, and duplicate URLs are dropped. A missing snippet omits that field. The seam enforces `maxResults`. Provider failures (HTTP errors, network failure, body read failure) surface as `WebError` `WEB_PROVIDER_ERROR`; an aborted request surfaces as `WEB_ABORTED`. HTTP redirects are rejected before the `Location` target is contacted and surface as `WEB_PROVIDER_ERROR`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which retains this provider's `maxResults`-bounded URLs, titles, and snippets or its exact `DuckDuckGo search aborted`, `DuckDuckGo search request failed: <error>`, `DuckDuckGo search error (HTTP <status>)`, and `DuckDuckGo returned an unprocessable response body: <error>` failures under the consumer's error wrapper while generated answers remain outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **HTML markup is a provider-private parsing contract** — DuckDuckGo can change class names or wrap more links; missing rows become an empty source list rather than a hard failure.
- **Abort classification is error-shape-based** — only a `DOMException` named `AbortError` maps to `WEB_ABORTED`; an abort carrying a custom reason (e.g. `dsh-timeout`'s `TimeoutReason`) surfaces as `WEB_PROVIDER_ERROR`.
