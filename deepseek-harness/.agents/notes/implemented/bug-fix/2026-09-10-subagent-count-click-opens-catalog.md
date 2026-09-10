# Agent Note: Count-pill click opens the subagent catalog

Status: implemented

English | [中文](2026-09-10-subagent-count-click-opens-catalog.zh.md)

## Problem

The descendant-count control in `SubagentHeaderLineage` (`CatalogDropdown` `variant: 'count'`) has no click handler. The catalog opens only after a 150ms `mouseenter` delay. On the OpenHarness desktop WebView a click on "N subagentes" does nothing, so the user cannot open the tree.

Upstream `dsh-v0.1.5-rc.1` still uses that hover-only trigger handler. The gap is local to this desktop shell, not a missing official Session V3 catalog.

## Decision

The count trigger's `onClick` calls `changeOpen(!open)`, so a click toggles the catalog. Hover remains an additional path with the same 150ms open delay and 120ms crossing grace. Keyboard ArrowDown still opens the tree and focuses the first row.

A switcher that supplies `openTitle` still navigates to that ancestor on click (and closes an open catalog). A switcher without `openTitle` uses the same click-to-toggle path as the count control, so sibling switching is not hover-only.

This change does not port official `feat/parent-subagent-catalog-foundation` or Session V3.

## Alternatives considered

**Keep hover as the only pointer path and document ArrowDown.** Rejected: the live report is a click that does nothing; WebView2 does not reliably fire the hover delay that the tests treat as the primary path.

**Split the ancestor switcher into a title hit target and a separate chevron.** Rejected: ancestor click already means "go up"; hover and ArrowDown still open that catalog. The reported miss is the count pill.

**Port official PR #3859 (`worktree-sidebarsubagent`).** Rejected: that work resolves subagent session roots in the workspace file tree, not this conversation catalog trigger.

## Consequences

A click on "N subagentes" opens (and a second click closes) the catalog in the desktop WebView. Hover-only tests remain, plus a jsdom click-toggle case. The [web subagent catalog contract](../feature/2026-07-27-web-subagent-conversations.md) records this click path beside hover.

## Testing

`packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` clicks the count trigger and asserts the tree opens, then clicks again and asserts it closes. Existing hover delay and crossing-grace cases stay.
