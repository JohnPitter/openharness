# Agent Note: 将连续的聊天活动节点折叠为一条摘要行

Status: implemented

[English](2026-08-25-chat-activity-summary.md) | 中文

## 问题

一个 Agent 轮次会穿插大量 tool-call 和 command 节点，若每张卡都单独渲染，在长时间探索或编辑期间对话表面会难以阅读。轮次开头的上下文注入（系统提示、技能目录、被召回的会话）和开头的 Think 步骤也有同样的问题：它们各自已经渲染为一条单独可折叠的行，于是一个轮次在任何可见回复之前就可能先出现三四条独立的行。折叠不能丢失信息：用户仍需看到按类别统计的计数、实时的进行中信号，并能按原顺序查看原始卡片；用户文本、助手文本、压缩卡、milestone、轮次收尾等锚点必须保持各自的渲染与位置。

## 决策

分组是纯视图层折叠。`packages/client/ui-conversation/src/client/chat/activity-groups.ts` 中的 `groupActivityNodes()` 对根聊天节点列表做一次扫描，把每一段两个及以上连续活动节点折叠为一个 `ActivityGroup`：按原顺序携带原始节点、按类别计数（`context`、`explored`、`edits`、`searches`、`commands`、`web`、`subagents`、`other`），以及由成员状态派生的 running 标志。活动节点包括 tool call、command、已落盘的 `context` 注入（绝不 running——内容已经就绪），以及块内容仅为 tool-call 和／或 reasoning 的 assistant step；带有可见 text 块的 assistant step 是该轮次的回复，会像用户消息一样打断分组。纯 reasoning 的 assistant step（即 Think 摘要）是透明成员：它会加入该段并在展开时按原位置渲染，但不计入任何类别计数，因此穿插的推理内容不会把同一轮次的工作拆成多条摘要行——包括紧跟在上下文注入之后、作为轮次开头的 Think，现在它们会折叠进同一条摘要行。若一段内的所有成员都是透明节点（总计数为零），则按单个节点逐一渲染，而不是显示一个没有标题的分组。其他锚点节点——用户或助手文本、压缩卡、milestone、轮次收尾／重试／max-tokens——都会打断该段并正常渲染；单个活动节点（包括单独的一条上下文注入）也正常渲染。凡无法精确还原的内容都不会被折叠。

`ChatView.tsx` 将分组渲染为 `ActivitySummaryRow.tsx`：一条 Cursor 风格的摘要行，带本地化的分类计数与进行中状态，以及一个 chevron 开关，可展开成员卡片（保持原顺序）并再次折叠。展开状态保存在声明的 chat store 中（按分组 key 记录的 `activityExpanded`，唯一变更入口是 `setActivityExpanded`），通过注册时的 store 工厂按会话创建。该条目标记为 `transient`：在会话内跨重挂载保留，整页重载后重置，绝不持久化或参与重放。

本功能仅在客户端。摘要行是现有聊天节点投影的纯函数：不新增会话事件、不改变 Host 约定或线上字段，重放会从同样的节点计算出同样的分组。文案在 `locales.ts` 中覆盖全部四个已注册 locale（zh、en、pt、es）；分组视图类型声明在 `contract/views.ts`，runtime 的 contract store 与 ui-slots 的 store 携带相应声明。

## 考虑过的替代方案

**在 Host 或会话投影中折叠活动。** 不予采纳，因为折叠是展示而非会话数据：web 层保持纯展示，在视图中折叠使日志、重放、搜索和 token 计量完全不受影响，也不改变任何模型可见事实。

**跨重载持久化展开状态。** 不予采纳，因为展开属于没有持久价值的查看状态；声明式 transient store 在会话内提供跨重挂载保留，而不引入持久化或重放约定。

**只按工具名分组或不显示进行中信号。** 不予采纳，因为分类计数让用户一眼看清“Agent 做了什么”，而隐藏进行中调用的摘要会歪曲正在进行的轮次。

**把单个活动节点也折叠。** 不予采纳，因为给一张卡套开关只增加一次点击而不节省空间；单个节点正常渲染。

## 后果

长活动段每段渲染为一条摘要行，锚点与单个节点保持原有位置和渲染器。展开状态按会话且刻意短暂，重载页面总是从折叠开始。由于分组在渲染时派生，聊天节点投影或类别分类的变化会直接改变摘要而不触碰存储数据；每个 locale 都必须带齐摘要文案，类型化 locale 注册表才会接受构建。

## 验证

没有子系统参考页拥有聊天活动表面，因此本笔记即决策记录；聊天 UI 表面未在 `docs/subsystems` 中记录。`packages/client/ui-conversation` 下的针对性组件与单元覆盖验证 `groupActivityNodes` 的段检测与锚点打断、单节点直通、分类计数、running 标志、chevron 展开／折叠顺序、跨重挂载的每会话 transient 展开状态、zh/en/pt/es 摘要文案、推理透明性的回归验证（一个 Think 步骤不再把一段拆成两条摘要行、透明步骤在展开顺序中保留但不计入任何类别、全部为透明步骤的一段会回退为逐个渲染、混合了 reasoning 与内联 tool-call 块的步骤计入 `other`），以及轮次开头的回归验证：连续的上下文注入折叠为一条计入 `context` 的行、一段上下文会吸收其后紧随的 Think 而不计入它、单独一条上下文注入仍单独渲染。
