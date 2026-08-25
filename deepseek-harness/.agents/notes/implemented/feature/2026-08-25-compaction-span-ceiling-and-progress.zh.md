# Agent Note: 摘要区间上限与压缩进度

Status: implemented

[English](2026-08-25-compaction-span-ceiling-and-progress.md) | 中文

## 问题

在 1M 上下文路由上，envelope 感知的半窗上限仍会为一次摘要调用选出约 475k tokens。K3 始终推理，因此该请求经常超过五分钟事务截止时间。`/compact` 随后显示 “Command was interrupted before completion.” 运行中的行只有转圈，进行中的调用看起来像卡住。

## 决策

`summarizerSpanBudget` 仍计算 `floor(window / 2) - maxTokens - envelope`。正结果再取 `min(SUMMARIZER_SPAN_CEILING, 该值)`，其中 `SUMMARIZER_SPAN_CEILING = 65_536`。envelope 感知结果为零时保持为零，因此小广告窗口上的压力仍不设上限。压力、溢出和 `compactNow` 都经过该函数。

当压力重试已落地替换但仍高于阈值时，`compactIfNeeded` 返回最近一次结果，而不是抛出。下一次 `agent/pre-step` 从该替换继续。不能缩小源内容的摘要仍在区域事务内被拒绝。

`/compact` 的 Chat 运行行，以及未匹配的自动 `compaction/start`，会显示一条定量进度条和已用时间。进度条按宿主使用的同一五分钟截止（`COMPACTION_OPERATION_TIMEOUT_MS`）填充，在检查点落地前封顶 92%。进度只用于呈现：不是会话事件。

这扩展了[按请求路由的压力压缩](../bug-fix/2026-08-24-request-route-pressure-compact.zh.md)中的区间上限，以及[中断与截止](../bug-fix/2026-08-25-compaction-interruption-and-deadline.zh.md)中的截止时间。它不引入分块多事务摘要，[溢出重试说明](../bug-fix/2026-08-24-compaction-overflow-retry.zh.md)已经拒绝过该设计。

## 考虑过的替代方案

**只保留半窗作为上限。** 不予采纳：那是给 128K 摘要路由的适配边界，不是延迟边界。在 1M 上仍会发送约五十万 token 的请求。

**一次 `/compact` 内做分块多事务摘要。** 不予采纳：一条命令里多个有损检查点，且溢出重试说明已经拒绝该设计。后续步骤或再次 `/compact` 会从已封顶的替换继续。

**记录 `compaction/progress` 事件或实时 projection。** 不予采纳：百分比和已用时间是如何绘制运行行。会话日志仍只保存锁和摘要。从 `command/run` 或 `compaction/start` 计算已用时间足以证明该行仍在运行。

**提高五分钟截止。** 不予采纳：忽略 abort 的提供方会把维护接纳占得更久。缩小请求，让它在现有截止内完成。

## 后果

128K 路由不变（约 39k envelope 感知预算，低于上限）。1M 路由每次最多摘要 65,536 个计价 token，更可能在超时前完成。远超阈值的会话可能需要不止一次压力步骤或 `/compact` 才能把占用降下来。运行中的进度条是相对截止的估计，不是按生成 token 的精确进度。

## 测试

`compaction-basic.spec.ts` 覆盖 272K 与 1M 窗口上的上限、不变的 128K envelope 感知预算，以及仍高于阈值时保留最近一次替换。会话节点 spec 覆盖未匹配 `compaction/start` 的运行中自动标记，以及失败的 `compaction/end` 之后隐藏该标记。`compaction-progress.client.spec.tsx` 驱动定量进度条和 250ms 节拍。
