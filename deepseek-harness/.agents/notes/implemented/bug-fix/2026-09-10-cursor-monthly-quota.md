# Agent Note: Cursor's monthly plan quota on the shared quota surfaces

Status: implemented

English | [中文](2026-09-10-cursor-monthly-quota.zh.md)

## Problem

The Cursor route exposed no quota surface: Settings → Limits, the sidebar chip's quota segment, and the composer's inner meter ring all rendered nothing for Cursor, even though the account's plan usage is what gates composer-model runs.

## Decision

`llm-cursor` gains `usage.ts`: one unary Connect-JSON call to `aiserver.v1.DashboardService/GetCurrentPeriodUsage` on the same `api2.cursor.sh` origin the agent protocol runs on, with the same JWT as generation and full abort support. `CursorAgentAdapter.accountUsage` maps the response's auto bucket — the bucket every composer/grok model this adapter lists draws from — to one `monthly` window with the billing-cycle end as its reset. Endpoint existence and payload fields were confirmed live against the account before implementation (`GetUsageSummary` is 404; `cursor.com/api/usage` wants a session cookie, not the JWT).

The client quota surfaces learned the window: `quotaWindowLabel`/`quotaChipSegment` add the `monthly` case (`Monthly`/`每月`/`Mensal`/`Mensual`), so the sidebar chip reads `47% mensal` and the composer ring + tooltip follow the same window.

## Alternatives considered

**Report both the auto and API buckets as two windows.** Rejected for now: every model this adapter serves is in the auto bucket, so one window is the number that gates the user's runs; the API bucket can join later if the adapter ever lists named frontier models.

**Read the per-request `requests`-style metering.** No such window exists on this endpoint — Cursor meters this plan monthly.

## Consequences

Cursor joins the quota surfaces with its real monthly window; `fetchCursorAccountUsage` throws `AUTH` on 401/403 so the panel renders the same "usage error" recovery path as the other providers. Probe cost is one unary JSON POST per provider per minute, with a 2.5s hang bound ([timeout](2026-09-10-quota-probe-timeout-and-progressive-limits.md)).

## Verification

`usage.spec.ts` pins the wire path, the bearer header, the auto-bucket mapping (percent, limit-100 normalization, cycle reset), the AUTH mapping, and the loud failure on a payload without the auto bucket; the chip spec pins the `47% monthly` segment. A live probe confirmed the endpoint and payload before implementation.
