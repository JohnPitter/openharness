# Agent Note: Auto-compact after preset switch

Status: implemented

English | [中文](2026-08-24-preset-switch-auto-compact.zh.md)

## Problem

Recomposing a session after an `agent-preset/selected` change leaves history authored for the prior preset. That history contains stale tool calls and a stale prompt/tool-call surface, so the next request can ask the new composition to continue with incompatible context and break subsequent tool execution.

## Decision

The host keeps an in-memory `needsCompact` flag per session. A committed `recompose` plus `agent-preset/selected` sets the flag; the next ordinary `sessions.prompt` runs `compactAfterPresetSwitch` before admission. The operation is serialized on the existing per-session chain, invokes `/compact` through the commands service, and clears the flag only after successful compaction. Missing commands service or empty history is a no-op; a failure retains the flag and surfaces the error. Concurrent prompts therefore perform one compaction, and no durable event records this transient maintenance intent.

Compaction uses the current composition's system prompt and tools when summarizing. The resulting checkpoint removes stale per-preset history and presents the next model request with the tool-call surface selected by the active preset.

## Alternatives considered

**Compact immediately when the preset changes.** Rejected: switching presets without resuming the session would spend an unnecessary request.

**Persist the flag as a durable event.** Rejected: the flag is transient maintenance intent, not session history or model-visible state.

## Consequences

A resumed session is cleaned before its first ordinary prompt after a committed preset switch, without changing the append-only session log. Explicit compact commands and prompts without a committed switch retain their existing behavior. If compaction cannot run, the session remains marked for retry and the original error reaches the caller.

## Testing

`packages/host/apiproxy/tests/api-proxy-preset-compact.spec.ts` covers seven cases, including successful cleanup, no-op prerequisites, failure retry, chain serialization, and concurrent prompts.
