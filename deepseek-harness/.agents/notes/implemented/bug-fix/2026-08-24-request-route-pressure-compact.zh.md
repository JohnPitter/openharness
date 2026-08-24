# Agent Note: 按请求计费路由仍跑压力压缩

Status: implemented

[English](2026-08-24-request-route-pressure-compact.md) | 中文

## 问题

通用设置暴露 `compaction-basic.auto` 与 `thresholdPercent`（默认 75%）。在按请求计费的编码计划路由上，压力路径会剪枝工具结果，然后跳过摘要器以节省配额。占用率爬到 100%。规范溢出和 `/compact` 随后把几乎整份表层发给同一模型；该辅助调用自己溢出，会话不变，`/compact` 报告无法产生有用摘要。

## 决策

压力压缩 LLM 在每一种计费单位上都会跑。实时覆盖仍是设置 → 通用：`auto` 与 `thresholdPercent`。按请求计费的路由仍跳过自动标题提供方；该跳过留在[路由计费 note](../feature/2026-08-23-route-metering.zh.md)。

溢出和 `compactNow` 会限制已计价区间，使摘要请求在最新 `request/context` 带有容量时装进已路由窗口。没有窗口时仍尝试一次最大平衡缩减。

## 备选方案

**保留压力跳过，只在设置里说明。** 不予采用：通用控件会宣传 75% 压缩，却从不在 Codex、Kimi、Claude Code、GLM 或 OpenCode 上摘要。

**在按请求计费路由上连溢出和 `/compact` 也跳过。** 不予采用：已经顶到窗口的会话没有恢复路径。

**把摘要器发到另一条按 token 计费的模型。** 不予采用：没有已配置的摘要器对，且会话模型已经持有该调用要复用的热前缀。

## 影响

编码计划上每一次自动压力压缩花费一次请求。已经 100% 的会话可通过溢出或 `/compact` 恢复，而不让摘要器自己溢出。按请求计费路由仍跳过标题生成。

## 测试

`compaction-basic.spec.ts` 覆盖剪枝无法清阈值时按请求计费压力仍摘要、该计费上溢出仍摘要、`maxSpanTokens` 切短从头锚定区间、小窗口上 `summarizerSpanBudget` 余量，以及溢出压缩大于已公布窗口的会话。`compaction-loop-repro.spec.ts` 仍通过真实循环恢复抛出与带内 `CONTEXT_WINDOW_EXCEEDED`。
