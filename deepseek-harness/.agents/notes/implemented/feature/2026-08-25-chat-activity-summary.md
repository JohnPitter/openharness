# Agent Note: Condense consecutive chat activity into one summary row

Status: implemented

English | [中文](2026-08-25-chat-activity-summary.zh.md)

## Problem

An agent turn interleaves many tool-call and command nodes, and rendering each as its own card makes the conversation surface unreadable during long exploration or editing runs. Condensing the run cannot lose information: the user still needs per-category counts, a live in-progress signal, and a way to reach the original cards in order, and anchors such as user text, assistant text, compaction, milestones, turn tails, and context injections must keep their own rendering and positions.

## Decision

Grouping is a pure view-layer fold. `groupActivityNodes()` in `packages/client/ui-conversation/src/client/chat/activity-groups.ts` scans the root chat-node list once and folds every run of two or more consecutive activity nodes into one `ActivityGroup` carrying the original nodes in order, per-category counts (`explored`, `edits`, `searches`, `commands`, `web`, `subagents`, `other`), and a running flag derived from the member states. Activity nodes are tool calls, commands, and assistant steps whose blocks are tool-call and/or reasoning only; an assistant step carrying a visible text block is the turn's reply and anchors like a user message. A reasoning-only assistant step (a Think summary) is a transparent member: it joins the run and renders in its original position on expansion, but adds no category count, so interleaved reasoning never splits one turn's work into separate summary rows. A run whose members are all transparent (zero total count) renders its nodes individually instead of a header-less group. Any other anchor node — user or assistant text, compaction card, milestone, turn tail/retry/max-tokens, context injection — breaks the run and renders normally, and a singleton activity node also renders normally; nothing is folded that cannot be restored exactly.

`ChatView.tsx` renders a group as `ActivitySummaryRow.tsx`: one Cursor-style summary line with localized per-category counts and an in-progress state, plus a chevron toggle that expands the member cards in their original order and collapses again. Expansion state lives in the declared chat store (`activityExpanded` keyed by group key, with `setActivityExpanded` as the only mutation), created per session through the store factory at register time. The entry is marked `transient`: it survives remounts within the session and resets on a full reload, and it is never persisted or replayed.

The feature is client-only. The summary row is a pure function of the existing chat-node projection: no session event, Host contract, or wire field changes, and replay recomputes the same grouping from the same nodes. Copy is localized in all four registered locales (zh, en, pt, es) in `locales.ts`; the group view type is declared in `contract/views.ts`, with the runtime contract store and the ui-slots store carrying the matching declarations.

## Alternatives considered

**Collapse activity on the Host or in the session projection.** Rejected because condensation is presentation, not session data: the web layer stays pure presentation, folding in the view keeps the log, replay, search, and token accounting untouched, and no model-visible fact changes.

**Persist expansion state across reloads.** Rejected because expansion is viewing state with no durable value; the declared transient store gives remount survival within a session without adding a persistence or replay contract.

**Group only by tool name or drop the running signal.** Rejected because per-category counts answer "what did the agent do" at a glance, and a summary that hides an in-progress call would misrepresent a live turn.

**Fold singleton activity nodes too.** Rejected because wrapping one card in a toggle adds a click without saving space; singletons render normally.

## Consequences

Long activity runs render as one summary row per run, with anchors and singletons keeping their exact positions and renderers. Expansion is per-session and ephemeral by design, so a reloaded page always starts collapsed. Because grouping is derived at render time, any change to the chat-node projection or to category classification changes summaries without touching stored data, and every locale must carry the summary copy for the typed locale registry to accept a build.

## Verification

No subsystem reference owns the chat activity surface, so this note is the decision record; the chat UI surface is not documented under `docs/subsystems`. Focused component and unit coverage under `packages/client/ui-conversation` exercises run detection and anchor breaks in `groupActivityNodes`, singleton passthrough, per-category counting, the running flag, chevron expand/collapse ordering, per-session transient expansion state across remounts, the zh/en/pt/es summary copy, and the reasoning-transparency regression: a Think step no longer splits one run into two summary rows, a transparent step keeps its expansion order without counting toward any category, a run of only transparent steps falls back to individual nodes instead of a header-less group, and a step mixing reasoning with an inline tool-call block counts under `other`.
