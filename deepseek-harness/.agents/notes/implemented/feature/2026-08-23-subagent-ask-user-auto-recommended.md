# Agent Note: Subagent ask-user auto-selects the recommended option

Status: implemented

English | [中文](2026-08-23-subagent-ask-user-auto-recommended.zh.md)

## Problem

A delegated agent that calls `ask_user_question` with selectable options still needs a human answer to continue. One-shot children owned by another agent used to fail with `DELEGATED_CALLER`. Continuable children created from the subagent manager scope are registry roots, so they passed the ownership guard and waited on a question bound to the child session. The parent conversation does not take over that composer, so the child and the parent waiting on it both stall. The model already marks a preferred choice with `(Recommended)` on the option label.

The [delegated-caller guard](../bug-fix/2026-08-01-ask-user-delegated-caller-guard.md) still owns fail-closed behavior when there is no option to select.

## Decision

`UserQuestionService.ask()` auto-answers a delegated caller from option labels and never dispatches the UI provider. A delegated caller is a live agent owned by another live agent, or a registry root whose session header is `origin: 'subagent'` while `parentSession` is still a live agent. For each question it selects every `(Recommended)` / `（推荐）` label on a multi-select item, or the first recommended label (else the first option) on a single-select item. An optionless item in the batch still throws `DELEGATED_CALLER`. Intent validation still runs first.

A resumed lineage-bearing session with no live parent remains a human-facing root. Agentless programmatic calls still use the provider.

## Alternatives considered

**Keep `DELEGATED_CALLER` for every delegated call.** Rejected because option questions already name a recommended choice, and rejecting them makes the child retry or stall the parent instead of continuing the task.

**Auto-select on every session, including the user's root.** Rejected because the human still answers root questions in the composer.

**Use `delegationDepth > 0` alone.** Rejected for the same resume reason as the delegated-caller guard: durable depth would auto-answer a child session the user later opens as a root.

**Register continuable children under the parent initiator so they are never roots.** Deferred: that ownership change has a wider lifecycle blast radius; auto-selection plus the live-parent origin check unblocks the wait without it.

## Consequences

Subagent option questions complete without a composer takeover. The selected labels are the model's own option strings, so the tool result stays in the existing JSON vocabulary. Optionless child questions still fail fast. Root `ask_user_question` is unchanged.

## Testing

Service tests cover owned-child recommended and first-option selection, a continuable subagent root with a live parent, optionless `DELEGATED_CALLER`, and a resumed root that still reaches the provider. The tool test covers recommended auto-selection through `ask_user_question` execute. Helper tests pin English and Chinese suffixes and multi-select recommended labels.
