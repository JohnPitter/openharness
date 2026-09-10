# Agent Note: 侧栏徽章与 composer 仪表内部的首要配额窗口

Status: implemented

[English](2026-09-09-quota-ring-composer-chip.md) | 中文

## 问题

coding plan 的配额过去要点两次才能看到：侧栏徽章只显示上下文占用，套餐配额只在点击展开的面板里；composer 的上下文圆环也没有账户级的对应物。coding plan 用户最关心的数字——5 小时窗口——在工作时完全不可见。

## 决策

`ui-model-selection` 新增共享的实时配额模块（`usage-quota-live.ts`）：`useProviderQuota` 在挂载、切换提供方以及每 60 秒加载暂存提供方的账户窗口（限额面板仍在打开时重新加载）；`pickLeadWindow` 以披露的最短窗口——5 小时式限额——为首要窗口，否则回退到最早重置的（周式）窗口；`quotaChipSegment` 渲染紧凑的 `42% 5h` / `42% weekly` 片段。侧栏徽章的 meta 行追加该片段，因此配额探测不再等待面板打开。

在 composer 中，两个仪表同心叠放，如同一个表盘的圈层：ui-conversation 声明新的 `conversation.input.meterCenter` 槽位，渲染在上下文仪表的触发按钮内部；ui-model-selection 的 `QuotaRing` 占用它，把首要窗口画成**内圈**弧线——外圈仍是上下文占用。触发按钮保留上下文明细面板的点击与 tooltip；内环是纯视觉元素，其 SVG title 携带窗口名称与重置时间。当提供方没有配额表面或最近一次探测失败时，两处表面都隐藏。共享的 `Ring` 仪表移入 `usage-quota.tsx`，样式类由调用方提供。

## 备选方案

**在上下文圆环旁放独立的配额按钮（`conversation.input.right`）。** 被产品决策否决：两个并排的表盘读起来像两个无关的控件；叠放的单表盘用一个交互承载两个读数。

**改 ui-conversation 的 InputBar 自行取配额。** 否决：配额知识（提供方目录、`loadAccountUsage`）属于 ui-model-selection，且跨包引用被禁止；槽位交接让两边各自拥有自己的一半。

## 影响

每个已配置 coding plan 的首要窗口在侧栏底部和 composer 都一目了然；徽章与圆环通过 60 秒缓存每提供方每分钟共享一次探测（[探测超时](2026-09-10-quota-probe-timeout-and-progressive-limits.zh.md)）。无配额表面的按 token 计费路由渲染与之前完全一致。上下文仪表的触发按钮新增 `position: relative` 与居中覆盖容器。

## 验证

`usage-status-chip.client.spec.tsx` 钉住 meta 片段（`40% · 100K · 70% 5h`）、每周回退与不变的面板行为；`quota-ring.client.spec.tsx` 钉住 5 小时首要窗口、每周回退、重置标签与三种隐藏状态；`context-meter.client.spec.tsx` 钉住占用者叠放在触发按钮内部且点击仍打开上下文面板，以及无占用者时渲染不变。
