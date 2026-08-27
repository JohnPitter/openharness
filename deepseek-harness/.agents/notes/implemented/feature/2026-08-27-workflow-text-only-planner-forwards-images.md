# Agent Note: Workflow text-only planner admits images for vision workers

Status: implemented

English | [中文](2026-08-27-workflow-text-only-planner-forwards-images.zh.md)

## Problem

`sessions.prompt` admits image parts only when the **session** (planner) model declares `image` in `inputModalities`. In Workflow mode the planner is often a request-metered text-only route while the worker chip holds a vision model. The composer then refuses the attachment with `MODEL_DOES_NOT_SUPPORT_IMAGES`, even though a delegated worker could use the pixels.

Separately, spawn and workflow `agent()` children receive only a text `prompt`. They do not inherit the parent log (`inheritsParentContext = false`), and the Workflow orchestrator cannot call `read_image` or `subagent_fork`. Durable images that somehow reached the parent never reach the worker.

The [web multimodal admission](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) decision owns host preflight and text-only projection for the planner request. The [orchestrator/worker split](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) owns who may gather and mutate. Neither covered worker-backed admission or spawn prompt attachment.

## Decision

**Admission.** When the prompt carries images and the planner route does not accept them, `createApiProxy` still admits if the agent's composed preset is `workflow` and `agentDefaultModel.currentWorkerSelection()` resolves to a route that accepts images (`inputModalities` undefined or includes `image`). Otherwise the existing `MODEL_DOES_NOT_SUPPORT_IMAGES` refusal stands. Planner requests still run through `projectImagesForTextModel`, so a text-only planner sees placeholders, not pixels.

**Forwarding.** `spawnPromptWithParentImages` builds every Workflow spawn/workflow-child prompt as the task text plus the image blocks from the latest real `user/message` on the parent. `tool-subagent` and `workflow-worker-thread` both use that helper. Non-workflow parents stay text-only. The Workflow persona tells the planner to describe the visual task for workers; the worker persona says attached images were forwarded.

## Alternatives considered

**Require the planner to have vision.** Rejects the product split where a cheap coordinator delegates seeing and coding to a vision worker.

**Switch Workflow spawn to fork so the child inherits history.** The orchestrator denies `subagent_fork`, and fork would pull the whole planner transcript into every worker.

**Persist images to disk and teach the planner to mention paths for `read_image`.** The planner cannot call `read_image`; paths would still need a worker that knows where to look, and admission would still fail before durability.

**Client-only soft allow.** The host gate is authoritative; a client change alone would still get `attachment-error`.

## Consequences

A Workflow session with a text-only planner and a vision worker accepts user images. Each `subagent` / workflow `agent()` start appends those durable refs so the worker model sees them. Standard and Code presets are unchanged. ACP and `read_image` gates stay planner/route-local. Tests cover host admission with and without a worker selection, and parent-turn image collection for Workflow vs other presets.
