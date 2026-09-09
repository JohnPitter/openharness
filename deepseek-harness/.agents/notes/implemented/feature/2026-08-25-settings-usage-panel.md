# Agent Note: Settings usage panel

Status: implemented

English | [中文](2026-08-25-settings-usage-panel.zh.md)

## Problem

Settings → Usages only listed live coding-plan account quotas. Token spend, daily history, and most-used models lived in per-session logs, so a user opening Settings could not see how this Host had been used, and deleting a session dropped that spend from any future scan.

## Decision

**The `usages` settings section is the Host-local usage panel: a daily/model ledger shown as Settings → Status.**

`usage.panel` is a client-request domain. The Host folds `request/header` plus `assistant/chunk`/`assistant/message` usage samples the way token-meter does: a later sample for the same turn/step replaces the earlier buckets and does not increment `requests`. Days use the Host local calendar from `event.time`. Routes are keyed as a JSON `[provider, model]` tuple so model ids may contain `/`. Usage before any header is credited to `unknown`/`unknown`.

The durable file is `$DSH_HOME/usage-panel.json`. The gateway plugin passes that path into `createApiProxy`; tests omit it and keep the fold process-local. On boot the ledger loads the file (a missing, corrupt, or version-mismatched file is empty), backfills remaining session logs through `sessionPersistence.list`/`inspect` while buffering live `session/event` ingest, then replays the buffer with the per-session seq watermark so inspect and live events do not double-count. Deleted sessions stay in the day and model totals because those buckets live in the file, not in the logs.

The browser page (`UsagesSection`) keeps nav id `usages` (label Status). It shows today / 7-day / all-time totals, a 14-day bar row, and ranked models. Coding-plan quota cards live on the sibling Settings → Limits section (`id: quotas`); see [Settings Limits and Status sections](../bug-fix/2026-09-09-settings-limits-and-status-sections.md). The sidebar usage chip's view-all action opens Limits, not Status.

## Alternatives considered

**Scan every session on each Settings open.** Rejected: it is slow on a large corpus and loses deleted sessions.

**Grow `token-meter` into a global file ledger.** Rejected: token-meter is a per-session projection with a closed config; a Host-local file and RPC belong on the gateway.

**Add a second settings nav id.** Rejected for this ledger feature's original presentation: the usage chip opened `usages`, and splitting quotas from history was out of scope here. Independent Limits and Status pages are owned by [Settings Limits and Status sections](../bug-fix/2026-09-09-settings-limits-and-status-sections.md).

**Put the fold in `llm.*`.** Rejected: the values are Host-local session accounting, not provider account quotas.

## Consequences

Opening Settings → Status / Status / 状态 / Estado shows this Host's request and token history even after sessions are deleted. Quotas are Settings → Limits (`id: quotas`), not a subsection of Status. The ledger file is not a billing invoice: it follows whatever adapters report on usage samples.

## Testing

`usage-panel.spec.ts` covers new-step vs same-step replace, day/model split, watermarks, backfill, corrupt files, and live buffering. `api-proxy-usage.spec.ts` folds a live session through `usage.panel`. Carrier tests round-trip the new method. `usages-section.client.spec.tsx` covers empty history, ranked models, refresh, and load failures on Status. Quota cards are covered with Limits in `quotas-section.client.spec.tsx`.
