# Agent Note: Selective fixes adopted from upstream dsh-v0.1.2-alpha.2

Status: implemented

English | [中文](2026-08-30-selective-upstream-fixes-dsh-0-1-2-alpha-2.zh.md)

## Problem

Upstream `deepseek-ai/deepseek-harness` published `dsh-v0.1.2-alpha.2` on top of the alpha.1 tag this fork last sampled. The same two architecture-scale changes remain deferred ([alpha.1 selective port](2026-08-29-selective-upstream-fixes-dsh-0-1-2-alpha-1.md)): the `@Remote` API Gateway replacing `ApiProxy`, and the conversation UI module split. The remaining changelog still contains self-contained recovery and listing work that this fork can take without that migration.

## Decision

Four upstream items were ported by hand against this fork's current tree:

1. **`@`/`/` menu stale-while-revalidate** (`packages/client/ui-input-trigger`): a query refinement keeps the previous rows and highlight visible while groups go `pending`; Enter and Tab consume without picking until the highlighted group is `ready`. The upstream directory-drill / breadcrumb path was not ported — this fork has no `drill` candidate.
2. **Settings trigger focus restore** (`packages/client/ui-settings-general`): closing the dialog returns focus to the trigger after the close commit, so the dialog no longer owns focus.
3. **Connection recovery indicator** (`packages/client/connection`, `ui-primitives`, `ui-settings-general`): `ConnectionState` is `'connected' | 'disconnected' | 'connecting'`. After the backoff cap the loop waits at `'disconnected'` until `reconnect()` or `stop()`; `stop()` aborts the retry sleep. The wide sidebar shows `ConnectionIndicator` (outage, connecting dots, two-second recovered). The dual-stream mux+host handshake is unchanged — this fork did not take the generation-source rewrite that lives on the deferred gateway.
4. **Plugin inventory grouped by preset** (`packages/preset/agent-presets`, `packages/host/plugin-inventory`, `packages/client/ui-settings-plugin-inventory`): `compositionInventory()` reads live standing mounts in this runtime, else the composition file; `pluginInventory.list()` is async and carries optional `agentPresets`. A standing `PresetTree` reclaims the parent Loader entry's `subtree` slot so preset rows stay off `loader.entries()`. The Settings tab groups session plugins per preset (with a switcher) and global host entries separately. Display names for shipped presets resolve through `packages/preset/agent-presets/src/display.ts` using this fork's ids (`standard`, `code`, `workflow`, `minimal`, `cordis`), not upstream's `ptc`.

pt/es dictionaries were added wherever the port introduced copy. Items skipped as already present, Windows-irrelevant, or bound to deferred architecture: token/time chip (this fork already shows TTFT / duration / tok/s), schedules UI, DeepSeek `web_search` error endpoint, conversation UI polish in split `ui-chat`, O(1) gateway stream queues, Node 24.0–24.11 HMR, macOS/Linux skip-stat, `RemoteError`, hero fish animation, npm peerDeps trim.

## Alternatives considered

**Merge the alpha.2 tag.** Rejected for the same reason as alpha.1: thousands of files, session-projection migrations, a Cordis vendor bump, and the two deferred architecture changes.

**Cherry-pick upstream commits.** Rejected: this fork's locales, providers, and connection handshake diverge enough that a raw cherry-pick conflicts in every touched file.

## Consequences

The desktop Settings foot now surfaces Host disconnects with a one-click retry, plugin listing matches the session/global split users already have in presets, and the composer `@`/`/` menu no longer submits a stale row while a refinement is in flight. Future gateway ports must keep this fork's mux+host `ConnectionController` and remap `'reconnecting'` callers to `'connecting'` / `'disconnected'`. Typert Host/remote artifacts for `pluginInventory.list` must be regenerated whenever the snapshot fields change.

## Verification

Focused suites on the touched packages, plus `tsc -b` of the client and host aggregates as needed after Typert regeneration.
