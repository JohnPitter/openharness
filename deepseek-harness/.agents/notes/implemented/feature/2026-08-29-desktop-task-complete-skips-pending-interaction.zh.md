# Agent Note: 桌面端"任务完成"提示音跳过等待用户交互的暂停

Status: implemented

[English](2026-08-29-desktop-task-complete-skips-pending-interaction.md) | 中文

## 问题

`watchDesktopTaskComplete`（`packages/client/ui-conversation/src/client/desktop-complete.ts`）在根会话（无父级、非子代理）的 `running` 位从 true 变为 false 时，就会通知 OpenHarness 外壳播放提示音，并在窗口位于后台时弹出系统通知。但 `running` 只反映 Host 当前是否正在推进一个轮次，并不代表用户的任务真正结束：当会话因审批提示、计划审阅或 `ask_user_question` 调用而阻塞时，Agent Loop 同样会把它置为 false——这些情况侧栏已经用自己的琥珀色"待处理交互"圆点单独标出。提示音在这类暂停上的触发方式与真正完成时完全相同，于是桌面应用在会话仍在任务途中等待用户时就宣布"完成"。

## 决策

`rootTaskCompletions` 现在除了原有的 running 位边沿判断外，还要求 `row.pendingInteraction === undefined` 才会报告一次完成。`SessionSummary.pendingInteraction?: PendingInteractionStatus`（`'approval' | 'plan-review' | 'question'`）本就为侧栏的待处理交互指示器携带同一信号，由 Host 通过 `rootTaskCompletions` 已经读取的同一份列表投影填充与清除，因此无需新增字段或事件。running 位的差分（`prev`/`next`）仍然如实记录暂停期间的 `running: false`；待用户作答、Agent 恢复并真正完成后，下一次 true→false 边沿不再带有待处理交互，会正常触发提示音。子代理与子会话行的排除方式保持不变——`isRootTaskSession` 未作修改。

## 考虑过的替代方案

**改用客户端计时器抑制提示音**（例如若 N 秒内出现提问就不响）。不予采纳：计时器是在与真实 Host 延迟赛跑，既可能仍然误触发，也会给真正完成的情况带来可见延迟；`pendingInteraction` 正是同一场景下、来自 Host 的权威信号。

**把判断移入 `watchDesktopTaskComplete` 的 sink，而非 `rootTaskCompletions`。** 不予采纳：完成判定应留在这个纯差分函数里，使其无需 store／window 测试夹具即可单元测试，与决策（`rootTaskCompletions`）和投递（`watchDesktopTaskComplete`／`postDesktopTaskComplete`）现有的职责划分保持一致。

## 后果

根会话因审批、计划审阅或提问而暂停时，不再触发提示音或后台通知；真正的空闲（无待处理交互）依旧会触发，包括用户作答后 Agent 继续并完成的情形。未来新增的任何 `PendingInteractionStatus` 取值都会被同一个 `undefined` 判断覆盖，无需改代码。

## 验证

`packages/client/ui-conversation/tests/desktop-complete.client.spec.ts` 中的表驱动单元测试覆盖了全部三种 `PendingInteractionStatus` 取值下的暂停均不触发提示音，并通过 `rootTaskCompletions` 验证了"运行中 → 待处理提问 → 恢复 → 真正空闲"的完整序列：暂停阶段不触发提示音，真正完成时恰好触发一次。
