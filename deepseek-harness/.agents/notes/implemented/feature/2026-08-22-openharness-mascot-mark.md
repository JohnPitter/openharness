# Agent Note: OpenHarness mascot replaces the ring mark and OH letters

Status: implemented

English | [中文](2026-08-22-openharness-mascot-mark.zh.md)

## Problem

The in-app mark was a currentColor open ring with two node dots, and `BrandWordmark` drew the letters `OH` in SVG. The desktop tile (`frontend/dist/logo.png`) was a colored ring with a center dot. None of those surfaces was a character mascot, so the product had a geometric glyph instead of a face users can recognize in the sidebar, hero, tab icon, and window chrome.

## Decision

**The product mark is a cream-headed mascot sitting in the blue open-ring harness with mint node clasps.** `FishLogo` paints that character in fixed brand inks (`#4F8CFF`, `#7DDB6A`, `#F4EFE6`) inside a 24×24 box. `BrandWordmark` is that same mascot; `includeMark={false}` is an empty 24 box so `sidebar.brand.name` can sit beside the slotted mark. `apps/web/public/favicon.svg` draws the same glyph on a charcoal rounded tile (`#2C2C34`) so the tab icon stays visible on light and dark browser chrome without a color-scheme invert.

## Alternatives considered

**Keep currentColor and invert the favicon in dark scheme.** Rejected: the mascot's identity is the cream/blue/mint palette; a one-ink silhouette loses the character, and inverting a colored glyph would wash it out.

**Put the raster 3D tile in the sidebar via `<img>`.** Rejected: the rail and hero marks are 24–34px SVG that must scale with `size` and ship inside the client bundle; the 3D PNG stays the desktop tile and app icon.

**Keep the `OH` SVG letters next to the mascot.** Rejected: the official name is already slotted HTML (`OpenHarness`); a second OH glyph duplicated the initials the mascot already replaced.

## Consequences

Sidebar, hero, and favicon share one mascot geometry. The desktop `logo.png` / `appicon.png` keep the shaded 3D tile of the same character. Light-theme contrast of the cream head relies on the blue ring and mint nodes rather than a currentColor fill.
