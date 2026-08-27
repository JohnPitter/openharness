# Agent Note: Compaction retries output-cap truncation

Status: implemented

[English](2026-08-27-compaction-max-tokens-retry.md) | 中文

## 问题

空闲剪枝开始生效之后，一个真实的 Workflow 会话（`session-4e0e8fdd`，513 个回合，表层约 134k token）仍然连续三次 `/compact` 失败。每次都会剪枝、打开 `turn: null` 括号、让摘要器跑约 97 秒，然后以 `summarization truncated at the token cap (incomplete checkpoint)`（`MAX_TOKENS`）关闭。没有落地 `compaction/summary`。

摘要器默认上限是 8192 token，并且可能包含推理。啰嗦或必须思考的模型会在全部检查点标题写完之前把这个上限用尽。区间事务已经会在 `CONTEXT_WINDOW_EXCEEDED` 时把跨度减半重试；它把 `MAX_TOKENS` 当成终止性摘要失败，因此用户只能对同一段过大跨度再次调用 `/compact`。

## 决策

`max-tokens` 结束时，若投影文本（可见文本，或可见为空时的推理）按顺序包含全部必需检查点标题，则视为完整检查点并提交。不完整的截断正文仍以 `MAX_TOKENS` 失败。

该 `MAX_TOKENS` 失败会在同一个 start/end 括号内把跨度预算减半重试，最多共三次，与 [溢出重试](2026-08-24-compaction-overflow-retry.zh.md) 相同。取消和其他错误仍然 fail-closed。

## 备选方案

**只提高默认 `maxTokens`（8192）。** 不能作为唯一修复：更长的上限会把已经约 97 秒的调用拖得更久，而且仍会败给把前几节写成散文的模型。缩小跨度重试才是溢出路径已经在做的事。

**落地任何截断文本。** 不予采用：若截断从未到达 `## Next Step`，恢复指令就丢了。标题齐全时才提交；不完整则缩小跨度。

**专用摘要模型。** 此缺陷不予采用：会话目标对齐的是前缀缓存；换模型是另一项策略。

## 影响

`/compact` 可以在输出上限截断但标题已齐时完成，或在一两次更小跨度重试后完成。三次之内仍写不出完整检查点的会话保留先前的 `MAX_TOKENS` 关闭，表层不变。

## 测试

`compaction-basic.spec.ts` 在 `max-tokens` 上接受按顺序齐全的标题（含仅推理输出），并拒绝从未到达 Next Step 的正文。`manual-compaction.spec.ts` 在一个 start/end 括号内重试 `MAX_TOKENS` 并落地 `compaction/summary`。
