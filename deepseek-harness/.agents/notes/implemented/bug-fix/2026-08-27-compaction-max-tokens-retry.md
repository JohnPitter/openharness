# Agent Note: Compaction retries output-cap truncation

Status: implemented

English | [中文](2026-08-27-compaction-max-tokens-retry.zh.md)

## Problem

After idle prune started landing, a live Workflow session (`session-4e0e8fdd`, 513 turns, ~134k surface tokens) still failed `/compact` three times in a row. Each attempt pruned, opened a `turn: null` bracket, ran the summarizer for ~97s, and closed with `summarization truncated at the token cap (incomplete checkpoint)` (`MAX_TOKENS`). No `compaction/summary` landed.

The default summarizer cap is 8192 tokens and may include reasoning. A verbose or thinking model fills that cap before every checkpoint heading exists. The region transaction already retried `CONTEXT_WINDOW_EXCEEDED` by halving the span; it treated `MAX_TOKENS` as a terminal summary failure, so the user had to invoke `/compact` again against the same oversized span.

## Decision

A `max-tokens` finish whose projected text (visible, or reasoning when visible is empty) contains every required checkpoint heading in order is a complete checkpoint and commits. An incomplete truncated body still fails with `MAX_TOKENS`.

That `MAX_TOKENS` failure retries inside the same start/end bracket by halving the span budget, up to three total attempts, matching [overflow retry](2026-08-24-compaction-overflow-retry.md). Cancellation and other errors still fail closed.

## Alternatives considered

**Raise the default `maxTokens` (8192).** Rejected as the only fix: a longer cap lengthens the already ~97s call and still fails a model that writes the first sections in prose. Retrying a smaller span is what overflow already does.

**Land any truncated text.** Rejected: a cut that never reached `## Next Step` drops the resume instruction. Heading-complete salvage keeps the structure; incomplete output shrinks the span instead.

**A dedicated summarizer model.** Rejected for this defect: the conversation target is the cache-prefix alignment; swapping models is a separate policy.

## Consequences

`/compact` can finish after an output-cap truncation when the checkpoint headings landed, or after one or two smaller-span retries. A session that still cannot produce a complete checkpoint in three attempts keeps the previous `MAX_TOKENS` close and leaves the surface unchanged.

## Testing

`compaction-basic.spec.ts` accepts ordered complete headings on `max-tokens`, including reasoning-only output, and still rejects a body that never reached Next Step. `manual-compaction.spec.ts` retries `MAX_TOKENS` inside one start/end bracket and lands `compaction/summary`.
