# Agent Note: Settings Limits and Status sections

Status: implemented

English | [中文](2026-09-09-settings-limits-and-status-sections.zh.md)

## Problem

Settings → Painel mixed Host-local usage history (`usage.panel`) with coding-plan quotas (`llm.accountUsage` per provider) on one page. `UsagesSection` waited on `Promise.all` of both loads before painting. A large local ledger delayed quota cards; slow provider quota HTTP delayed the history chart. Neither payload is required to show the other.

## Decision

`ui-model-selection` registers two `settings.section` rows. `quotas` (order 12) is Limits: `QuotasSection` loads only `llm.providers` then `llm.accountUsage`. `usages` (order 13) is Status: `UsagesSection` loads only `usage.panel`. The Status id stays `usages` so existing callers that name that id still resolve the history page. The sidebar usage chip's view-all action injects `openQuotas`, which calls `settingsNav.openSection('quotas')`. The Host `usage.panel` fold is unchanged.

Nav labels (zh / en / pt / es): Limits `限额` / `Limits` / `Limites` / `Límites`; Status `状态` / `Status` / `Status` / `Estado`. Settings nav glyphs reuse `IconEnhanceOutline16` for both ids.

## Alternatives considered

**Keep one nav item and drop `Promise.all` so each half paints as it arrives.** Independent paints would still mix two jobs on one page, and a user who only wants quotas would still mount the ledger.

**Rename the Status id from `usages` to `status`.** Existing tests and snapshots that know `usages` would churn for a label-only change.

**Speed up `usage.panel` folding on the Host.** The product failure is coupled UI loads, not a proven one-line Host bug.

## Consequences

Quota cards appear without scanning the local ledger. History appears without waiting on provider HTTP. Users who want one fact no longer open the other. The usage chip still has a single view-all door; it now lands on Limits rather than Status.

## Testing

`usages-section.client.spec.tsx` pins Status painting without `accountUsage`, including a hanging quota API. `quotas-section.client.spec.tsx` pins Limits painting without `usage.panel`, including a hanging panel API. `usage-status-chip.client.spec.tsx` pins view-all calling `openQuotas`. `browser-plugin.client.spec.ts` pins section ids `quotas` then `usages` and the chip inject opening `quotas`. `settings-root.client.spec.tsx` pins both ids sharing the Enhance glyph.

## Related

The Host-local ledger, `$DSH_HOME/usage-panel.json`, and `usage.panel` RPC remain in [Settings usage panel](../feature/2026-08-25-settings-usage-panel.md).
