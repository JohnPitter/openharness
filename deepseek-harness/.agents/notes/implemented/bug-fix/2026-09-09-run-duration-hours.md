# Agent Note: Run-duration clock rolls hours after 60 minutes

Status: implemented

English | [中文](2026-09-09-run-duration-hours.zh.md)

## Problem

`formatRunDuration` in `ui-conversation` message chrome floors elapsed milliseconds to whole seconds, then formats minutes as `floor(total / 60)` without reducing modulo 60. The live "Deep diving…" clock, the settled "ran for" footer, and compaction elapsed labels therefore show values such as `66min 59s` once a turn crosses one hour.

## Decision

The helper decomposes elapsed seconds into `hours`, `minutes % 60`, and `seconds % 60`. When `hours > 0`, it uses a new `duration.hours` template with zero-padded two-digit minutes and seconds (`1h 06min 59s` in pt). Sub-hour durations keep the existing `duration.minutes` and `duration.seconds` templates. Negatives still clamp to zero before flooring.

`StatsLine.formatDuration` stays unchanged; it formats composer-dock latency totals in a compact `2m42s` style and is not the Deep diving clock.

## Alternatives considered

**Extend the minutes template with an optional hours placeholder.** Rejected: every locale would need awkward branching inside one string, and the minutes branch would still risk double-counting without a separate roll-up path.

**Reuse `StatsLine.formatDuration` for message chrome.** Rejected: the dock helper is unit-less English shorthand, not localized turn chrome.

## Consequences

Turn chrome and compaction progress show hour-qualified elapsed labels at and above 3600 seconds. zh, en, pt, and es each gain `duration.hours` immediately after `duration.minutes`.

## Verification

`chat-view.client.spec.tsx` pins zero, negative clamp, sub-minute flooring, sub-hour minutes, exactly one hour, 66 minutes 59 seconds, and multi-hour leftovers through the zh dictionary.
