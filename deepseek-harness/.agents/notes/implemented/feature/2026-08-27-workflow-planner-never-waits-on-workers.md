# Agent Note: Workflow planner never waits on workers

Status: implemented

English | [中文](2026-08-27-workflow-planner-never-waits-on-workers.zh.md)

## Problem

A Workflow planner that waits in the foreground for one `subagent` call keeps its turn running until that worker finishes. The composer then queues or steers later user instructions instead of starting a new planner turn, and the planner cannot launch workers for remaining independent tasks until the first child returns.

`backgroundMode: continuable` already defaults an omitted `run_in_background` to background, but an explicit `false` still waits. Planner models treat “next action depends on the result” as the common case, so they wait on every dispatch.

The [orchestrator/worker split](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) owns the think/execute catalog. The [background-first continuable default](2026-08-11-background-first-continuable-delegation.md) owns omitted-argument resolution for instances that still allow a foreground override. Neither forbids that override.

## Decision

`dsh-tool-subagent` accepts `foregroundWait: 'allowed' | 'never'` (default `allowed`). `never` omits `run_in_background` from the schema, always takes the background route, and rejects an explicit `false` at execute. Schema and capability stay aligned: the model cannot request a wait this instance will not honor. `never` plus `enableRunInBackground: false` fails at apply.

The Workflow preset's spawn `subagent` row sets `foregroundWait: never` with `backgroundMode: continuable`. The orchestrator persona states that each call returns immediately, independent tasks start together, the planner stays ready for further user instructions, and remaining work launches further workers. Worker outcomes still arrive as [manager-owned settlement notices](2026-08-06-manager-owned-subagent-settlement-delivery.md).

Other presets keep `foregroundWait: allowed`. Fork, Codex, and Claude Code tool rows on the Workflow standing mount are unchanged: the planner cannot see fork, and the product rows stay disabled.

## Alternatives considered

**Rely on persona and the existing continuable default.** The model can still pass `false`, and that call holds the planner turn for the whole worker. Prompt-only preference is the defect this config exists to close.

**Force background only inside `restrictWorkflowOrchestrator`.** Execute-time override while the schema still offers `false` is a schema/capability disagreement this package already rejects for `enableRunInBackground: false`.

**Set `enableRunInBackground: false` on the Workflow tool.** That option omits the parameter and always waits in the foreground, the opposite of the required schedule.

**Add a second omitted-argument default.** [Background-first](2026-08-11-background-first-continuable-delegation.md) already rejected a default that can disagree with `backgroundMode`. `foregroundWait: never` removes the foreground route; it does not pick a new omitted-argument default.

## Consequences

A Workflow planner dispatch returns `{ kind: 'continuable', subagentId }` and releases the parent turn. The user can send further instructions while workers run, and the planner can start more children in the same or later turns. A model that still passes `run_in_background: false` receives an errored tool result naming `foregroundWait: never`. Standard, Code, and Cordis presets still wait when the model asks. Package tests pin schema omission, the rejected `false`, and apply-time conflict with disabled background; `web-agent-presets.e2e.ts` pins the Workflow persona, `tool:subagent` guidance, and omitted parameter.
