# Agent Note: General Settings control automatic compaction

Status: implemented

English | [中文](2026-08-22-settings-automatic-compaction.zh.md)

## Problem

Automatic compaction fired from load-time `BasicCompactionConfig.auto` and `thresholdRatio` (default `0.8`). The General Settings dialog had no control, so turning the behavior off or choosing when it ran required editing cordis.yml and remounting the engine.

## Decision

The first `compaction-basic` engine that sees `ctx.settings` registers namespace `compaction-basic` with `auto` (default `true`) and `thresholdPercent` (`25`, `50`, `75`, or `100`; default `75`, the closest allowed fraction to Config `0.8`). Later standing mounts no-op on that namespace. Pressure replaces the routed Config `thresholdRatio` with `thresholdPercent / 100` at event time. `auto: false` skips both the `agent/pre-step` pressure listener and overflow recovery on the next check; `/compact` and `compactNow()` stay available. Compositions without a settings provider keep the plugin Config, including `thresholdRatio: 0.8`.

ui-conversation binds the same namespace into two General rows (On/Off and the percent menu). The threshold selector disables while automatic compaction is off. The overlay does not change overflow's bypass of threshold and retention.

This extends the live overlay onto the load-time policy in [routed model context and compaction policy](../architecture/2026-07-20-routed-model-context-and-compaction-policy.md).

## Alternatives considered

**Put `auto` and the percent on `ui-conversation` settings.** Rejected: the engine would depend on a UI package, and headless compositions could not share the document.

**Keep `thresholdRatio: 0.8` as a fifth General option.** Rejected: the requested discrete set is `25` / `50` / `75` / `100`; `75` is the closest allowed value.

**Gate only pressure and leave overflow as a safety net when `auto` is off.** Rejected: shipped Config `auto: false` already means manual-only, including no overflow recovery.

**Register the namespace from every preset mount without an idempotent skip.** Rejected: `settings.register` fails loud on a duplicate namespace.

## Consequences

A Web or desktop host with settings therefore compacts at 75% of the routed window until the operator picks another percent, even if cordis.yml still says `0.8`. CLI and tests that never load settings keep `0.8`. A first-engine fiber that disposes drops the namespace until another mount registers it; standing preset mounts keep the fiber for the process lifetime.

## Testing

`user-settings.spec.ts` covers overlay math and rejected sections. `compaction-basic.spec.ts` registers the schema once, rejects `80`, overlays `25` / `100` on `compactIfNeeded`, and skips both automatic listeners when `auto` is false. ui-conversation row and policy specs drive On/Off, 50%, and Host adoption. The settings-chrome e2e snapshots include the two new General rows.
