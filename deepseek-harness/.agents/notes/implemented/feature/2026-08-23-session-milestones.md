# Agent Note: Session milestones

Status: implemented

English | [中文](2026-08-23-session-milestones.zh.md)

## Problem

The transcript is a chronological log, not an index. After a long session, compaction, or a Workflow worker returning to the parent, the human cannot jump to a decided fact, and the model cannot recover titles that a checkpoint dropped. Folding the whole transcript into the system prompt would grow without bound. Quota policy for auxiliary LLM calls is a separate decision; see the [route-metering note](2026-08-23-route-metering.md).

## Decision

The model that closes the work writes the fact through `milestone_write({ title, body, anchorSeq? })` in `@deepseek-ai/dsh-tool-milestone`. Each call appends a `milestone/write` event (branded `MilestoneId`, append-only). A live parent of a delegated child receives a mirror with `origin: 'worker'` and `childSessionId`; a missing parent does not fail the child write.

Workflow hides `milestone_write` from the orchestrator via `WORKFLOW_ORCHESTRATOR_WORK_TOOLS` and tells the worker to write in the same tool step that closes the work. Standard and Code sessions use the session model. The [orchestrator-tools note](../../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) remains the owner of hiding work tools; this note owns why the index is written by the worker.

The model-visible index is the titles-only runtime-context snapshot `milestone:index` (`ctx.systemPrompt.context`, order 125). The channel rewrites only when the folded titles change. Compaction-basic appends those titles under Critical Context so the checkpoint keeps the index.

The conversation UI folds `milestone/write` into a `milestone` Chat Node (collapsed chip, expandable body) and a left rail of milestone titles plus user-message waypoints that jump through `[data-chat-anchor-key]`. The rail lives in a full-flow overlay and sticks to the conversation scrollport; it shows dots by default and reveals titles on hover, keyboard focus, or click. A waypoint click pins the titles open; the pinned rail closes through its close button, Escape, a pointer down outside it, or a click on its own background (only the pinned rail receives background pointer events, so a collapsed rail never blocks the transcript gutter). At viewport widths of 720px or less, the pinned rail becomes an absolute overlay capped at `min(168px, calc(100vw - 16px))` with ellipsized labels, while the collapsed rail keeps zero footprint.

## Alternatives considered

**Treat the transcript as the index.** Search and scroll do not survive compaction, and a parent that never saw the worker's tool calls has no chip to jump to.

**Grow a standing system-prompt section with titles and bodies.** Bodies are long; the runtime-context snapshot already updates when the fold changes, and titles alone are the lookup key.

**Let the orchestrator write milestones.** The planner never executed the work; a title written before the worker returns is a guess. Hiding the tool matches the existing work-tool restriction.

**Replace earlier milestones on a later write.** Corrections would mutate history the rail and compact instruction already cited. Append-only keeps replay and jump targets stable.

**Skip compact instruction seeding and hope the summarizer copies titles from the transcript.** A pressure checkpoint can drop the only copy of a title that lived in a shadowed range.

## Consequences

Every session that mounts `tool-milestone` exposes `milestone_write` except a Workflow root. The parent log carries worker-origin mirrors, so the rail and index are visible on the human's session. Compaction still summarizes; it is instructed not to drop recorded titles. There is no edit or delete. Auxiliary LLM skip on request-metered routes is not this package's policy.

## Testing

Package tests cover execute, parent mirror, runtime-context snapshot, Workflow hide/persona, compaction instruction seeding, Chat Node fold, rail jump, and locales zh/en/pt/es. `pnpm run gen-persistence-catalog` and `pnpm run gen-tool-catalog` refresh the generated event and tool vocabulary after `milestone/write`.
