# Agent Note: J-space Off hides the skill from the model

Status: implemented

English | [中文](2026-08-23-jspace-off-hides-from-model.zh.md)

## Problem

The composer J-space toggle Off only emptied the `jspace:protocol` system-prompt section. The bundled `j-space` skill stayed model-invocable, and its catalog description matched nearly every coding task, so the `skill` tool catalog still told the model to load it. Models then called `skill` with `{name:"j-space"}` on every step. The skill body told them to load modules; they called `skill` again with the same arguments. `repeat-tool-reminder` injected notices at 3/5/8 consecutive identical calls and did not block. Think traces showed the model trying to stop while the catalog and protocol kept re-instructing a load.

## Decision

**Off hides `j-space` from the model.** `ui-model-selection` calls `ctx.skills.hideFromModel('j-space')` while `ui-jspace.enabled` is false. `list`/`snapshot`/`get` report `modelInvocable: false`; the `skill` tool and session catalog omit it; `/j-space` stays user-invocable. Turning it off mid-session republishes a replacement catalog on the next pre-step.

**The protocol never tells anyone to reload.** While On, it classifies fast/full/loop, allows at most one `skill` load, and tells workers the pass instead of instructing a reload.

**A visible successful `skill` result cannot be loaded again.** `dsh-tool-skill` rejects a second call for that name while the first success remains on the session surface. Compaction that hides the result allows a reload.

The bundled `j-space` description no longer matches ordinary one-glance edits, and the skill body tells the model to Read modules from the resource base instead of calling `skill` again.

## Alternatives considered

**`disable-model-invocation: true` on the bundled skill file.** Rejected: On still needs a one-time model load, and a static frontmatter flag cannot follow the live toggle.

**Make `repeat-tool-reminder` veto instead of advise.** Rejected: legitimate identical retries (a denied permission, a flaky fetch) must stay unblocked; the skill loader owns duplicate-load refusal.

**Leave Off as prompt-only.** Rejected: the catalog instruction is what kept the loop alive after the protocol was gone.

## Consequences

Existing sessions pick up the hide on the next step after Off (or after a runtime that includes this change). Workers no longer get a parent instruction to load `j-space`. A Workflow planner omits the protocol even while On; that prefix cut is owned by the [unusable-context note](../simplification/2026-08-27-workflow-planner-omits-unusable-context.md). User `/j-space` still injects the body.

## Testing

`skill.spec.ts` covers hide refcounting, invalid names, and `get()` still returning the body. `host.client.spec.ts` toggles Off/On against a registered `j-space`. `tool-skill.spec.ts` covers catalog omission after hide, loader denial, already-loaded refusal while the result is visible, and malformed prior argument JSON.
