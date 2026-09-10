# Agent Note: Lead quota window on the sidebar chip and inside the composer meter

Status: implemented

English | [中文](2026-09-09-quota-ring-composer-chip.zh.md)

## Problem

Coding-plan quota lived only behind two clicks: the sidebar chip showed context occupancy and the plan quota only inside its click-open panel, and the composer's context ring had no account-level counterpart. The number a coding-plan user watches most — the 5-hour window — was invisible while working.

## Decision

`ui-model-selection` gains a shared live-quota module (`usage-quota-live.ts`): `useProviderQuota` loads the staged provider's account windows on mount, on provider change, and every 60 seconds (the Limits panel still reloads on open); `pickLeadWindow` leads with the shortest disclosed window — the 5-hour-style limit — and falls back to the earliest-resetting (weekly-style) window; `quotaChipSegment` renders the compact `42% 5h` / `42% weekly` segment. The sidebar chip's meta line appends that segment, so its quota probe is no longer gated on the panel opening.

In the composer the two meters stack concentrically, like layers of one dial: ui-conversation declares a new `conversation.input.meterCenter` slot rendered inside the context meter's trigger, and ui-model-selection's `QuotaRing` occupies it with the lead window as the INNER arc — the outer arc stays context occupancy. The trigger keeps the context breakdown's click and tooltip; the ring is a non-interactive visual whose SVG title carries the window label and reset. Both surfaces hide when the provider exposes no quota surface or the last probe failed. The shared `Ring` meter moved into `usage-quota.tsx` with caller-supplied classes.

## Alternatives considered

**A separate quota button beside the context ring (`conversation.input.right`).** Rejected by the product call: two adjacent dials read as two unrelated controls; the layered single dial keeps one affordance with two readings.

**Edit ui-conversation's InputBar to fetch quota itself.** Rejected: quota knowledge (provider directory, `loadAccountUsage`) lives in ui-model-selection, and cross-package imports are forbidden; the slot hand-off keeps each side owning its half.

## Consequences

Every configured coding plan's lead window is visible at a glance in both the sidebar foot and the composer; chip and ring share one probe per provider per minute via a 60s cache ([probe timeout](2026-09-10-quota-probe-timeout-and-progressive-limits.md)). Pay-per-token routes (no quota surface) render exactly what they rendered before. The context meter's trigger gained `position: relative` and a center overlay container.

## Verification

`usage-status-chip.client.spec.tsx` pins the meta segment (`40% · 100K · 70% 5h`), the weekly fallback, and the unchanged panel behavior; `quota-ring.client.spec.tsx` pins the 5-hour lead, weekly fallback, reset label, and the three hidden states; `context-meter.client.spec.tsx` pins the occupant layered inside the trigger with clicks still opening the context panel, and the occupant-free render unchanged.
