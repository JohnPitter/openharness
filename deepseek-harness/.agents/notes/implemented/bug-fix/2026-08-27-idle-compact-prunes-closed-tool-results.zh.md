# Agent Note: 空闲 `/compact` 剪枝已关闭的工具结果

Status: implemented

[English](2026-08-27-idle-compact-prunes-closed-tool-results.md) | 中文

## 问题

`compactNow`——`/compact` 以及宿主在切换 preset 之后的压缩路径——会在空闲 agent 上剪枝超大工具结果，然后打开独立的 `turn: null` 压缩括号。会话不变式把 `tool/result` 表层替换当作必须包在轮次里的工作，并在没有开放轮次时拒绝它。自动压力剪枝仍然能跑，因为 `agent/pre-step` 时已经有 `turn/start`。手动压缩不能。

Workflow 让这个缺口对用户可见。规划器日志主要是大型 `subagent` 结果，切到 Workflow preset 总会在下一条 prompt 之前排队 `/compact`。那次剪枝抛错，命令失败，prompt 不被接纳。带有超大工具结果的 Standard 会话走同一条空闲路径。

现场 `tool/result` 追加仍然要点名开放步骤。这次改写不是对该调用的第二次执行；它与压缩检查点 `user/message` 同属空闲表层改写。

## 决策

会话不变式允许在没有开放轮次时落地 `tool/result` 替换。现场追加仍要求开放步骤以及该步骤内的 `tool/call` 配对。`compactNow` 仍在打开独立括号之前剪枝。开放轮次中的自动剪枝不变。

## 备选方案

**为空闲剪枝打开一个占位轮次，再在 `turn: null` 括号之前关闭。** 不予采用：`compactNow` 拒绝已开放轮次，因此占位轮次必须在摘要之前关闭，等于给并非压缩工作的操作加一轮包装。

**没有开放轮次时跳过 `compactNow` 的剪枝。** 不予采用：空闲 `/compact` 正是最需要先缩小超大工具结果、再跑摘要器的恢复路径。跳过会重新引入[整段表层上的摘要器溢出](2026-08-24-request-route-pressure-compact.zh.md)。

**只允许紧跟 `compaction/prune` 的替换。** 不予采用：剪枝把影子计价事件和替换作为相邻写入追加；不变式必须特判会话包并不拥有的事件，而该替换已经作为单节点内容改写通过校验。

## 影响

`/compact` 和切换 preset 之后的压缩可以在已关闭会话上剪枝。带有大型 `subagent` 结果的 Workflow 父会话可以在空闲时压缩。开放步骤之外的现场 `tool/result` 追加仍然失败。

## 测试

`packages/core/session/tests/invariant.spec.ts` 允许在 `turn/end` 之后替换。`tool-result-pruner.spec.ts` 在真实不变式下剪枝已关闭会话。`manual-compaction.spec.ts` 通过空闲、已关闭、含超大 `subagent` 结果的日志驱动 `compactNow`，并加载 `SessionInvariant`，期望出现 `compaction/prune` 以及已提交的检查点。
