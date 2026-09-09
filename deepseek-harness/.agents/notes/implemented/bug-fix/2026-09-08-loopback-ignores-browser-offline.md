# Agent Note: Loopback ignores browser offline; model directory keeps last-good on reset

Status: implemented

English | [中文](2026-09-08-loopback-ignores-browser-offline.zh.md)

## Problem

The 0.1.57 connection port ([selective alpha.2 recovery](../feature/2026-08-30-selective-upstream-fixes-dsh-0-1-2-alpha-2.md)) subscribes to `window` `online`/`offline` and calls `ConnectionController.setNetworkAvailable`. Going offline aborts the live generation. `onConnected` of the next generation emits `connection/reset`, and `ModelDirectory.resetConnected` cleared `current` and `groups` before repulling.

OpenHarness (and `dsh web` on 127.0.0.1) talks to a loopback sidecar. `navigator.onLine` reports WAN, not loopback. WebView2 fires spurious `offline` while the sidecar is still up. The composer chip then reads `trigger.fallback` ("Selecionar modelo") with an empty menu until `session.models` returns.

## Decision

Loopback page authority (`ConnectionHandle.isLoopback`) does not subscribe to browser online/offline. Non-loopback pages keep the watch: a WAN drop should pause retries.

`ModelDirectory.resetConnected` no longer empties the snapshot. It invalidates in-flight work and calls `load()`, which already sets `status: 'loading'` without dropping last-good `current`/`groups`. The Host answer still replaces the snapshot when it lands. Addressed subagent sessions still skip the reload.

## Alternatives considered

**Keep the wipe so an unsaved local select cannot outlive a Host restart.** Rejected: OpenHarness reconnects are almost always the same sidecar process. Showing last-good until `session.models` lands is the same stale-while-revalidate rule 0.1.57 already applied to the `@`/`/` menu. A Host restart still converges on the logged selection.

**Debounce `offline` instead of skipping it on loopback.** Rejected: a true WAN drop must not abort a 127.0.0.1 generation at all. Debounce would still tear down a healthy sidecar after the timer.

**Ignore `navigator.onLine` everywhere.** Rejected: a tunneled non-loopback client should stop retrying while the browser reports offline.

## Consequences

Desktop OpenHarness keeps the model chip populated across WebView2 network blips. A tunneled phone client still honors offline. Genuine stream loss still reconnects and still refreshes the directory, but the chip no longer flashes empty during that refresh.

## Testing

`client-apply.client.spec.ts` asserts a loopback `start()` installs no `offline` listener, and a non-loopback page goes `disconnected` when that listener fires. `connection.client.spec.ts` covers `setNetworkAvailable(false)` aborting a live generation. `browser-plugin.client.spec.ts` asserts `connection/reset` keeps last-good `current`/`groups` at `loading` and then stores the Host target.
