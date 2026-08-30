# Agent Note: Desktop task-complete chime skips a pause for user interaction or a still-running subagent

Status: implemented

English | [中文](2026-08-29-desktop-task-complete-skips-pending-interaction.zh.md)

## Problem

`watchDesktopTaskComplete` (`packages/client/ui-conversation/src/client/desktop-complete.ts`) tells the OpenHarness shell to chime and, if backgrounded, raise a system notification whenever a root (non-subagent, parent-less) session's `running` bit flips from true to false. `running` reflects only whether the host is actively driving a turn right now, not whether the user's task is actually finished, and two distinct cases made that gap visible: the agent loop sets `running` false the moment the session blocks on an approval prompt, a plan review, or an `ask_user_question` call — cases the sidebar already marks with its own amber pending-interaction dot — and a Workflow planner's own turn can end (`running: false`) immediately after it dispatches a worker, well before that worker (or a worker it dispatches in turn) finishes. Both chimed exactly as real completion does, so the desktop app announced "done" while the session was still waiting on the user or a subagent it started was still working.

## Decision

`rootTaskCompletions` now gates a completion on two conditions beyond the running-bit edge: `row.pendingInteraction === undefined`, and no running descendant. `SessionSummary.pendingInteraction?: PendingInteractionStatus` (`'approval' | 'plan-review' | 'question'`) already carries the pause signal for the sidebar's pending-interaction indicator, host-populated and cleared through the same list projection `rootTaskCompletions` already reads, so no new field or event was needed for that half. For the subagent half, a new `hasRunningDescendant(sessionId, byId)` walks `byId` for any row whose `parentId` chains back to this session with `running: true`; `byId` carries every attached session the host reports — including subagent children — regardless of whether any catalog UI panel is open, because the host's `sessions.list` includes every currently-attached (in-memory) session, not only ones a client has expanded. A root's tracked "busy" bit (the `prev`/`next` map) is therefore `row.running || hasRunningDescendant(...)`, not the raw running bit: a planner that idles right after dispatching a still-working subagent stays busy in that map until the subagent (and any of its own descendants) also finishes, so the eventual real idle — no running descendant left, and no pending interaction — is still detected as a true→false edge and chimes exactly once. Subagent and child rows stay excluded from firing their own completion exactly as before — `isRootTaskSession` is unchanged.

## Alternatives considered

**Suppress the chime with a client-side timer instead** (e.g. don't chime if a question or a subagent appears within N seconds). Rejected: a timer is a race against real host latency and would still misfire or add a visible delay to genuine completions; `pendingInteraction` and the subagent catalog rows are both authoritative signals already sourced from the host.

**Check only direct children, or read the currently-open subagent catalog instead of `byId`.** Rejected: a subagent could itself dispatch a further subagent (nested Workflow delegation), so only a full descendant walk catches every level; the catalog (`subagentsByParent`) is lazily populated only for parents a client has explicitly opened, which would miss the exact background case — window not focused, catalog never opened — this fix exists for. `byId` needs no such precondition.

**Move either check into `watchDesktopTaskComplete`'s sink instead of `rootTaskCompletions`.** Rejected: the completion decision belongs in the pure diff function so it stays unit-testable without a store/window fixture, matching the existing split between decision (`rootTaskCompletions`) and delivery (`watchDesktopTaskComplete`/`postDesktopTaskComplete`).

## Consequences

A root session that pauses for an approval, a plan review, or a question no longer chimes or raises a background notification; neither does one that idled only because it just dispatched a subagent that (or whose own descendants) is still running. The eventual real idle — no pending interaction, no running descendant — still chimes, including after the user answers and the agent continues and finishes, or after the last dispatched subagent completes. Any future `PendingInteractionStatus` variant is covered by the same `undefined` check with no code change; any depth of nested subagent delegation is covered by the same recursive descendant walk.

## Verification

Table-driven and sequence-based unit coverage in `packages/client/ui-conversation/tests/desktop-complete.client.spec.ts` exercises: all three `PendingInteractionStatus` values pausing without a chime; a full running → pending-question → resumed → genuinely-idle sequence asserting no chime on the pause and exactly one chime on the real completion; a Workflow planner idling right after dispatching a still-running worker (no chime, busy bit stays true); the eventual chime once the last running descendant finishes even though the root went idle earlier; a running grandchild followed through a nested subagent chain; and a subagent row never firing its own completion regardless of its parent's state.
