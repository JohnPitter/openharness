# Agent Note: 侧栏徽章与 composer 圆环上的首要配额窗口

Status: implemented

[English](2026-09-09-quota-ring-composer-chip.md) | 中文

## 问题

coding plan 的配额过去要点两次才能看到：侧栏徽章只显示上下文占用，套餐配额只在点击展开的面板里；composer 的上下文圆环也没有账户级的对应物。coding plan 用户最关心的数字——5 小时窗口——在工作时完全不可见。

## 决策

`ui-model-selection` 新增共享的实时配额模块（`usage-quota-live.ts`）：`useProviderQuota` 在挂载、切换提供方以及每 60 秒加载暂存提供方的账户窗口（限额面板仍在打开时重新加载）；`pickLeadWindow` 以披露的最短窗口——5 小时式限额——为首要窗口，否则回退到最早重置的（周式）窗口；`quotaChipSegment` 渲染紧凑的 `42% 5h` / `42% weekly` 片段。侧栏徽章的 meta 行追加该片段，因此配额探测不再等待面板打开。新的 `QuotaRing` 组件注册进 ui-conversation 已有的、此前无人占用的 `conversation.input.right` 槽位：发送按钮旁的圆环显示首要窗口的百分比，tooltip 给出窗口名称与重置时间，点击进入设置 → 限额。当提供方没有配额表面或最近一次探测失败时，两处表面都隐藏。共享的 `Ring` 仪表移入 `usage-quota.tsx`，样式类由调用方提供。

## 备选方案

**改 ui-conversation 的 InputBar 自行取配额。** 否决：配额知识（提供方目录、`loadAccountUsage`、限额导航）属于 ui-model-selection，且跨包引用被禁止；`conversation.input.right` 槽位正是为该行的小型控件预留的。

**让圆环跟随上下文圆环的可见性。** 否决：配额是账户级的，即使在提供方首次应答上报上下文压力之前也有意义。

## 影响

每个已配置 coding plan 的首要窗口在侧栏底部和 composer 都一目了然；配额端点从每次打开面板一次变为每个挂载表面每分钟一次探测。无配额表面的按 token 计费路由渲染与之前完全一致。

## 验证

`usage-status-chip.client.spec.tsx` 钉住 meta 片段（`40% · 100K · 70% 5h`）、每周回退与不变的面板行为；`quota-ring.client.spec.tsx` 钉住 5 小时首要窗口、每周回退、重置 tooltip、点击跳转限额页以及三种隐藏状态。
