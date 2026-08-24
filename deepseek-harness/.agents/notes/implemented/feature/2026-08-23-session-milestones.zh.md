# Agent Note: 会话里程碑

Status: implemented

[English](2026-08-23-session-milestones.md) | 中文

## 问题

transcript（文本记录）是按时间排列的日志，不是索引。长会话、压缩（compaction）或 Workflow 工人回到父会话之后，人无法跳到已决定的事实，模型也无法找回检查点丢掉的标题。把整份 transcript 折进系统提示词会无限增长。辅助 LLM 调用的配额策略是另一项决定；见[路由计费 note](2026-08-23-route-metering.zh.md)。

## 决策

关闭工作的模型通过 `@deepseek-ai/dsh-tool-milestone` 的 `milestone_write({ title, body, anchorSeq? })` 写入事实。每次调用追加一条 `milestone/write` 事件（带品牌的 `MilestoneId`，只追加）。委派 child 的活动父会话收到带 `origin: 'worker'` 和 `childSessionId` 的镜像；缺少父会话不会让 child 写入失败。

Workflow 通过 `WORKFLOW_ORCHESTRATOR_WORK_TOOLS` 对编排者隐藏 `milestone_write`，并要求工人在关闭工作的同一工具步骤里写入。Standard 和 Code 会话使用该会话模型。[编排者工具 note](../../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md) 仍拥有隐藏工作工具的决策；本 note 拥有为何由工人写索引。

模型可见的索引是只含标题的运行时上下文快照 `milestone:index`（`ctx.systemPrompt.context`，order 125）。折叠标题变化时该通道才改写。compaction-basic 把这些标题追加到 Critical Context 下，使检查点保留索引。

会话 UI 把 `milestone/write` 折成 `milestone` Chat Node（折叠 chip，可展开正文），左侧轨列出里程碑标题和用户消息航点，并通过 `[data-chat-anchor-key]` 跳转。该轨放在铺满流程的 overlay 里并对齐会话滚动口；默认只显示圆点，悬停、键盘焦点或点击后才露出标题。

## 曾考虑的替代方案

**把 transcript 当作索引。** 搜索和滚动撑不过压缩，从未见过工人工具调用的父会话也没有可跳转的 chip。

**用标题和正文做增长的系统提示词段。** 正文很长；运行时上下文快照已在折叠变化时更新，标题才是查找键。

**让编排者写里程碑。** 规划器并未执行工作；工人返回前写下的标题是猜测。隐藏该工具与现有工作工具限制一致。

**后续写入替换先前里程碑。** 更正会改写轨和压缩指令已经引用的历史。只追加让回放和跳转目标保持稳定。

**不在压缩指令里播种标题，指望摘要器从 transcript 抄过来。** 压力检查点可能丢掉只存在于被遮蔽范围里的那份标题。

## 后果

挂载 `tool-milestone` 的会话都会暴露 `milestone_write`，Workflow 根会话除外。父日志携带工人来源镜像，因此人和索引在人类会话上可见。压缩仍会摘要；指令要求不要丢掉已记录标题。没有编辑或删除。按请求计费路由上的辅助 LLM 跳过不是本包的策略。

## 测试

包测试覆盖 execute、父镜像、运行时上下文快照、Workflow 隐藏／人设、压缩指令播种、Chat Node 折叠、轨跳转，以及 zh/en/pt/es 文案。`milestone/write` 之后由 `pnpm run gen-persistence-catalog` 和 `pnpm run gen-tool-catalog` 刷新生成的事件与工具词汇表。
