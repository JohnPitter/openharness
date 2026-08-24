# Agent Note: Compaction interruption and bounded deadline

Status: implemented

English | [中文](2026-08-25-compaction-interruption-and-deadline.zh.md)

## Problem

A durable `session/end-seed` proves that work from the preceding session lifecycle cannot still be live, but the client left unmatched `command/run` rows pending forever. Provider keepalives could also extend one compaction transaction indefinitely because the existing watchdog only bounded idle reads.

## Decision

The conversation assembler replays `session/end-seed` boundaries in log order for every lifecycle Definition that opts into reconciliation. The command Definition turns an unmatched command into an error only at a later boundary; a missing boundary remains pending, and a later `command/done` remains authoritative. Pagination does not invent a boundary when it is outside the loaded window.

Compaction uses one five-minute overall deadline across all summary and context-overflow retry attempts. The deadline races the summarizer promise independently of `AbortSignal`, aborts the provider signal, and produces `LlmError` code `COMPACTION_TIMEOUT`; manual `/compact` allowlists that code while preserving caller cancellation precedence. The transaction still writes one `compaction/end`, releases maintenance admission, and disposes its timer and listener.

## Alternatives considered

**Age-based orphan recovery.** Rejected: elapsed time cannot prove that a live command stopped, and would falsely close a slow command.

**Abort-only compaction bounds.** Rejected: a provider can ignore `AbortSignal`, leaving the caller and maintenance lock waiting indefinitely.

## Consequences

A recovered session presents deterministic interrupted command and compaction outcomes instead of a permanent running row. A provider that ignores cancellation can continue in the background, but it cannot keep the compaction caller or durable bracket open beyond five minutes.

## Testing

Focused assembler, trajectory, compaction-basic, manual-compaction, and command-compact tests cover boundary replay, live pending protection, done preservation, never-settling summarizers, shared retry deadline, stable timeout code, and cancellation precedence.
