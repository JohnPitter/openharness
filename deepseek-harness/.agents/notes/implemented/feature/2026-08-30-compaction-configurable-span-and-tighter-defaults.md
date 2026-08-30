# Agent Note: Configurable compaction summarizer span and tighter default context-shrinking budgets

Status: implemented

English | [中文](2026-08-30-compaction-configurable-span-and-tighter-defaults.zh.md)

## Problem

A deployment observed that context compaction still replays close to half its context window into the summarizer call — up to the hardcoded 65,536-token `SUMMARIZER_SPAN_CEILING` from the [span-ceiling note](../feature/2026-08-25-compaction-span-ceiling-and-progress.md) — and asked whether the system could be made more efficient, with an oversized-output-to-file pattern for anything too costly to keep inline. That pattern (`dsh-spill`/`dsh-spill-local`/`dsh-spill-policy`, plus `dsh-compaction-tool-result-pruner` ahead of summarization) already existed and already ran on every tool result. The actual gaps were narrower: those two layers' DEPLOYED thresholds were generous v1 defaults, and `SUMMARIZER_SPAN_CEILING`/`SUMMARIZER_ENVELOPE_RESERVE` were hardcoded constants in `region.ts` with no `BasicCompactionConfig` field, so a deployment could not shrink the summarizer's own replayed input without a source change — a deployment-varying choice hardcoded against the repo's own convention.

## Decision

`BasicCompactionConfig` gains two optional fields, `summarizerSpanCeiling` (default `65536`, positive integer) and `summarizerEnvelopeReserve` (default `16384`, non-negative integer), resolved exactly like `maxTokens`: a top-level default overridable per exact provider/model pair through `modelPolicies`. `summarizerSpanBudget`, `loggedSummarizerSpanBudget`, and `pressureSummarizerSpanBudget` in `region.ts` take them as parameters defaulting to the same built-in constants when omitted, so every caller that does not pass them keeps behaving identically. `compaction-basic`'s `index.ts` (pressure, overflow, and `compactNow` paths) resolves the routed target's policy and forwards its `summarizerSpanCeiling`/`summarizerEnvelopeReserve` instead of reading the module constants directly. The constants remain exported as the schema and parameter defaults.

Independently, the shipped deployment defaults for the two context-shrinking layers upstream of compaction are halved: `spill-policy.maxInlineBytes` 50000 → 24000 in the base bundle (host-wide; applies to every tool call regardless of which agent preset is active), and `compaction-tool-result-pruner`'s `{thresholdChars, headChars, tailChars}` 8192/4096/1024 → 4096/2048/512 everywhere it is configured — the base bundle and all four CLI agent presets (Standard, Code, Workflow, Cordis). These are the same mechanisms the [tool-output spill note](../architecture/2026-07-08-tool-output-spill-files.md) and the [compaction capability-seam note](2026-06-18-compaction-capability-seam.md) already describe; this change only tunes their deployed thresholds. The package-internal `DEFAULTS` constant inside `dsh-compaction-tool-result-pruner` (used only when a deployment configures the plugin with no config at all) is untouched.

## Alternatives considered

**Build a new file-spill mechanism for the summarizer replay path.** Rejected: the spill and pruning mechanisms already exist and already run upstream of every compaction summarization call. No new persistence mechanism was needed; the gap was tunability and defaults, not a missing capability.

**Reuse `maxTokens` for the span ceiling instead of a new field.** Rejected: `maxTokens` bounds the summarizer's OUTPUT; the span ceiling bounds its INPUT. Conflating them would make an output-cap change silently also change how much history gets replayed.

**Leave `SUMMARIZER_SPAN_CEILING`/`SUMMARIZER_ENVELOPE_RESERVE` as constants and only tune the spill/pruner deployment defaults.** Rejected: the span ceiling is the single largest cost knob in one compaction cycle (up to 65,536 tokens replayed per call), and a deployment on an expensive or slow route had no way to shrink it without a source change.

## Consequences

A deployment on a large context window that wants cheaper, faster (but coarser) compaction checkpoints can lower `summarizerSpanCeiling`/`summarizerEnvelopeReserve` per model without a source change; every existing deployment that names neither field is unaffected, since the defaults equal the prior hardcoded constants exactly. The halved spill/pruner defaults spill an oversized tool result to disk, and prune it further ahead of a compaction call, sooner than before — shrinking both the ordinary per-request context and the conversation prefix compaction replays — at the cost of a shorter head/tail preview shown for a very large result before the model reads the full spilled file.

## Testing

`compaction-basic.spec.ts` covers `resolveConfig`/`resolveTargetPolicy`/`resolveCompactSpec` resolving and merging the two new fields (default, top-level override, per-model inheritance and override), config-schema validation rejecting a non-positive `summarizerSpanCeiling` or a negative `summarizerEnvelopeReserve`, and `summarizerSpanBudget`/`pressureSummarizerSpanBudget`/`loggedSummarizerSpanBudget` honoring a configured ceiling/reserve instead of the built-in constants. `verify-cordis-config` covers the edited bundle and preset YAML.
