# Agent Note: 自适应压缩溢出重试

Status: implemented

[English](2026-08-24-compaction-overflow-retry.md) | 中文

## 问题

v0.1.23 在真实的 272K Codex（`gpt-5.6-sol`）会话上仍会压缩失败：每次 `/compact` 都以 `pi-ai detected context overflow` 结束，并以通用的 `could not produce a useful summary` 呈现。原因有两个：llm-pi-ai 将客户端检测到的溢出归类为通用 `PI_AI_ERROR`，而不是 `CONTEXT_WINDOW_EXCEEDED`，因此没有恢复路径识别它；此外，由于附件和 base64 会扩展请求，token 估算可能低于提供方的实际计数，所以仅靠确定性预算无法保证请求装得下。

## 决策

共享 LLM 错误分类器和 pi-ai 流映射会把 pi-ai 的 `detected context overflow` 错误映射为规范的 `CONTEXT_WINDOW_EXCEEDED` 代码。

压缩在一个事务内自适应重试：在一个压缩 start/end 括号和同一个 `compactionId` 下最多执行三次尝试。每次 `CONTEXT_WINDOW_EXCEEDED` 或 `MAX_TOKENS` 后，跨度预算减半并重新选择平衡区间。尝试之间不会修改表层；取消和其他错误不会重试。已经包含全部检查点标题的 `max-tokens` 结束会被直接接受，不进入重试；见 [输出上限压缩](2026-08-27-compaction-max-tokens-retry.zh.md)。

窗口解析器使用记录下来的 `requestContext` 窗口。未定义的窗口使用明确的 128K 安全回退（`SUMMARIZER_CONTEXT_WINDOW_FALLBACK`）；null 或无效窗口以零预算 fail-closed，且不调用 LLM。压力在 envelope 感知上限为正时转发该上限；该预算为零时不设上限。正结果再受 `SUMMARIZER_SPAN_CEILING` 约束（[区间上限](../feature/2026-08-25-compaction-span-ceiling-and-progress.zh.md)）。`compactNow` 在选择区间前会剪枝超大工具结果。

`/compact` 消息只追加允许列表中的稳定错误代码，例如 `CONTEXT_WINDOW_EXCEEDED`；绝不暴露原始错误链或提示内容。

## 备选方案

**同步查询目录窗口。** 不予采用：`LlmRuntime` 没有同步 API，而在维护锁之前异步执行 `resolveModelInfo` 会破坏锁定。

**分块进行多事务摘要。** 不予采用：这会产生多个有损摘要，并增加括号复杂度。

## 影响

没有记录窗口且窗口大于 128K 的路由会更激进地压缩。上下文窗口不匹配时最多增加两次摘要器尝试，而不是仅凭估算保证装入；重试吸收提供方侧的扩展，而不是消除这种不匹配。

## 测试

281 项测试覆盖 LLM 服务、llm-pi-ai 适配器、compaction-basic 与 command-compact，包括只使用一个 start/end 括号的流拒绝重试、后缀和无原始错误链断言，以及回退窗口和 fail-closed 窗口。宿主 tsc 通过，compaction 包的 oxlint 通过，官方构建也验证了其标记。
