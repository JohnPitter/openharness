# Agent Note: Workflow planner sends coding-standard excerpts, not whole files

Status: implemented

English | [中文](2026-08-23-workflow-planner-coding-standard-excerpts.zh.md)

## Problem

Workflow workers are faster, more concise models. They gather information and apply edits, but they skip software-engineering discipline that lives in `AGENTS.md`, package `AGENTS.md`, `CLAUDE.md`, and owning READMEs. Pasting those files into every `subagent` prompt would dominate worker tokens. The orchestrator already sees `agent-instructions` and cannot grep or read the tree itself.

The [orchestrator/worker split](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) owns tool restriction and the coordinator role; it does not own what the planner must put in a code-edit prompt.

## Decision

The workflow orchestrator persona requires, for a delegated task that creates or edits code, short coding-standard excerpts plus the instruction-file paths to follow — never a paste of the whole file. The excerpts name only the rules that apply to that change (naming, tests, layering, error handling, and what not to invent). Paths let the worker read the rest. `WORKFLOW_WORKER_PERSONA` tells the child to honor those excerpts and named files, and not to invent a conflicting architecture or skip named tests.

Guidance is persona-only. The standing mount still contributes `agent-instructions` to joined children; the task excerpts are the extra, attention-getting copy the faster worker actually follows.

## Alternatives considered

**Paste entire `AGENTS.md` / `CLAUDE.md` into every code-task prompt.** Rejected because the token cost repeats on every worker and drowns the task.

**Rely on `agent-instructions` alone.** Rejected because worker models treat that bulk as background and skip the engineering bar.

**Put the same excerpts into `WORKFLOW_WORKER_PERSONA` as a fixed catalog.** Rejected because the relevant bar depends on the change; a fixed catalog is either incomplete or another full-file dump.

**Have the planner delegate a first worker whose only job is to read instruction files.** Rejected as an extra round trip when the planner already has `agent-instructions` and can quote the applicable lines.

## Consequences

Code-task worker prompts stay short: a few quoted rules and file pointers. Workers that need more can read the named files. Non-code delegations are unchanged. The orchestrator still cannot inspect the tree; excerpts come from its own instruction context and from earlier worker reports.

## Testing

`workflow-orchestrator.spec.ts` pins `WORKFLOW_WORKER_PERSONA` to mention coding-standard excerpts. The orchestrator paragraph lives in `apps/cli/config/agent-presets/workflow/agent.cordis.yml`.
