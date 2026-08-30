# Agent Note: 可配置的压缩摘要区间与更紧的默认上下文收缩预算

Status: implemented

[English](2026-08-30-compaction-configurable-span-and-tighter-defaults.md) | 中文

## 问题

有部署观察到，上下文压缩仍会把接近半个上下文窗口的内容回放给摘要器——最多到[区间上限说明](../feature/2026-08-25-compaction-span-ceiling-and-progress.zh.md)中硬编码的 65,536 token `SUMMARIZER_SPAN_CEILING`——并询问该系统能否更高效，是否可以对代价过高、不宜内联保留的内容采用「落盘再读」的模式。这种模式（`dsh-spill`／`dsh-spill-local`／`dsh-spill-policy`，加上摘要前的 `dsh-compaction-tool-result-pruner`）其实已经存在，也已经在每个工具结果上运行。真正的缺口更窄：这两层的**部署阈值**是较宽松的 v1 默认值，而 `SUMMARIZER_SPAN_CEILING`／`SUMMARIZER_ENVELOPE_RESERVE` 是 `region.ts` 里的硬编码常量，没有对应的 `BasicCompactionConfig` 字段，因此部署方无法在不改源码的情况下缩小摘要器自身回放的输入——这是与仓库自身约定相悖的、随部署而异却被硬编码的选择。

## 决策

`BasicCompactionConfig` 新增两个可选字段：`summarizerSpanCeiling`（默认 `65536`，正整数）与 `summarizerEnvelopeReserve`（默认 `16384`，非负整数），其解析方式与 `maxTokens` 完全一致：顶层默认值，可通过 `modelPolicies` 按精确的提供方／模型对覆盖。`region.ts` 中的 `summarizerSpanBudget`、`loggedSummarizerSpanBudget`、`pressureSummarizerSpanBudget` 把它们作为参数接收，省略时默认为同样的内置常量，因此每个未传入它们的调用方行为保持不变。`compaction-basic` 的 `index.ts`（压力、溢出与 `compactNow` 路径）会解析已路由目标的策略，并转发其 `summarizerSpanCeiling`／`summarizerEnvelopeReserve`，而不是直接读取模块常量。这两个常量仍作为 schema 与参数默认值导出。

与此独立地，压缩上游两层上下文收缩机制的出厂部署默认值被减半：`spill-policy.maxInlineBytes` 从 50000 降为 24000（在基础 bundle 中，宿主级生效，无论激活哪个 agent 预设都适用）；`compaction-tool-result-pruner` 的 `{thresholdChars, headChars, tailChars}` 从 8192/4096/1024 降为 4096/2048/512，凡是配置了它的地方都同步——基础 bundle 以及全部四个 CLI agent 预设（Standard、Code、Workflow、Cordis）。这些正是[工具输出落盘说明](../architecture/2026-07-08-tool-output-spill-files.zh.md)与[压缩能力 seam 说明](2026-06-18-compaction-capability-seam.zh.md)已经描述过的机制；本次改动只调整它们的部署阈值。`dsh-compaction-tool-result-pruner` 包内部的 `DEFAULTS` 常量（仅在部署完全不为该插件提供配置时才会用到）未被改动。

## 考虑过的替代方案

**为摘要回放路径新建一套文件落盘机制。** 不予采纳：落盘与剪枝机制已经存在，也已经在每次压缩摘要调用之前运行。缺的不是能力，而是可配置性与默认值。

**复用 `maxTokens` 作为区间上限，而不新增字段。** 不予采纳：`maxTokens` 限制摘要器的**输出**；区间上限限制的是它的**输入**。把两者混为一谈，会让一次输出上限的改动悄悄也改变回放多少历史。

**保持 `SUMMARIZER_SPAN_CEILING`／`SUMMARIZER_ENVELOPE_RESERVE` 为常量，只调整落盘／剪枝的部署默认值。** 不予采纳：区间上限是一次压缩周期里最大的单项成本旋钮（每次调用最多回放 65,536 token），在昂贵或缓慢路由上的部署若不改源码就无法缩小它。

## 后果

在大上下文窗口上、想要更便宜更快（但更粗略）压缩检查点的部署，可以按模型调低 `summarizerSpanCeiling`／`summarizerEnvelopeReserve`，无需改源码；没有指定这两个字段的既有部署不受影响，因为默认值与此前硬编码的常量完全一致。减半后的落盘／剪枝默认值会更早把超大工具结果落盘、并在压缩调用之前进一步剪枝——同时缩小了普通逐请求上下文与压缩回放的会话前缀——代价是模型在读取完整落盘文件之前，看到的超大结果首尾预览会更短。

## 测试

`compaction-basic.spec.ts` 覆盖了 `resolveConfig`／`resolveTargetPolicy`／`resolveCompactSpec` 对这两个新字段的解析与合并（默认值、顶层覆盖、按模型继承与覆盖）、配置 schema 对非正 `summarizerSpanCeiling` 或负 `summarizerEnvelopeReserve` 的拒绝，以及 `summarizerSpanBudget`／`pressureSummarizerSpanBudget`／`loggedSummarizerSpanBudget` 使用已配置的上限／预留而非内置常量。`verify-cordis-config` 覆盖了被编辑的 bundle 与预设 YAML。
