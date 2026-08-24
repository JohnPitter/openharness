# Agent Note: Usage chip shows worker quota in Workflow mode

Status: implemented

English | [中文](2026-08-24-usage-chip-worker-quota.zh.md)

## Problem

In Workflow mode the usage chip (sidebar quota popup) only showed the planner's route and account quota; the worker's model/quota were invisible even though the worker may run on a different provider.

## Decision

`UsageStatusChipInjected` gained an optional `workerDirectory` (host observable or snapshot store of `WorkerModelState`); the slot inject spreads `workerDirectory: worker.store` only when a worker exists. When the current session preset is `workflow` and a worker selection exists, the panel renders one compact row (`dt` = `role.worker` label, `dd` = worker model via `routeLabelFor`) plus the worker's `QuotaSection`. Worker quota loads through the existing `loadAccountUsage(workerProviderId)`; when the worker shares the planner's provider the already-loaded quota is reused (no second request). Failures surface inline per provider (Error message or `String(error)`). No new CSS classes; the worker `QuotaSection` reuses the existing `.quota` bordered divider. `routeLabelOf` was refactored into a non-null `routeLabelFor(directory, selection)`.

## Alternatives considered

**Per-worker session token split.** Rejected, because token-meter has no per-role accounting and worker tokens land in subagent sessions.

## Consequences

The chip grows by one row plus one quota section only in Workflow mode; same-provider setups make no extra network request.

## Testing

Four new tests in `packages/client/ui-model-selection/tests/usage-status-chip.client.spec.tsx` cover worker route and quota render, shared-provider reuse with `toHaveBeenCalledTimes(1)`, omission outside the workflow preset, and Error plus non-Error rejection messages. The full package has 64 tests green, oxlint 0, and `tsc -b tsconfig.client.json` clean.
