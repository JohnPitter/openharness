# Agent Note: Workflow planner omits unusable construction context

Status: implemented

English | [中文](2026-08-27-workflow-planner-omits-unusable-context.zh.md)

## Problem

A Workflow root cannot grep, read, or edit, yet every planner request still paid for construction context that only those tools can use. The J-space protocol instructed a `skill` load and then Read; `skill` and `ralph` stayed in the catalog (`ralph` up to 64 fresh-child rounds); `subagent_fork` would seed a coding worker with the coordinator transcript. Denied tools already dropped their schemas, but `tool:read` / `edit` / `grep` and the sibling sections still told the planner to use them.

That prefix is billed on token-metered routes and still occupies the window on request-metered routes; a `skill` or Ralph call is an extra request on both. The [orchestrator/worker split](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) owns the think/execute catalog; it did not own this leftover construction context. Coding-standard excerpts still require the planner's `agent-instructions` baseline, so dropping the 64k mount is not an efficiency available here.

## Decision

`restrictWorkflowOrchestrator` also denies `skill`, `ralph`, and `subagent_fork` on a depth-0 Workflow agent. In-process workers join the standing mount as siblings and keep `skill` (and fork). The Workflow preset file sets `tool-ralph` `disabled: true`, so neither planner nor worker loads the Ralph loop. The orchestrator persona forbids loading j-space or any other skill and tells the planner to name a construction pass in the `subagent` task.

The Host `jspace:protocol` section is empty when the assembling agent is preset `workflow` at delegation depth 0. Workers at depth ≥ 1 still receive the protocol while the toggle is On. Bare `assemble()` without an agent still injects it. The composer J-space row is hidden on both Workflow pickers (`role` is set). `JSPACE_DEFAULT_ENABLED` and `hideFromModel('j-space')` for the Off toggle are unchanged; a global hide would strip the skill from workers.

Tool-guidance sections for `read`, `edit`, `write`, `grep`, `glob`, `bash`, `pwsh`, `jobs`, `web_search`, `web_fetch`, and `ralph` render empty text when `ctx.tools.get(name, context.scope)` is undefined, matching `tool:subagent`. Standard and Workflow workers are unaffected because those tools stay visible.

`workflow`, `todo`, goal tools, `list_agents`, `send_message`, `interrupt_agent`, planner `agent-instructions`, worker `maxBytes`, and auto-compaction are unchanged.

## Alternatives considered

**Skip `agent-instructions` on the Workflow planner.** Rejected: worker excerpts are quoted from what the planner saw; bulk instructions on the worker are treated as background.

**Empty J-space on Workflow workers as well.** Rejected: the worker is the implementation agent and can Read skill modules.

**`hideFromModel('j-space')` for the Workflow session.** Rejected: hide is process-global and would remove the skill from workers.

**Strip `skill` / Ralph from the Workflow YAML.** Rejected for `skill`: workers `composeFrom` the same mount. Accepted for Ralph: neither role needs a 64-round loop.

**Leave denied-tool `tool:*` prose in place.** Rejected: it contradicts the catalog and is paid on every planner request.

## Consequences

A Workflow planner cannot load a skill, start Ralph, or fork its coordinator transcript. Workers still load skills and honor J-space while On. Off still hides `j-space` from every model on the host. Request-metered and token-metered providers both drop the wasted planner prefix and the wasted construction tool-calls.

## Testing

`workflow-orchestrator.spec.ts` pins the deny list against a sibling child. `web-agent-presets.e2e.ts` pins the orchestrator persona, omitted schemas, empty `jspace:protocol`, and empty `tool:read`. `host.client.spec.ts` and `jspace-settings.client.spec.ts` pin planner-only omission. `model-select.client.spec.tsx` hides the J-space row on both Workflow pickers.
