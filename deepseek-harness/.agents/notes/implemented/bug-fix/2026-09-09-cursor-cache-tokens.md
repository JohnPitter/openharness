# Agent Note: Cursor turns report their cache-token buckets

Status: implemented

English | [中文](2026-09-09-cursor-cache-tokens.zh.md)

## Problem

The agent.v1 decoder read only `input_tokens`/`output_tokens` from `turn_ended`, so every Cursor turn surfaced `cacheReadTokens: 0` to the token meter and the sidebar chip's cache-hit reading sat at 0% regardless of server behavior.

## Decision

`decodeServerFrame` now maps the `TurnEndedUpdate` fields the sparse proto already declared (`cache_write_tokens = 3`, `cache_read_tokens = 4`) and the adapter forwards both into the `usage` chunk when present, following the harness's disjoint-bucket convention. Live probing against the account shows the server populates them (`cache_write` on every turn), while `cache_read` stays 0 across separate `Run` invocations for composer-2.5 — Cursor does not reuse prompt cache across runs — so the displayed hit rate remains faithful even when it reads 0%.

## Alternatives considered

**Hide the cache reading for Cursor instead of decoding the buckets.** Rejected: the wire discloses real values, cache writes are nonzero today, and nothing in the account contract says cache reads never occur for other models or future server behavior.

## Consequences

Session token totals for Cursor now include cache writes; the chip's cache-hit percent reflects server-reported reads. No cost behavior changes: the Cursor route stays request-metered.

## Verification

`agent-proto.spec.ts` round-trips the cache fields; `adapter.spec.ts` pins the `usage` chunk carrying both buckets. A live two-turn probe confirmed the server sends `cacheWriteTokens` and reports `cacheReadTokens: 0` across runs.
