# Agent Note: Cursor 的月度套餐配额接入共享配额表面

Status: implemented

[English](2026-09-10-cursor-monthly-quota.md) | 中文

## 问题

Cursor 路由没有任何配额表面：设置 → 限额、侧栏徽章的配额片段、composer 的内圈仪表环对 Cursor 全部不渲染，尽管账号的套餐用量正是限制 composer 模型运行的闸门。

## 决策

`llm-cursor` 新增 `usage.ts`：向 agent 协议所在的同一 `api2.cursor.sh` 源发一次一元 Connect-JSON 调用 `aiserver.v1.DashboardService/GetCurrentPeriodUsage`，使用与生成相同的 JWT，完整支持中止。`CursorAgentAdapter.accountUsage` 把响应中的 auto 桶——本 adapter 列出的全部 composer/grok 模型都取自该桶——映射为一个 `monthly` 窗口，以计费周期结束时间为重置时间。端点存在性与载荷字段在实现前已对账号实测确认（`GetUsageSummary` 返回 404；`cursor.com/api/usage` 要会话 cookie，不收 JWT）。

客户端配额表面学会该窗口：`quotaWindowLabel`/`quotaChipSegment` 新增 `monthly` 分支（`Monthly`/`每月`/`Mensal`/`Mensual`），侧栏徽章读作 `47% mensal`，composer 圆环与 tooltip 跟随同一窗口。

## 备选方案

**把 auto 与 API 两个桶报成两个窗口。** 暂时否决：本 adapter 服务的所有模型都在 auto 桶，一个窗口就是卡住用户运行的那个数字；若日后 adapter 列出按名调用的前沿模型，API 桶再加入。

**读取 `requests` 式的按请求计量窗口。** 该端点上不存在这种窗口——此套餐的 Cursor 按月计量。

## 影响

Cursor 以真实的月度窗口加入各配额表面；`fetchCursorAccountUsage` 在 401/403 抛出 `AUTH`，面板因此走上与其他提供方一致的"usage error"恢复路径。探测成本为每个表面每分钟一次一元 JSON POST。

## 验证

`usage.spec.ts` 钉住线路径、bearer 头、auto 桶映射（百分比、limit-100 归一化、周期重置）、AUTH 映射以及缺少 auto 桶时的响亮失败；徽章 spec 钉住 `47% monthly` 片段。实现前已通过实测确认端点与载荷。
