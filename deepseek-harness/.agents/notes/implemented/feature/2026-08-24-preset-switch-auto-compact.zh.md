# Agent Note: 切换 preset 后自动压缩

Status: implemented

[English](2026-08-24-preset-switch-auto-compact.md) | 中文

## 问题

会话在 `agent-preset/selected` 变更后重新组合时，会留下由旧 preset 编写的历史记录。该历史包含过时的工具调用以及过时的提示词／工具调用界面，因此下一次请求可能让新组合继续处理不兼容的上下文，导致后续工具执行失败。

## 决策

Host 为每个会话保留一个内存中的 `needsCompact` 标志。已提交的 `recompose` 加 `agent-preset/selected` 会设置该标志；下一次普通的 `sessions.prompt` 在准入前运行 `compactAfterPresetSwitch`。该操作串行在现有的每会话链上，通过 commands service 调用 `/compact`，并且只在压缩成功后清除标志。缺少 commands service 或历史为空时不执行任何操作；失败会保留标志并向调用方返回错误。因此并发 prompt 只会执行一次压缩，且没有持久化事件记录这项临时维护意图。

压缩摘要时使用当前组合的 system prompt 和工具。生成的检查点会移除按 preset 产生的过时历史，并让下一次模型请求使用当前 preset 选择的工具调用界面。

## 曾考虑的替代方案

**在 preset 切换时立即压缩。** 否决：用户切换 preset 后不再恢复会话时，会浪费一次请求。

**把标志持久化为事件。** 否决：该标志是临时维护意图，不是会话历史或模型可见状态。

## 后果

已提交的 preset 切换之后，恢复的会话会在第一次普通 prompt 前完成清理，同时不改变只追加的会话日志。显式 compact 命令以及没有已提交切换的 prompt 保持原有行为。如果压缩无法执行，会话仍标记为待重试，原始错误会返回给调用方。

## 测试

`packages/host/apiproxy/tests/api-proxy-preset-compact.spec.ts` 覆盖七个用例，包括成功清理、前置条件不满足时的 no-op、失败重试、链串行化和并发 prompt。
