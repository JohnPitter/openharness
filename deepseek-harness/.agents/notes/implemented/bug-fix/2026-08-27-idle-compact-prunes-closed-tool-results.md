# Agent Note: Idle `/compact` prunes closed tool results

Status: implemented

English | [中文](2026-08-27-idle-compact-prunes-closed-tool-results.zh.md)

## Problem

`compactNow` — `/compact` and the host's compact-after-preset-switch path — prunes oversized tool results on an idle agent, then opens a standalone `turn: null` compaction bracket. The session invariant treated a `tool/result` surface replacement as turn-enclosed work and rejected it with no open turn. Automatic pressure prune still ran, because `agent/pre-step` already has `turn/start`. Manual compact did not.

Workflow makes the miss user-visible. The planner log is mostly large `subagent` results, and switching onto the Workflow preset always queues `/compact` before the next prompt. That prune threw, the command failed, and the prompt was not admitted. Standard sessions with oversized tool results hit the same idle path.

A live `tool/result` append still names an open step. The rewrite is not a second execution of that call; it is the same class of idle surface rewrite as a compaction checkpoint `user/message`.

## Decision

The session invariant admits a `tool/result` replacement with no open turn. Live appends still require the open step and the in-step `tool/call` pairing. `compactNow` keeps pruning before it opens the standalone bracket. Automatic prune during an open turn is unchanged.

## Alternatives considered

**Open a dummy turn around idle prune, then close it before the `turn: null` bracket.** Rejected: `compactNow` refuses an open turn, so the dummy turn would have to close before summarization, adding a turn envelope that is not compaction work.

**Skip prune in `compactNow` when no turn is open.** Rejected: idle `/compact` is the recovery path that most needs to shrink huge tool results before the summarizer runs. Skipping it reintroduces the [summarizer overflow on a full surface](2026-08-24-request-route-pressure-compact.md).

**Allow only replacements that follow `compaction/prune`.** Rejected: prune appends the shadow-price event and the replacement as adjacent writes; the invariant would have to special-case an event the session package does not own, and the replacement is already validated as a single-node content rewrite.

## Consequences

`/compact` and compact-after-preset-switch prune on a closed session. Workflow parents with large `subagent` results can compact while idle. A live `tool/result` append outside an open step still fails.

## Testing

`packages/core/session/tests/invariant.spec.ts` admits a replacement after `turn/end`. `tool-result-pruner.spec.ts` prunes a closed session under real invariants. `manual-compaction.spec.ts` drives `compactNow` through an idle closed log that holds an oversized `subagent` result, with `SessionInvariant` loaded, and expects `compaction/prune` plus a committed checkpoint.
