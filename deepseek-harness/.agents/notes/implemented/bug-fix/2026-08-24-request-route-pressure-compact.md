# Agent Note: Pressure compact runs on request-metered routes

Status: implemented

English | [中文](2026-08-24-request-route-pressure-compact.zh.md)

## Problem

General Settings expose `compaction-basic.auto` and `thresholdPercent` (default 75%). On a request-metered coding-plan route the pressure path pruned tool results and then skipped the summarizer to save quota. Occupancy climbed to 100%. Canonical overflow and `/compact` then sent nearly the full surface to the same model; that auxiliary call overflowed, the conversation was unchanged, and `/compact` reported that it could not produce a useful summary.

## Decision

Pressure compact LLM runs on every metering unit. The live overlay remains Settings → General: `auto` and `thresholdPercent`. A request-metered route still skips the automatic title provider; that skip stays on the [route-metering note](../feature/2026-08-23-route-metering.md).

Overflow and `compactNow` cap the priced span so the summarizer request fits the routed window when the last `request/context` record carries capacity. Without a window they still attempt one maximal balanced reduction.

## Alternatives considered

**Keep the pressure skip and document it in Settings.** Rejected: the General control would advertise a 75% compact that never summarized on Codex, Kimi, Claude Code, GLM, or OpenCode.

**Skip overflow and `/compact` on request-metered routes too.** Rejected: a session already at the window would have no recovery path.

**Send the summarizer to a separate token-metered model.** Rejected: there is no configured summarizer pair, and the conversation model already holds the warm prefix the call is built to reuse.

## Consequences

Each automatic pressure compact on a coding plan spends one request. A session already at 100% can recover through overflow or `/compact` without the summarizer overflowing. Title generation remains skipped on request-metered routes.

## Testing

`compaction-basic.spec.ts` covers request-metered pressure summarization when prune cannot clear the threshold, overflow still summarizing on that metering, a `maxSpanTokens` cut that shrinks the head-anchored range, `summarizerSpanBudget` headroom on a small window, and overflow compacting a session larger than the advertised window. `compaction-loop-repro.spec.ts` still recovers thrown and in-band `CONTEXT_WINDOW_EXCEEDED` through the real loop.
