# Agent Note: 桌面端"任务完成"提示音跳过等待用户交互或仍在运行的子代理的暂停

Status: implemented

[English](2026-08-29-desktop-task-complete-skips-pending-interaction.md) | 中文

## 问题

`watchDesktopTaskComplete`（`packages/client/ui-conversation/src/client/desktop-complete.ts`）在根会话（无父级、非子代理）的 `running` 位从 true 变为 false 时，就会通知 OpenHarness 外壳播放提示音，并在窗口位于后台时弹出系统通知。但 `running` 只反映 Host 当前是否正在推进一个轮次，并不代表用户的任务真正结束——两种不同的情况暴露了这个缺口：当会话因审批提示、计划审阅或 `ask_user_question` 调用而阻塞时，Agent Loop 会把它置为 false（这些情况侧栏已经用自己的琥珀色"待处理交互"圆点单独标出）；而 Workflow 规划者自身的轮次可能在派发一个 worker 之后立刻结束（`running: false`），远早于该 worker（或它再派发的 worker）完成。这两种情况触发提示音的方式都和真正完成时完全相同，于是桌面应用在会话仍在等待用户、或它启动的子代理仍在工作时就宣布"完成"。

## 决策

`rootTaskCompletions` 现在除了原有的 running 位边沿判断外，还要求满足两个条件：`row.pendingInteraction === undefined`，以及没有仍在运行的后代。`SessionSummary.pendingInteraction?: PendingInteractionStatus`（`'approval' | 'plan-review' | 'question'`）本就为侧栏的待处理交互指示器携带暂停信号，由 Host 通过 `rootTaskCompletions` 已经读取的同一份列表投影填充与清除，因此这一半无需新增字段或事件。对于子代理这一半，新增的 `hasRunningDescendant(sessionId, byId)` 会遍历 `byId`，查找 `parentId` 链最终指向本会话、且 `running: true` 的任意行；`byId` 携带 Host 报告的每一个已附加会话——包括子代理子会话——无论客户端是否打开过任何目录面板，因为 Host 的 `sessions.list` 会包含当前每一个已附加（驻留内存）的会话，而不只是客户端展开过的那些。因此根会话被跟踪的"忙碌"位（`prev`/`next` 映射）现在是 `row.running || hasRunningDescendant(...)`，而不是原始的 running 位：规划者在派发一个仍在工作的子代理后立刻空闲时，该映射中仍保持忙碌，直到该子代理（及其自身的任何后代）也完成为止，因此最终真正的空闲——不再有运行中的后代，也没有待处理交互——仍会被判定为一次 true→false 边沿，恰好触发一次提示音。子代理与子会话行仍和以前一样被排除在外，不会触发自己的完成——`isRootTaskSession` 未作修改。

## 考虑过的替代方案

**改用客户端计时器抑制提示音**（例如若 N 秒内出现提问或子代理就不响）。不予采纳：计时器是在与真实 Host 延迟赛跑，既可能仍然误触发，也会给真正完成的情况带来可见延迟；`pendingInteraction` 与子代理目录行都已经是来自 Host 的权威信号。

**只检查直接子会话，或读取当前已打开的子代理目录而非 `byId`。** 不予采纳：子代理本身也可能再派发下一层子代理（嵌套的 Workflow 委派），只有完整的后代遍历才能覆盖每一层；目录（`subagentsByParent`）只为客户端显式打开过的父会话惰性填充，恰恰会漏掉本修复要解决的后台场景——窗口未聚焦、目录从未打开过。`byId` 不需要这样的前置条件。

**把任一判断移入 `watchDesktopTaskComplete` 的 sink，而非 `rootTaskCompletions`。** 不予采纳：完成判定应留在这个纯差分函数里，使其无需 store／window 测试夹具即可单元测试，与决策（`rootTaskCompletions`）和投递（`watchDesktopTaskComplete`／`postDesktopTaskComplete`）现有的职责划分保持一致。

## 后果

根会话因审批、计划审阅或提问而暂停时，不再触发提示音或后台通知；仅仅因为刚派发了一个仍在运行（或其后代仍在运行）的子代理而空闲的根会话同样不会触发。真正的最终空闲——无待处理交互、无运行中的后代——依旧会触发提示音，包括用户作答后 Agent 继续并完成、或最后一个派发的子代理完成之后。未来新增的任何 `PendingInteractionStatus` 取值都会被同一个 `undefined` 判断覆盖，无需改代码；任意深度的嵌套子代理委派都会被同一个递归后代遍历覆盖。

## 验证

`packages/client/ui-conversation/tests/desktop-complete.client.spec.ts` 中的表驱动与序列化单元测试覆盖了：全部三种 `PendingInteractionStatus` 取值下的暂停均不触发提示音；"运行中 → 待处理提问 → 恢复 → 真正空闲"的完整序列，验证暂停阶段不触发、真正完成时恰好触发一次；Workflow 规划者在派发一个仍在运行的 worker 后立刻空闲（不触发提示音，忙碌位保持 true）；即使根会话更早就空闲了，最后一个运行中的后代完成后仍会触发提示音；通过嵌套子代理链追踪一个仍在运行的孙代会话；以及子代理行无论其父会话状态如何都不会触发自己的完成提示音。
