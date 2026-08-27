# Agent Note: Workflow orchestrator thinks; workers execute

Status: implemented

English | [中文](2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md)

## Problem

Workflow mode selected a planner model and a worker model, but the root session kept the full coding tool catalog and a persona that allowed “a small change” to be done by the orchestrator. The planner could grep, edit, and run shell, so the worker model did not own information-gathering or implementation.

## Decision

The workflow standing mount still registers the same tools as `standard` so in-process children inherit grep, filesystem, and shell. After a root workflow agent publishes, `restrictWorkflowOrchestrator` denies those work tools on that agent's scope only, including `milestone_write`; the [session-milestones note](../feature/2026-08-23-session-milestones.md) owns why the worker writes the index. Children join the standing mount as siblings, not as nested scopes under the parent agent, so the denial does not reach them. In-process children of a workflow parent receive `WORKFLOW_WORKER_PERSONA` unless the start request already named a persona. The orchestrator persona and the `workflow` tool's `tool:<toolName>` prompt section name `subagent` as the only path for one or two tasks: `workflow` runs a JavaScript script that starts workers through `agent()`, and is not a shell or a substitute for grep, edit, or pwsh. The Workflow spawn `subagent` tool sets `foregroundWait: never`, so a dispatch never waits for the worker; the [never-wait note](../feature/2026-08-27-workflow-planner-never-waits-on-workers.md) owns that scheduling policy. When a delegated task creates or edits code, the orchestrator persona requires short coding-standard excerpts plus instruction-file paths in the worker prompt, not a paste of the whole `AGENTS.md`; the [coding-standard excerpts note](../feature/2026-08-23-workflow-planner-coding-standard-excerpts.md) owns that prompt policy.

## Alternatives considered

**Strip work tools from the workflow preset file.** Children `composeFrom` the same standing mount, so they would lose grep and edit too.

**Keep tools and change only the persona.** The model can still call grep and edit; persona is not enforcement.

**Treat `subagent` and `workflow` as interchangeable in the orchestrator persona.** The planner then calls `workflow` as a stand-in for the denied shell, and a script that returns without `agent()` starts zero workers. Naming `subagent` as the one-or-two-task path and stating that `workflow` is not a shell is the cheaper correction than hiding the tool.

**Hide the `workflow` tool from the orchestrator catalog.** Large fan-out still needs the script; the misuse is substituting it for grep, edit, or pwsh, not the capability itself.

**Parent the child scope under the orchestrator agent and allow-list tools on the child.** Ancestor restrictions already propagate to nested scopes, so a parent deny would hide tools from workers unless the child re-registered them. Sibling join plus parent-only restrict matches the existing createScope topology.

## Consequences

A workflow root cannot call grep, edit, or shell even if it ignores the persona. Workers still can. A start request that passes its own persona replaces the worker default. Out-of-process product providers are unchanged. The planner still sees the `workflow` tool; guidance, not a catalog restriction, steers one-or-two-task work onto `subagent`. A Workflow `subagent` call returns immediately; the planner stays free for further user instructions and further workers. Code-creating workers receive only the excerpts the planner put in the task, plus whatever `agent-instructions` the standing mount already contributes. Prefix cuts that omit `skill`, Ralph, fork, the planner J-space protocol, and denied-tool guidance are owned by the [unusable-context note](../simplification/2026-08-27-workflow-planner-omits-unusable-context.md).
