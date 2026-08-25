# Agent Note: Summarizer span ceiling and compaction progress

Status: implemented

English | [中文](2026-08-25-compaction-span-ceiling-and-progress.zh.md)

## Problem

On a 1M-context route the envelope-aware half-window cap still selected ~475k tokens for one summarizer call. K3 always thinks, so that request routinely missed the five-minute transaction deadline. `/compact` then showed "Command was interrupted before completion." The running row had only a spinner, so a live call looked frozen.

## Decision

`summarizerSpanBudget` still computes `floor(window / 2) - maxTokens - envelope`. A positive result is then `min(SUMMARIZER_SPAN_CEILING, that value)` with `SUMMARIZER_SPAN_CEILING = 65_536`. A zero envelope-aware result stays zero so pressure on a tiny advertised window remains uncapped. Pressure, overflow, and `compactNow` all go through that function.

When pressure retries land replacements that remain above threshold, `compactIfNeeded` returns the latest result instead of throwing. The next `agent/pre-step` continues from the replacement. A summary that does not shrink its source is still rejected inside the region transaction.

The Chat running row for `/compact` and an unmatched automatic `compaction/start` shows a determinate bar plus elapsed time. The bar fills toward the same five-minute deadline the host uses (`COMPACTION_OPERATION_TIMEOUT_MS`) and caps at 92% until the checkpoint lands. Progress is presentation-only: it is not a session event.

This extends the span cap in the [request-route pressure compact note](../bug-fix/2026-08-24-request-route-pressure-compact.md) and the deadline in the [interruption note](../bug-fix/2026-08-25-compaction-interruption-and-deadline.md). It does not introduce chunked multi-transaction summarization, which the [overflow-retry note](../bug-fix/2026-08-24-compaction-overflow-retry.md) already rejected.

## Alternatives considered

**Keep the half-window as the only cap.** Rejected: it is a fit bound for a 128K summarizer route, not a latency bound. On 1M it still sends a half-million-token request.

**Chunked multi-transaction summarization in one `/compact`.** Rejected: multiple lossy checkpoints in one command, and the overflow-retry note already declined that design. A later step or another `/compact` continues from the capped replacement.

**Log `compaction/progress` events or a live projection.** Rejected: percent and elapsed time are how to draw a running row. The session log stays the lock and the summary. Elapsed time from `command/run` or `compaction/start` is enough to prove the row is alive.

**Raise the five-minute deadline.** Rejected: a provider that ignores abort could hold maintenance admission even longer. Shrink the request so it finishes inside the existing bound.

## Consequences

A 128K route is unchanged (~39k envelope-aware budget, below the ceiling). A 1M route summarizes at most 65,536 priced tokens per call and is much more likely to finish before timeout. A session far above threshold may need more than one pressure step or `/compact` to drop occupancy. The running bar is an estimate against the deadline, not token-accurate generation progress.

## Testing

`compaction-basic.spec.ts` covers the ceiling on 272K and 1M windows, an unchanged 128K envelope-aware budget, and keeping the last replacement when still above threshold. Conversation-node specs cover a running automatic marker from unmatched `compaction/start` and hiding it after a failed `compaction/end`. `compaction-progress.client.spec.tsx` drives the determinate bar and the 250ms tick.
