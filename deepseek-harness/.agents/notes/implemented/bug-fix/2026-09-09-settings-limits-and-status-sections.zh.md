# Agent Note: Settings 限额与状态分节

Status: implemented

[English](2026-09-09-settings-limits-and-status-sections.md) | 中文

## 问题

Settings → Painel 把 Host 本地用量历史（`usage.panel`）和 coding-plan 配额（每个提供方的 `llm.accountUsage`）混在同一页。`UsagesSection` 在绘制前等待两者的 `Promise.all`。庞大的本地账本拖慢配额卡片；缓慢的提供方配额 HTTP 拖慢历史图。展示其中一面并不需要另一面的载荷。

## 决策

`ui-model-selection` 注册两个 `settings.section` 行。`quotas`（order 12）是限额：`QuotasSection` 只加载 `llm.providers` 再加载 `llm.accountUsage`。`usages`（order 13）是状态：`UsagesSection` 只加载 `usage.panel`。Status 的 id 仍为 `usages`，因此已有按该 id 寻址的调用方仍落到历史页。侧栏用量 chip 的「查看全部」注入 `openQuotas`，调用 `settingsNav.openSection('quotas')`。Host 的 `usage.panel` 折叠不变。

导航文案（zh / en / pt / es）：限额为 `限额` / `Limits` / `Limites` / `Límites`；状态为 `状态` / `Status` / `Status` / `Estado`。Settings 导航图标对两个 id 都复用 `IconEnhanceOutline16`。

## 已考虑的替代方案

**保留一个导航项，去掉 `Promise.all`，让两半各自到达后绘制。** 独立绘制仍会把两件事混在一页；只想看配额的用户仍会挂载账本。

**把 Status 的 id 从 `usages` 改成 `status`。** 已有认识 `usages` 的测试和快照会为一次纯文案改动而 churn。

**加速 Host 上的 `usage.panel` 折叠。** 产品故障是耦合的 UI 加载，不是已证实的一行 Host bug。

## 后果

配额卡片无需扫描本地账本即可出现。历史无需等待提供方 HTTP 即可出现。只想看一面的用户不必打开另一面。用量 chip 仍只有一个「查看全部」入口；它现在落到限额，而不是状态。

## 测试

`usages-section.client.spec.tsx` 钉住 Status 在不调用 `accountUsage` 的情况下绘制，包括挂起的配额 API。`quotas-section.client.spec.tsx` 钉住 Limits 在不调用 `usage.panel` 的情况下绘制，包括挂起的 panel API。`usage-status-chip.client.spec.tsx` 钉住「查看全部」调用 `openQuotas`。`browser-plugin.client.spec.ts` 钉住分节 id 为 `quotas` 然后 `usages`，以及 chip 注入打开 `quotas`。`settings-root.client.spec.tsx` 钉住两个 id 共用 Enhance 图标。

## 相关

Host 本地账本、`$DSH_HOME/usage-panel.json` 和 `usage.panel` RPC 仍由 [Settings 用量面板](../feature/2026-08-25-settings-usage-panel.zh.md) 持有。
