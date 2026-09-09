# Agent Note: Lead quota window on the sidebar chip and a composer ring

Status: implemented

English | [中文](2026-09-09-quota-ring-composer-chip.zh.md)

## Problem

Coding-plan quota lived only behind two clicks: the sidebar chip showed context occupancy and the plan quota only inside its click-open panel, and the composer's context ring had no account-level counterpart. The number a coding-plan user watches most — the 5-hour window — was invisible while working.

## Decision

`ui-model-selection` gains a shared live-quota module (`usage-quota-live.ts`): `useProviderQuota` loads the staged provider's account windows on mount, on provider change, and every 60 seconds (the Limits panel still reloads on open); `pickLeadWindow` leads with the shortest disclosed window — the 5-hour-style limit — and falls back to the earliest-resetting (weekly-style) window; `quotaChipSegment` renders the compact `42% 5h` / `42% weekly` segment. The sidebar chip's meta line appends that segment, so its quota probe is no longer gated on the panel opening. A new `QuotaRing` component registers into ui-conversation's existing, previously unoccupied `conversation.input.right` slot: a ring beside the send button with the lead window's percent, a tooltip naming the window and its reset, and a click through to Settings → Limits. Both surfaces hide when the provider exposes no quota surface or the last probe failed. The shared `Ring` meter moved into `usage-quota.tsx` with caller-supplied classes.

## Alternatives considered

**Edit ui-conversation's InputBar to fetch quota itself.** Rejected: quota knowledge (provider directory, `loadAccountUsage`, Limits navigation) lives in ui-model-selection, and cross-package imports are forbidden; the declared `conversation.input.right` seat exists precisely for a small control in that row.

**Gate the ring on the context ring's visibility.** Rejected: quota is account-level and meaningful even before the first provider reply reports context pressure.

## Consequences

Every configured coding plan's lead window is visible at a glance in both the sidebar foot and the composer; the quota endpoint receives one probe per minute per mounted surface instead of one per panel opening. Pay-per-token routes (no quota surface) render exactly what they rendered before.

## Verification

`usage-status-chip.client.spec.tsx` pins the meta segment (`40% · 100K · 70% 5h`), the weekly fallback, and the unchanged panel behavior; `quota-ring.client.spec.tsx` pins the 5-hour lead, weekly fallback, reset tooltip, click-through to Limits, and the three hidden states.
