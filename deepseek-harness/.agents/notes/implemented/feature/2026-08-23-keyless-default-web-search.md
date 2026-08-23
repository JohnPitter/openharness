# Agent Note: Keyless DuckDuckGo default web search

Status: implemented

English | [中文](2026-08-23-keyless-default-web-search.zh.md)

## Problem

Shipped `web_search` ran DeepSeek's native search server tool. That path needs `DEEPSEEK_API_KEY` and billed DeepSeek tokens on every call, even when conversation uses Kimi, Claude Code, Codex, or GLM. A missing or empty DeepSeek balance makes internet search fail while chat still works. Exa and Perplexity exist in-tree but also require paid keys, so swapping to either would not remove the extra-vendor balance requirement.

## Decision

`packages/bundle/base/cordis.patch.yml` mounts `dsh-web` with `searchProvider: duckduckgo` and `@deepseek-ai/dsh-web-search-duckduckgo`. The provider POSTs `q=` to DuckDuckGo's no-JS HTML endpoint (`https://html.duckduckgo.com/html/` or `$DUCKDUCKGO_SEARCH_BASE_URL`), maps `result__a` / `result__snippet` rows, unwraps `uddg=` wrappers, drops ads, and registers as `duckduckgo`. It needs no API key and issues no auxiliary model request. `dsh-tool-web` still ships `fetch: false` and `searchTimeoutMs: 60000`. The DeepSeek search row remains in the composition with `disabled: true` so an overlay can re-enable it without adding the package; the Web snapshot lane does that and pins `searchProvider: deepseek-official` against a local Messages fixture.

Mounting search without `web_fetch`, explicit provider selection, and overlay replacement remain as in the [default web-search mount](2026-07-31-web-default-search.md). This note owns only which search backend the shipped default selects.

## Alternatives considered

**Ship Exa or Perplexity as the default.** Rejected because both need their own paid API keys; that repeats the DeepSeek-balance failure for users who only have a coding-plan key.

**Keep DeepSeek search mounted and selected.** Rejected because conversation can succeed on a non-DeepSeek route while every `web_search` still fails on a missing DeepSeek credential or balance.

**Enable `web_fetch` instead of a search provider.** Rejected because default fetch would let the model pick arbitrary URLs; HTML search hits one fixed endpoint.

**Scrape DuckDuckGo from `dsh-tool-web`.** Rejected because provider selection belongs in `ctx.web`; the tool package must not import a vendor backend.

## Consequences

Default `web_search` works without storing a DeepSeek, Exa, or Perplexity key. Result quality follows DuckDuckGo HTML markup; a markup change can return fewer sources without failing the call. DeepSeek native search stays available as a disabled composition row. The Web search-round snapshot still drives the real DeepSeek provider through an overlay, not the shipped default id.
