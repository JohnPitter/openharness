# Agent Note: 活会话可以切换 agent preset

Status: implemented

[English](2026-08-22-live-session-agent-preset-switch.md) | 中文

## 问题

一旦会话里出现过任何 `turn/start`，标题旁就把模式显示为静态装饰，且 `agentPreset.select` 返回 `agent-preset-locked`。要换成 PTC、Standard、Workflow 或自定义 preset，只能新开会话，对话随之丢掉。

## 决策

`agentPreset.select` 会重组活会话。该 agent 已经在运行所选 preset 时是空操作；`agent.status === 'running'` 时返回 `agent-preset-locked`；否则 `recompose` 并追加 `agent-preset/selected`。会话标题是菜单，名单与 General 行相同。子会话（`origin === 'subagent'`）只显示名称，因为它 `composeFrom` 父会话。新建会话 chip 仍然只暂存空白会话。

历史上的工具调用留在日志里；之后的轮次使用新组装。重建本来就读 `resolveSessionPreset`，因此恢复跟随最后一次切换，而不是创建头部。

这推翻了[按会话组装 preset](../architecture/2026-08-03-per-session-agent-presets.zh.md) 里「仅空白可切」的产品规则。

## 考虑过的替代方案

**维持仅空白可切。** 否决：操作者要保留的正是这段对话。

**把切换排队到当前轮次结束。** 否决：那一轮是在先前的工具下开始的；在 `turn/end` 时静默替换，会在操作者并未重发的提示下改掉组装。

**为新 preset 另开会话。** 否决：它丢掉操作者正在看的日志。

## 后果

斜杠目录仍通过既有的 `agent-preset/selected` 转发失效。更改 General 行的默认值仍然不会改写活会话。先前 preset 留下的工具卡片仍在记录里。

## 测试

`api-proxy-agent-preset.spec.ts` 在 `turn/end` 之后重组，并在 `status === 'running'` 时拒绝。`components.client.spec.tsx` 驱动标题菜单、进行中禁用、子会话名称，以及被拒绝的选择。Web e2e 的标题快照是按钮；后续用例从该控件切换已播种的会话。
