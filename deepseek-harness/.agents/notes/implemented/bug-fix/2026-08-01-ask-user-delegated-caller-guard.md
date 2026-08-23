# Agent Note: Reject human interaction from runtime-owned subagents

Status: implemented

English | [中文](2026-08-01-ask-user-delegated-caller-guard.zh.md)

## Problem

A one-shot subagent that calls `ask_user_question` can block indefinitely. The call waits for a human answer, but the child has no independently owned human channel, so the child's completion and the parent waiting on that completion both stall.

Durable session lineage cannot decide whether an answerer exists. A child session may later be resumed as a new top-level runtime root, while a live runtime-owned child may carry a zero or absent durable delegation depth. Error guidance at the shared seam must also fit every consumer: `exit_plan_mode` uses `ctx.userQuestions.ask()` without calling `ask_user_question`.

## Decision

When `AskUserQuestionRequest.agent` is present, `UserQuestionService.ask()` authenticates the exact live agent through `ctx.agents`. A human UI wait is only for a runtime root the user is answering. A delegated caller never creates that wait: [subagent option auto-selection](../feature/2026-08-23-subagent-ask-user-auto-recommended.md) returns the recommended (else first) option, and an optionless batch still fails with `DELEGATED_CALLER`. A missing registry or stale same-id object fails with `CALLER_NOT_LIVE`. The check runs after the existing aborted and empty-batch guards and before provider dispatch.

Runtime ownership is the primary authority. A continuable child may still be a registry root (created from a manager scope with no initiator); those stay delegated while `origin` is `subagent` and the durable parent session is live. A lineage-bearing session resumed without an owner and without a live parent is a runtime root and may ask. Agentless programmatic calls retain the existing provider path.

The shared failure text is consumer-neutral and actionable: the child includes the unresolved question or decision in its final result. The parent already receives that result through the delegation contract and can decide whether to ask the human. Neither the service nor a child claims an upward messaging or answer-forwarding capability that does not exist.

This safety boundary is independent of the browser's composer election. The proposed [semantic composer phases](../../proposed/architecture/2026-08-08-semantic-composer-chain-phases.md) address how an already-pending interaction and a read-only subagent surface should be ordered; they do not weaken this runtime guard.

## Alternatives considered

**Use `session.header.delegationDepth > 0`.** Rejected because durable lineage survives resume and does not attest the current process-local owner. It rejects valid resumed roots and can admit a live child whose durable header is incomplete.

**Reject only inside `dsh-tool-ask-user`.** Rejected because `exit_plan_mode` and direct callers share `ctx.userQuestions.ask()`. The service is the narrow operation boundary common to every human-interaction consumer.

**Tell the child to delegate upward or wait for forwarding.** Rejected because one-shot delegation exposes no child-to-parent request channel and no answer-forwarding protocol. The only guaranteed return path is the child's final result.

**Rely on the browser composer fix.** Rejected because presentation cannot make an ownerless human channel exist, and non-browser deployments still need the call to terminate.

## Consequences

Runtime-owned and live-parent continuable child calls never wait on a UI. Option questions resolve through auto-selection; optionless questions fail fast with a stable structured error. Exact live roots with no live parent, and agentless programmatic calls, remain eligible for a human answer, including resumed sessions with historical child lineage. `ask_user_question` and `exit_plan_mode` share this seam.

## Testing

Service tests cover a zero-depth live child (optionless `DELEGATED_CALLER` and option auto-selection), a continuable subagent root with a live parent, a depth-one resumed runtime root, a missing registry, a stale same-id object, and provider non-invocation on every rejection or auto-answer. Tool and plan-mode tests prove optionless consumers surface the neutral `DELEGATED_CALLER` result. The keyless assembled snapshot delegates to a child that attempts an optionless `ask_user_question`, pins the child's error tool result and final handoff, and proves the parent completes instead of waiting for an answer.
