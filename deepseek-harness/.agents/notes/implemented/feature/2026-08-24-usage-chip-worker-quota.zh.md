# Agent Note: Workflow 模式用量 chip 显示工人配额

Status: implemented

[English](2026-08-24-usage-chip-worker-quota.md) | 中文

## 问题

在 Workflow 模式中，用量 chip（侧栏配额弹窗）只显示规划器的路由和账户配额；即使工人可能运行在不同提供方上，工人的模型和配额仍不可见。

## 决策

`UsageStatusChipInjected` 增加了可选的 `workerDirectory`（`WorkerModelState` 的宿主 observable 或快照存储）；只有存在工人时，slot 注入才会展开传入 `workerDirectory: worker.store`。当当前会话 preset 是 `workflow` 且存在工人选择时，面板会渲染一行紧凑信息（`dt` = `role.worker` 标签，`dd` = 通过 `routeLabelFor` 得到的工人模型），以及工人的 `QuotaSection`。工人配额通过现有的 `loadAccountUsage(workerProviderId)` 加载；工人与规划器共用提供方时，复用已经加载的配额（不发起第二次请求）。失败会按提供方在行内显示（Error 的 message 或 `String(error)`）。不新增 CSS 类；工人的 `QuotaSection` 复用现有带边框分隔线的 `.quota`。`routeLabelOf` 已重构为非空的 `routeLabelFor(directory, selection)`。

## 曾考虑的替代方案

**按工人拆分会话 token。** 否决，因为 token-meter 没有按角色统计，工人 token 会落在 subagent 会话中。

## 后果

只有在 Workflow 模式下，chip 才会增加一行和一个配额区段；共用提供方的设置不会产生额外网络请求。

## 测试

`packages/client/ui-model-selection/tests/usage-status-chip.client.spec.tsx` 新增四项测试，覆盖工人路由与配额渲染、使用 `toHaveBeenCalledTimes(1)` 验证共用提供方复用、workflow preset 之外的省略，以及 Error 和非 Error 拒绝消息。整个包 64 项测试通过，oxlint 为 0，`tsc -b tsconfig.client.json` clean。
