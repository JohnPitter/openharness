# Agent Note: Slash-menu Tab picks the highlighted command

Status: implemented

English | [中文](2026-08-23-slash-menu-tab-picks-highlight.zh.md)

## Problem

The `/` candidate menu is a combobox: focus stays in the composer, arrows move the highlight, and Enter picks that row. Tab still did native focus movement, so the highlighted command was not selected.

## Decision

`ArbitrateKey` includes `tab`. While the menu is open, Tab picks the current highlight through the same `pick()` path as Enter. An open menu with no highlight still consumes Tab so focus stays in the composer; a closed menu passes Tab through. InputBar preventDefaults only when arbitration is not `pass`. IME composition still passes every intercepted key.

## Alternatives considered

**Tab completes the command name into the draft without picking.** Rejected because click and Enter already claim or insert the candidate; a third outcome for the same row would split the gesture.

**Tab and Enter stay identical, including pass-when-no-highlight.** Rejected because native Tab would leave the composer while the menu is still open.

**Handle Tab only in MenuView.** Rejected because the slash menu never takes focus; InputBar is the only key path.

## Consequences

Arrow to a row and Tab selects it. Closed-menu Tab still moves focus. The [slash pipeline note](../architecture/2026-07-25-web-input-machine-and-slash-pipeline.md) records Tab among the intercepted keys.

## Testing

Controller tests pick the moved highlight with Tab, consume Tab when the menu is open without a highlight, and pass Tab during IME composition. InputBar spies arbitration and asserts Tab does not submit.
