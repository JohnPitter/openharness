# Agent Note: Runtime cache false adoption

Status: implemented

English | [中文](2026-08-25-runtime-cache-false-adoption.zh.md)

## Problem

The embedded runtime extraction cache could silently adopt a stale runtime tree. When the content stamp differed, `adoptRuntime` used `onDiskMatchesEmbed` as a shortcut; that check covered only `node.exe` size, the CRC of `dsh-runtime/lib/bin.js`, and the existence of `dsh-runtime/package.json`. A tree passing those checks received the new stamp without extraction. Runtime fixes shipped in v0.1.20 through v0.1.24 therefore remained absent from affected machines, making the context-overflow classification and compaction fixes appear broken. Forensic evidence included the current stamp `c1bd763daeeb4c211b6b506d24618dc49f7a4f61` beside mixed-age library files spanning August 22–24; `@deepseek-ai/dsh-llm-pi-ai/lib/index.js` was stale and lacked the v0.1.24 context-overflow classification.

## Decision

A stamp mismatch always runs the incremental `unzipRuntime` pass, and the stamp is written only after extraction succeeds. The unsound `onDiskMatchesEmbed` shortcut is removed from `internal/sidecar/sidecar.go:133-137` and its sibling path at `:151-155`. A stamp-file format epoch makes stamps produced by the old logic untrusted exactly once, so a machine with a corrupted tree self-heals; subsequent launches use the cheap fast path. Incremental extraction skips entries whose size and CRC already match and rewrites only changed files.

The delivered runtime also classifies pi-ai context-overflow errors as `CONTEXT_WINDOW_EXCEEDED`, and `/compact` retries within one transaction while halving the summarizer span budget. The default summarizer `maxTokens` is 8192; an explicit value such as 128000 against a 272000-token window can leave a zero span budget, which span halving cannot recover.

## Alternatives considered

**Keep the three-field `onDiskMatchesEmbed` validation.** Rejected: stable sentinel files can match while other runtime files are stale, so the check cannot prove that the extracted tree matches the embedded content.

**Delete and fully re-extract the runtime on every mismatch.** Rejected: incremental extraction preserves the cache's performance while repairing genuinely changed entries.

## Consequences

Existing installations with an old current-looking stamp perform one self-healing extraction pass and then resume the fast path. A failed extraction leaves the previous stamp in place, so a later launch retries instead of blessing a partial tree. Compaction recovery is deliverable with the runtime files that the executable actually extracts.

## Testing

Regression tests in `internal/sidecar/` cover stamp mismatches that require extraction, old-format stamp self-healing, stamp-write ordering after extraction failure, and incremental skipping of matching entries. The runtime compaction tests cover context-overflow classification and in-transaction span-halving retries.
