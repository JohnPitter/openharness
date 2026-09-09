# Agent Note: Quota probes resolve OAuth tokens through the chat refresh path

Status: implemented

English | [中文](2026-09-09-account-usage-oauth-refresh.zh.md)

## Problem

`PiAiAdapter.accountUsage()` resolved its bearer token by reading the stored OAuth credential raw (`credentials.read(provider)` → `access`). Chat requests instead resolve through `Models.getAuth()`, which refreshes an expired credential under a lock and persists the rotation. After a signed-in access token aged out (Claude Code and Codex tokens live hours), the Limits panel probe answered `usage error (HTTP 401)` while chat — and the plan's actual quota — kept working, until any chat request happened to refresh the stored pair. The panel therefore flickered between working and 401 depending on chat activity, exactly the reported symptom.

## Decision

`bearerToken()` now resolves through the same path a chat request takes: after the pasted-key branch, it calls `snapshot.models.getAuth(provider)` and uses the returned `auth.apiKey` (for these OAuth providers, the refreshed access token). The raw stored read remains as the fallback when `getAuth` finds no credential. `accountUsage()` also retries the probe exactly once on an `AUTH` failure after re-resolving the token, covering a rotation that lands between resolution and the request (a concurrent refresh by another process writes the durable store).

## Alternatives considered

**Refresh manually in `bearerToken` (read `expires`, call the provider's token endpoint).** Rejected: it would duplicate pi-ai's locked refresh, rotation persistence, and per-provider token endpoints, and the two implementations would drift.

**No retry on `AUTH`.** Rejected: the refresh path cannot help a token revoked or rotated server-side between resolution and the probe; a single re-resolve-and-retry closes that window for a probe the UI fires on a timer.

## Consequences

A Limits probe with an expired stored credential performs one token refresh (the same request-priced round trip chat already performs) instead of failing with 401. Unresolvable credentials still surface the probe error honestly; nothing about pasted-key routes (GLM, Kimi) changes.

## Verification

`adapter.spec.ts` pins the refresh path with an expired stored Codex credential (the probe's `authorization` header carries the refreshed token and the store holds the rotation) and pins the single retry on a 401 against an unexpired credential.
