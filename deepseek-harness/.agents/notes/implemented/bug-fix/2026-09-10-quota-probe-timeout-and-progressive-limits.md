# Agent Note: Quota probes time out and Limits paints cards as they arrive

Status: implemented

English | [中文](2026-09-10-quota-probe-timeout-and-progressive-limits.zh.md)

## Problem

Ambient quota (`useProviderQuota` on the sidebar chip and composer `QuotaRing`) and Settings → Limits (`QuotasSection`) call `llm.accountUsage` with no probe timeout. Cursor's `fetchCursorAccountUsage` opens an HTTP/2 `connect()` that waits forever unless a signal is passed. A hung `GetCurrentPeriodUsage` leaves the chip empty and, because Limits uses `Promise.all`, blanks every plan card. Chip and ring each probe the same provider.

The RPC unary default is 30s, which is still far too long for an ambient readout.

## Decision

Every client quota probe is bounded at 2.5s (the same order as the Kimi live-catalog listing timeout). `useProviderQuota` and Limits wrap each `accountUsage` with a disposable timeout signal and `awaitWithAbort`, so a loader that ignores `AbortSignal` still fails closed. Unmount aborts the caller's wait; a shared in-flight probe is not cancelled while another surface still needs it.

`loadAccountUsage` forwards an optional `AbortSignal` into `api.accountUsage`. `fetchCursorAccountUsage` applies the same 2.5s bound when the caller omits a signal, destroys the HTTP/2 request on abort or timeout, and always `client.close()`s. Pi-ai `fetchUsageJson` already honors a caller signal.

Limits lists providers, then paints a card as each probe settles (loading placeholders for in-flight rows). Unsupported routes are still omitted. A timeout or abort becomes `{ supported: true, error }` using `usage.quotaTimeout`, so other plans remain visible. Refresh aborts the previous batch and reloads every provider.

Chip and ring share a 60s success cache keyed by the loader function and provider, so the two ambient surfaces do not double-hit Cursor. Failures are not cached; the one-minute cadence retries.

Ambient chip and ring still hide on error via `leadQuotaWindow`.

## Alternatives considered

**Rely on the RPC client's 30s unary timeout.** Rejected: the chip stays empty for half a minute, Limits still waits on `Promise.all`, and a host-side HTTP/2 `connect()` without a signal is not aborted by the HTTP POST timing out.

**Keep Limits on `Promise.all` and only add the 2.5s bound.** Rejected: even with a timeout, the page would stay on the full-page loading hint until the slowest provider finishes.

**Skip the 60s single-flight cache.** Accepted as optional; the cache is small (a `WeakMap` of loader → provider → in-flight or TTL'd view) and stops chip+ring from opening two HTTP/2 sessions.

**Port official Session V3 / parent-subagent-catalog-foundation.** Rejected: unrelated to quota probes.

## Consequences

A hung Cursor or Codex probe fails in 2.5s instead of hanging the chip, ring, or Limits page. Limits shows every plan that has already answered. Chip and ring share one successful read per provider per minute. Timeout copy exists in zh/en/pt/es as `usage.quotaTimeout`.

This extends [Cursor monthly quota](2026-09-10-cursor-monthly-quota.md) and the [lead-window chip/ring](2026-09-09-quota-ring-composer-chip.md) without changing which window those surfaces display.

## Testing

`usage-quota-live.client.spec.tsx` pins abort/timeout helpers, cache TTL, in-flight join, and two rings sharing one loader. Chip and ring specs assert an aborted or hung probe leaves the ambient readout hidden. `quotas-section.client.spec.tsx` paints Kimi while Cursor never returns, and keeps a timed-out Cursor card beside a settled plan. `llm-cursor` `usage.spec.ts` aborts a hanging request, rejects an already-aborted signal, and times out when the caller omits a signal.
