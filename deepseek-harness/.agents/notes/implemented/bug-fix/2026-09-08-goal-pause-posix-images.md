# Agent Note: User-owned goal pause and POSIX assistant-message images

Status: implemented

English | [中文](2026-09-08-goal-pause-posix-images.zh.md)

## Problem

`update_goal resume` under `requireDirectHuman` could lift a durable paused goal in the same turn the user paused it, so the model could undo a user stop. GoalBar showed resume only for `phase === 'paused'`, so an active-but-disarmed (inactive) goal after session restore or fork offered pause, not resume.

Assistant markdown required absolute HTTP(S) image destinations. POSIX absolute paths in closing prose (`/tmp/…`, including screenshots outside a registered workspace) rendered as alt text.

## Decision

Resuming a durable paused goal is a user action. `update_goal resume` rejects a matching current goal with `phase === 'paused'` (`GOAL_TOOL_RESUME_PAUSED`) before calling the goal service. Rearming an active-but-disarmed goal and resuming `blocked` stay allowed. Prompt guidance and the `update_goal` description tell the model not to resume a paused goal.

GoalBar pause is `phase === 'active' && activation === 'armed'`. Resume is `phase === 'paused'` or `phase === 'active' && activation === 'disarmed'`. The strip label for the latter is `phase.active.disarmed` (zh/en/pt/es). Live activation stays process-local: `GoalService.get` is `@Remote('get')`, `goal/activation-changed` is JSON-safe and allowlisted, and ui-goal injects `createGoalActivationSource` over `goals.get`, that event, and `connection/reset`. Mutations remain `ctx.remote.goals`; ApiProxy `GoalsApi` stays mutation-only.

Settled `MarkdownText` accepts an optional `pathImages` vocabulary. `AssistantMarkdown.localPathMediaUrl` maps POSIX absolute destinations on an HTTP(S) page to `${origin}/api/file?path=`. Failed loads show alt or the original path. Streaming renders keep the vocabulary off. ApiProxy serves `GET`/`HEAD /api/file` through optional `downloads.file` and `ctx.fs`, using attachment `maxImageBytes`. POSIX `/` paths are accepted even when Node `path.isAbsolute` is false on Windows. `downloads.file` is optional so the connection fixture is unchanged.

## Alternatives considered

**Persist activation on the durable goal projection.** Rejected: activation is process-local by design; folding it into `goal` would arm restored sessions.

**Forward scoped `goal/changed` to the browser.** Rejected: the payload carries Agent and is not JSON-safe for `ctx.remote.$on`.

**Prompt-only restraint without `GOAL_TOOL_RESUME_PAUSED`.** Rejected: the tool executor must deny the call.

**A second image pipeline or a new gateway.** Rejected: this fork has ApiProxy, not session-controller/`@Remote` gateway fetch. The Host path is the same GET-download family as `session.export`.

## Consequences

The model cannot resume a user-paused goal; GoalBar resume covers paused and inactive goals. Assistant closing prose can show POSIX absolute images when the Host has `ctx.fs`. Typert `goals.get` must be regenerated for a live UI. Windows native `C:\…` destinations stay inert. The connection fixture does not implement `goals/get` or `/api/file`.

## Testing

`tool-goal` rejects paused resume and still rearms disarmed-active via the tool. `goal` pins `goal/activation-changed` across create, session-start, and resume. ui-goal covers GoalBar armed/disarmed controls and the activation source. ui-primitives and ui-conversation cover `pathImages` and `localPathMediaUrl`. apiproxy covers `/api/file` routing and POSIX path rejection.
