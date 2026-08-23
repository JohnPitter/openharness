# Agent Note: Remote lives in the sidebar above the model chip

Status: implemented

English | [中文](2026-08-22-lan-remote-sidebar-chip.zh.md)

## Problem

OpenHarness Remote is a desktop-shell action (QR + token URL via `postMessage` to the Wails parent), not a per-session model setting. Putting it in the composer `ModelSelect` root menu mixed a host-wide network control with Model / Effort / J-space, hid it on the workflow worker picker, and left the sidebar foot empty above the in-use model row where the operator looks for session chrome.

## Decision

**Remote is a `sidebar.footer.action` chip (`id: lan-remote`, `order: -20`) stacked above the usage/model chip (`id: usage-status`, `order: -10`).** `RemoteChip` talks to the desktop parent with the existing `openharness:remote-enable` / `openharness:remote-ready` / `openharness:remote-disable` messages. A top-level web tab (`window.parent === window`) opens the same panel with the desktop-only explanation and never posts enable. The composer model menu is Model / Effort / J-space only.

The URL on that QR is a public HTTPS tunnel: [Remote publishes a public HTTPS tunnel, not a LAN bind](2026-08-22-remote-internet-quick-tunnel.md).

## Alternatives considered

**Keep Remote as the first `ModelSelect` root row.** Rejected: the control is not a model selection, and the sidebar already owns the in-use model row plus Settings.

**A Settings section or titlebar control.** Rejected: the operator needs the QR next to the live session chrome without leaving the conversation.

## Consequences

The expanded sidebar shows Remote, then the provider/model usage chip, then Settings. The iframe harness still cannot start Remote without the OpenHarness exe. Browser-only `dsh web` can open the chip and read the desktop-only copy.

## Testing

`remote-chip.client.spec.tsx` drives idle/connecting/active copy, desktop-only, enable/ready/error, copy and stop, Escape and outside pointerdown, and the collapsed rail. `browser-plugin.client.spec.ts` pins registration order `-20` then `-10`. `model-select.client.spec.tsx` asserts the composer root menu starts at Model with no Remote row.
