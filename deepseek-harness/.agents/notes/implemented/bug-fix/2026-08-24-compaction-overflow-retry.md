# Agent Note: Adaptive compaction overflow retry

Status: implemented

English | [中文](2026-08-24-compaction-overflow-retry.zh.md)

## Problem

v0.1.23 still failed compaction on a real 272K Codex (`gpt-5.6-sol`) session: every `/compact` ended with `pi-ai detected context overflow`, surfaced as the generic `could not produce a useful summary`. Two causes combined: llm-pi-ai classified its client-side overflow as generic `PI_AI_ERROR` rather than `CONTEXT_WINDOW_EXCEEDED`, so no recovery path recognized it; and the token estimate can undercount the provider because attachments and base64 expand the request, so a deterministic budget cannot guarantee a fit.

## Decision

The shared LLM error classifier and pi-ai stream mapping map the pi-ai `detected context overflow` error to the canonical `CONTEXT_WINDOW_EXCEEDED` code.

Compaction retries adaptively within one transaction: it makes up to three attempts under one compaction start/end bracket and the same `compactionId`. After each `CONTEXT_WINDOW_EXCEEDED`, it halves the span budget and reselects balanced ranges. It does not mutate the surface between attempts; cancellation and non-context errors are not retried.

The window resolver uses the recorded `requestContext` window. An undefined window uses the explicit 128K safety fallback (`SUMMARIZER_CONTEXT_WINDOW_FALLBACK`); a null or invalid window fails closed with a zero budget and no LLM call. Pressure forwards the same envelope-aware cap when it is positive; a zero envelope-aware budget leaves pressure uncapped. `compactNow` prunes oversized tool results before selecting the span.

The `/compact` message appends only allowlisted stable error codes, such as `CONTEXT_WINDOW_EXCEEDED`; it never exposes raw error chains or prompt content.

## Alternatives considered

**Synchronous catalog window lookup.** Rejected: `LlmRuntime` has no synchronous API, and asynchronous `resolveModelInfo` before the maintenance lock would break locking.

**Chunked multi-transaction summarization.** Rejected: it creates multiple lossy summaries and adds bracket complexity.

## Consequences

Routes with windows above 128K and no recorded window compact more aggressively. A context-window mismatch adds at most two extra summarizer attempts instead of guaranteeing a fit from the estimate alone; the retry absorbs provider-side expansion rather than eliminating the mismatch.

## Testing

281 tests cover the LLM service, llm-pi-ai adapter, compaction-basic, and command-compact, including stream-rejection retry with one start/end bracket, suffix and no-raw-chain assertions, and fallback or fail-closed windows. Host tsc is clean, oxlint is clean on the compaction packages, and the official build verified its markers.
