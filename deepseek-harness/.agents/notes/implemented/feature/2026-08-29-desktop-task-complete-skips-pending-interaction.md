# Agent Note: Desktop task-complete chime skips a pause for user interaction

Status: implemented

English | [中文](2026-08-29-desktop-task-complete-skips-pending-interaction.zh.md)

## Problem

`watchDesktopTaskComplete` (`packages/client/ui-conversation/src/client/desktop-complete.ts`) tells the OpenHarness shell to chime and, if backgrounded, raise a system notification whenever a root (non-subagent, parent-less) session's `running` bit flips from true to false. `running` reflects only whether the host is actively driving a turn right now, not whether the user's task is actually finished: the agent loop also sets it false the moment the session blocks on an approval prompt, a plan review, or an `ask_user_question` call — cases the sidebar already marks with its own amber pending-interaction dot. The chime fired on that pause exactly as it does on real completion, so the desktop app announced "done" while the session was still waiting on the user mid-task.

## Decision

`rootTaskCompletions` now requires `row.pendingInteraction === undefined` in addition to the existing running-bit edge before it reports a completion. `SessionSummary.pendingInteraction?: PendingInteractionStatus` (`'approval' | 'plan-review' | 'question'`) already carries this exact signal for the sidebar's pending-interaction indicator, host-populated and cleared through the same list projection `rootTaskCompletions` already reads, so no new field or event was needed. The running-bit diff (`prev`/`next`) still records the paused `running: false` as-is; when the user answers and the agent resumes then genuinely finishes, the next true→false edge has no pending interaction and chimes normally. Subagent and child rows stay excluded exactly as before — `isRootTaskSession` is unchanged.

## Alternatives considered

**Suppress the chime with a client-side timer instead** (e.g. don't chime if a question appears within N seconds). Rejected: a timer is a race against real host latency and would still misfire or add a visible delay to genuine completions; `pendingInteraction` is the authoritative signal for the exact same case already, sourced from the host.

**Move the check into `watchDesktopTaskComplete`'s sink instead of `rootTaskCompletions`.** Rejected: the completion decision belongs in the pure diff function so it stays unit-testable without a store/window fixture, matching the existing split between decision (`rootTaskCompletions`) and delivery (`watchDesktopTaskComplete`/`postDesktopTaskComplete`).

## Consequences

A root session that pauses for an approval, a plan review, or a question no longer chimes or raises a background notification; the eventual real idle (no pending interaction) still does, including after the user answers and the agent continues and finishes. Any future `PendingInteractionStatus` variant is covered by the same `undefined` check with no code change.

## Verification

Table-driven unit coverage in `packages/client/ui-conversation/tests/desktop-complete.client.spec.ts` exercises all three `PendingInteractionStatus` values pausing without a chime, and a full running → pending-question → resumed → genuinely-idle sequence through `rootTaskCompletions` asserting no chime on the pause and exactly one chime on the real completion.
