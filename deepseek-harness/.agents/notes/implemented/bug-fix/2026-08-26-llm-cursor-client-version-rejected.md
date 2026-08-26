# Agent Note: Cursor listing needs a current clientVersion pin

Status: implemented

English | [中文](2026-08-26-llm-cursor-client-version-rejected.zh.md)

## Problem

The native Cursor adapter sends a compiled `x-cursor-client-version` pin. After Cursor published `3.17.21`, the backend rejected `3.17.19` with a `resource_exhausted` trailer whose human detail is "Your version of Cursor is no longer supported… cursor.com/downloads". `GetUsableModels` failed inside the 2.5s listing bound, so the picker published only the configured fallback (Composer 2.5). The same trailer on `StreamUnifiedChatWithTools` mapped to `RATE_LIMIT` and the loop retried five times.

Grok and the rest of the Cursor catalog never appear until live listing succeeds. They are not separate OpenHarness providers.

## Decision

`DEFAULT_CLIENT_VERSION` is `3.17.21`, matching the `stable`/`win32-x64-user` channel and the installed Cursor `product.json` `version`. Schema and adapter constructor defaults use that constant. Native transport headers read `clientVersion` from the live settings snapshot, so Apply can raise the pin without a restart.

`decodeTrailer` still maps quota `resource_exhausted` to `RATE_LIMIT`. When the combined message contains `no longer supported` or `cursor.com/downloads`, the code is `PROVIDER_ERROR` so the loop does not treat a rejected pin as quota.

The advisory `models` array stays Composer 2.5. Live `GetUsableModels` is the catalog of Grok and the other Cursor ids.

## Alternatives considered

**Probe the updater API at boot and send whatever it reports as latest.** Rejected: extra network on every start, and the unofficial header must stay a reviewable pin in source.

**Seed `DEFAULT_MODELS` with guessed Grok / GPT / Claude ids.** Rejected: a wrong id fails at request time; the live listing already returns the account's usable set once the pin is accepted.

**Keep mapping every `resource_exhausted` to `RATE_LIMIT`.** Rejected: the version detail is distinguishable from quota text, and five quota retries delay a pin that cannot succeed until the header changes.

## Consequences

A backend that still accepts `3.17.21` returns the full usable catalog to the picker. The next Cursor desktop bump can reject this pin the same way; maintainers raise `DEFAULT_CLIENT_VERSION` in the same change. Quota and billing trailers without the version phrases remain `RATE_LIMIT`.
