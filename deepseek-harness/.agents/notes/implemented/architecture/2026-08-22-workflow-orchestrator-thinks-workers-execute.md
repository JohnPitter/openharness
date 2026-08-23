# Agent Note: Workflow orchestrator thinks; workers execute

Status: implemented

English | [中文](2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md)

## Problem

Workflow mode selected a planner model and a worker model, but the root session kept the full coding tool catalog and a persona that allowed “a small change” to be done by the orchestrator. The planner could grep, edit, and run shell, so the worker model did not own information-gathering or implementation.

## Decision

The workflow standing mount still registers the same tools as `standard` so in-process children inherit grep, filesystem, and shell. After a root workflow agent publishes, `restrictWorkflowOrchestrator` denies those work tools on that agent's scope only. Children join the standing mount as siblings, not as nested scopes under the parent agent, so the denial does not reach them. In-process children of a workflow parent receive `WORKFLOW_WORKER_PERSONA` unless the start request already named a persona. The orchestrator persona tells the model those work tools are unavailable and that every inspect-or-mutate step must be delegated.

## Alternatives considered

**Strip work tools from the workflow preset file.** Children `composeFrom` the same standing mount, so they would lose grep and edit too.

**Keep tools and change only the persona.** The model can still call grep and edit; persona is not enforcement.

**Parent the child scope under the orchestrator agent and allow-list tools on the child.** Ancestor restrictions already propagate to nested scopes, so a parent deny would hide tools from workers unless the child re-registered them. Sibling join plus parent-only restrict matches the existing createScope topology.

## Consequences

A workflow root cannot call grep, edit, or shell even if it ignores the persona. Workers still can. A start request that passes its own persona replaces the worker default. Out-of-process product providers are unchanged.
