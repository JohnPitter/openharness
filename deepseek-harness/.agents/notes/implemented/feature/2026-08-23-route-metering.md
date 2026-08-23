# Agent Note: Route metering

Status: implemented

English | [中文](2026-08-23-route-metering.zh.md)

## Problem

DeepSeek bills tokens plus cache; coding plans (Kimi for Code, Claude Code, Codex, GLM, OpenCode) bill a request window. The harness used to fire a title LLM and a pressure compact LLM on every route, and a Workflow worker with an empty chip inherited the planner. Both spend request quota. The quota chip already exists; the GLM parser only accepted `TOKENS_LIMIT` / `CREDIT_LIMIT` and dropped request windows. Session milestones are a separate index; see the [session-milestones note](2026-08-23-session-milestones.md).

## Decision

Each adapter declares `metering?: 'tokens' | 'requests'` on `LlmProviderInfo`. Consumers read `ctx.llm.providerMetering(provider)`, which defaults to `tokens` when the route is unregistered or undeclared. The client must not infer the unit from the provider id. Coding-plan routes declare `requests`; pay-per-token routes omit the field.

A request-metered route does not start the automatic title provider and does not run pressure compact LLM after prune. Local prune still runs. Canonical overflow and `/compact` still summarize, otherwise the session wedges. Token-metered routes keep the previous automatic title and pressure compact behavior.

`parseZaiUsage` maps captured GLM `TIME_LIMIT` (and sibling request-count types) onto `requests` / `requests-weekly` windows. The existing quota chip and Settings → Usages render those ids.

When the parent is Workflow, the planner is request-metered, and no worker chip or requested child provider is set, `resolveChildAgentOptions` throws `WorkflowWorkerRequiredError` instead of inheriting. An explicit worker always wins. A token-metered planner still inherits when the chip is empty. The composer raises `blocked.worker` until a worker is selected; an unroutable planner still wins over that block.

## Alternatives considered

**Infer metering from the provider name.** A custom OpenAI-compatible gateway can look like a coding plan and still bill tokens. The adapter that owns the wire must declare the unit.

**Skip overflow and `/compact` on request-metered routes.** A session that cannot compact is stuck above the context window with no recovery.

**Always inherit the planner for Workflow workers.** That spends a second request-window slot on the same plan the user already chose for thinking.

**Block every request-metered worker, even when the user picked it.** The chip is an explicit choice; inheriting an unset chip is the accident.

**Guess GLM request-window `type` without a captured payload.** The parser would invent a discriminant the live monitor does not send.

## Consequences

Auxiliary title and pressure-compact LLMs stop spending coding-plan quota. Overflow and manual compact still cost a request, by design. Workflow on GLM/Kimi/Claude Code requires a worker chip before the first delegation. Host `session.models` carries `currentMetering` so the client does not reverse-engineer the unit.

## Testing

Adapter tests pin declared vs omitted `metering`. Compaction pressure on a request-metered adapter prunes and does not summarize; overflow still summarizes. Session-title automatic generate is not called on a request-metered `LlmRuntime` adapter; the fallback title still lands. `resolveChildAgentOptions` covers throw / inherit / explicit worker / requested provider. GLM fixtures include captured `TIME_LIMIT`. Composer block and quota labels cover `blocked.worker` and `requests` windows.
