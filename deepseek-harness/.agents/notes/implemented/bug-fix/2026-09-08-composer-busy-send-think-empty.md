# Agent Note: Composer busy Send, Think summary markers, and empty Host prompts

Status: implemented

English | [中文](2026-09-08-composer-busy-send-think-empty.zh.md)

## Problem

Three independent defects share the composer and Host admission path.

The `ui-conversation.busyEnter` setting selects Queue or Steer for plain Enter while the agent is running. The running draft's Send button still called the public `InputActions.submit()` face, which `SessionInputShell.actions` fixes to `'queue'`, and the button stayed labeled `input.send` ("Send message"). A user who chose Steer got Steer from Enter and Queue from the button beside the same draft. The Settings row's title and description named only the Enter key. The [alpha.1 Send/Stop seat](../feature/2026-08-29-selective-upstream-fixes-dsh-0-1-2-alpha-1.md) already made a running draft take Send instead of Stop; it did not bind that click to the preference.

Collapsed Think summaries show the first or latest line of the reasoning block as raw text. Models wrap that line in Markdown bold (`**…**`), so the collapsed row displayed the asterisks.

The composer no-ops an empty trimmed draft, but `session.prompt` and `session.updateQueue` edit on ApiProxy accepted whitespace-only text. Image-only prompts must stay valid.

## Decision

The running Send button delivers through the same mode as plain Enter. `InputBar` computes `resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)` once per render. `steeringAvailable` is `subagent === null`: ordinary Sessions share the keyboard predicate; addressed children keep this fork's Queue-only continuation transport ([continuable subagent interrupt](../feature/2026-08-06-continuable-subagent-interrupt.md)). The primary click goes through `ComposerKeyboard.submit(mode)`. The label names Queue or Steer only when that click would deliver a plain message: running, steer-capable, enabled, non-empty, unclaimed, and not a `/` line headed for command adjudication. That state shows `input.send.queue` or `input.send.steer` (zh/en/pt/es); every other Send seat keeps `input.send`; an ordinary running session with an empty or owner-blocked draft still shows Stop. Cmd/Ctrl+Enter remains the opposite mode. The composer bar inject face publishes `hooks.busyEnter` instead of a resolver closure, and `resolveSubmitMode` is a pure function in `submission-policy.ts`. The Settings row is titled "Send behavior while busy" and describes Enter and the Send button; the `busyEnter` field, default, and Host schema are unchanged.

The collapsed Think summary strips every `**` from the first or latest line. Expanded `thinkBody` text is unchanged. The activity-summary fold is untouched.

`session.prompt` refuses content with neither non-whitespace text nor a non-text part, answering `bad-request` before Agent admission. Image-only (and whitespace-plus-image) prompts remain valid. A `session.updateQueue` edit of whitespace-only text answers the same code; non-text queue edits still fail as `attachment-error`. This fork has no generic file attachment type on the prompt wire, so "file-only" is image-only here.

## Alternatives considered

**Keep Send on Queue and only reword Settings.** The composer would still have two submission paths for one draft under one setting.

**Thread the mode through `InputActions.submit(mode)`.** The public provide-channel face would let any session-scope slot pick a delivery mode. `ComposerKeyboard.submit(mode)` already exists for the bar.

**Enable steering for continuable children to match upstream `dsh-v0.1.5-alpha.1`.** This fork's continuation transport stays Queue-only; changing that is outside these three defects.

**Rewrite the Think activity-summary fold.** The defect is literal `**` on the collapsed line. Expanding the fold would mix this port with unrelated presentation work.

**Add a dedicated RPC error code for empty prompts.** ApiProxy already maps semantic refusal onto `bad-request`; a new code would widen the isomorphic error table for one message.

## Consequences

Steer in Settings now produces Steer from both Enter and the running Send button, and the button announces the mode. Users who used the button as an always-Queue escape under Steer use Cmd/Ctrl+Enter instead. Continuable-child Send stays Queue with the plain label. Collapsed Think rows no longer show bold markers. Whitespace-only Host prompts and queue edits fail closed; image-only prompts still admit.

## Verification

`input-bar.client.spec.tsx` pins both preferences on the running button, live relabel, idle plain Send, slash and claimed-command plain Send, and attachment-only Queue naming. `submission-policy.client.spec.ts` pins the pure resolver. `enter-behavior-row.client.spec.tsx` and the settings-chrome ARIA goldens carry the new copy. `reasoning-row.client.spec.tsx` strips `**` from settled and streaming summaries without changing the expanded body. `api-proxy-empty-prompt.spec.ts` refuses whitespace prompts and queue edits and does not classify image-only content as empty.
