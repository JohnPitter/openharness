# Agent Note: Picker catalog listing stays bounded

Status: implemented

English | [中文](2026-08-24-model-catalog-listing-timeout.zh.md)

## Problem

`session.models` builds the composer picker by `Promise.all` over every advertised route's `listModels()`. The Kimi adapter's picker path issued `GET {baseURL}/models` with no abort. Node `fetch` has no default timeout. One hung probe kept the whole catalog pending. The client unary timeout is 30s; after it threw, `ModelDirectory.load()` left `status: 'loading'` because only an `ok: false` result recorded `error`. The seat inject swallowed the throw. The menu stayed on "Refreshing model list…" with empty groups, so no Retry strip appeared and no other provider could be chosen.

Settings-page discovery already reports a failed probe to the form. That path is not this catalog RPC.

## Decision

The picker catalog must not wait on an unbounded probe.

`KimiAdapter.listModels` aborts the live listing at `CATALOG_LISTING_TIMEOUT_MS` (2.5s) and merges the configured catalog with the last successful live listing. A hang, a missing key, a non-OK response, or an unreadable body takes that fallback. Live capacities still enrich uncatalogued `resolveModel` ids when a listing has succeeded.

`buildModelCatalog` races each `listModels` against `MODEL_CATALOG_PROVIDER_TIMEOUT_MS` (4s). A hang becomes that route's `failures` row; other groups still return.

`ModelDirectory.load` and `select` record `status: 'error'` when the RPC throws, so the in-menu Retry strip can fire. A newer generation still owns the store.

The Models page Fetch button stays on `registerModelDiscovery` and still reports probe failure to the form.

## Alternatives considered

**Serve only the configured catalog from `listModels`, and keep live listing on the Settings button.** Rejected: a configured key is how K3 and later endpoint ids reach the picker without a settings round-trip. The abort keeps that merge when the endpoint answers and drops it when it does not.

**Rely on the 30s client unary timeout alone.** Rejected: after that throw the directory stayed on `loading`, so the UI never recovered without a reload, and the other providers sat behind the same pending `Promise.all`.

**Background-refresh the live listing and return the configured catalog immediately.** Rejected: the first `session.models` would omit live ids until a later reload, and nothing on this path republishes `llm/adapters-updated` after a silent probe.

## Consequences

A Kimi endpoint that never answers no longer blocks DeepSeek, Claude Code, Codex, or GLM in the picker. The first open may miss live-only ids until a later open after a successful probe, or until Fetch available models. Quota and chat `fetch` paths are unchanged; they keep their own idle watchdogs.

## Testing

`llm-kimi` `adapter.spec.ts` covers live merge, last-good retention after a later failure, and abort-signal fallback. `api-proxy-models.spec.ts` advances fake timers past the per-provider bound and asserts the hung route is a failure while DeepSeek still groups. `browser-plugin.client.spec.ts` rejects `session.models` and asserts the directory leaves `loading` for `error`.
