# Agent Note: OpenHarness mascot replaces the ring mark and OH letters

Status: implemented

English | [中文](2026-08-22-openharness-mascot-mark.zh.md)

## Problem

The in-app mark was a currentColor open ring with two node dots, and `BrandWordmark` drew the letters `OH` in SVG. The desktop tile (`frontend/dist/logo.png`) was a colored ring with a center dot. None of those surfaces was a character mascot, so the product had a geometric glyph instead of a face users can recognize in the sidebar, hero, tab icon, and window chrome.

## Decision

**The product mark is the 3D cream-headed mascot sitting in the blue open-ring harness with mint node clasps, on a transparent canvas.** `FishLogo` scales that raster through an SVG `<image href="/mascot.png">` in a 24×24 box with no tile fill. `BrandWordmark` is that same mascot; `includeMark={false}` is an empty 24 box so `sidebar.brand.name` can sit beside the slotted mark. `apps/web/public/favicon.svg` wraps `mascot.png`; the desktop titlebar uses `logo.png`. Tab contrast on light chrome comes from the blue ring and mint nodes, not a charcoal plate.

## Alternatives considered

**Keep currentColor and invert the favicon in dark scheme.** Rejected: the mascot's identity is the cream/blue/mint palette; a one-ink silhouette loses the character, and inverting a colored glyph would wash it out.

**Paint the mascot as a 24px SVG path in brand inks.** Rejected: the product mark is the 3D clay render; a flat path is a different character.

**Keep the charcoal rounded-square plate behind the mascot.** Rejected: the tile reads as a second mark in the titlebar and sidebar.

**Inline a data-URI PNG inside the client bundle.** Rejected: `/mascot.png` is a public asset the web host already serves; embedding tens of kilobytes in every `FishLogo` import bloats the client.

**Keep the `OH` SVG letters next to the mascot.** Rejected: the official name is already slotted HTML (`OpenHarness`); a second OH glyph duplicated the initials the mascot already replaced.

## Consequences

Sidebar, hero, favicon, and the desktop window mark share the same transparent 3D raster. Light-theme contrast of the cream head relies on the blue ring and mint nodes rather than a currentColor fill or a charcoal tile.
