# Agent Note: 编辑已发送的用户消息

Status: implemented

[English](2026-08-24-edit-sent-message.md) | 中文

## 问题

已定稿的用户消息属于持久化历史，但修正文案过去需要手动开始另一段对话。原地编辑还需要改写原会话后续轮次、图片和派生状态，这与只追加存储相冲突。

## 决策

在没有运行中的任务时，已定稿的用户气泡显示编辑操作；steering 消息和窗口中的第一轮不显示，因为空前缀无法 fork。该操作会把文本预填入 composer，并显示带取消操作的编辑指示器；按 Escape 或取消按钮会恢复原草稿。编辑状态下发送消息会在前一轮 `turn/end` 的 seq 处分叉，并使用 `increaseTitle: false`，在子会话中 prompt 修订后的文本，然后切换到子会话。失败时保留草稿和编辑状态，并显示 `message.editFailed`。

Fork 会复制文本历史前缀，但不会复制原消息的图片。原会话保持不变，因此编辑是基于只追加会话存储的文本修正路径，而不是原地改写。

## 曾考虑的替代方案

**在原会话中截断。** 否决：这需要基础性的持久化重写，并会销毁原始 transcript。

**把原消息的图片复制到子会话。** 否决：编辑操作只修正用户文本；图片身份和上传生命周期不属于 fork 后的 prompt。

## 后果

用户可以修改符合条件的已定稿用户消息，同时保留原会话及其后续轮次。子会话从编辑消息之前紧邻的已完成轮开始，不增加标题，并把修订文本作为第一个新 prompt 执行。窗口中的第一轮不可编辑，编辑提交也不会携带原消息的图片。zh/en/pt/es 都提供 `message.edit`、`message.editing`、`message.cancelEdit` 和 `message.editFailed` locale key。

## 测试

`tests/message-edit.client.spec.tsx` 覆盖十个用例，包括资格判断、草稿恢复、fork 边界与标题行为、仅文本 prompt、切换、失败保留和 locale 展示。更新后的 chat-branch-tails、chat-view 和 queue-dock fixtures 覆盖装配后的会话状态。
