# Agent Note: Workflow 规划者发送编码规范摘录，而不是整份文件

Status: implemented

[English](2026-08-23-workflow-planner-coding-standard-excerpts.md) | 中文

## 问题

Workflow 工人是更快、更简短的模型。它们收集信息并落地修改，但会跳过写在 `AGENTS.md`、包内 `AGENTS.md`、`CLAUDE.md` 和所属 README 里的软件工程纪律。把这些文件贴进每一次 `subagent` 提示词会占满工人的 token。编排者已经能看见 `agent-instructions`，且不能自己 grep 或读树。

[编排者/工人分工](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md) 负责工具限制和协调者角色；它不负责规划者必须在代码编辑提示词里放什么。

## 决策

workflow 编排者人设要求：当委派任务会创建或编辑代码时，工人提示词里只放编码规范的短摘录以及应遵循的指令文件路径——绝不以整份文件粘贴。摘录只点名适用于这次改动的规则（命名、测试、分层、错误处理、以及不要发明什么）。路径让工人去读其余部分。`WORKFLOW_WORKER_PERSONA` 告诉子级遵守这些摘录和点名的文件，不要发明冲突的架构，也不要跳过任务点名的测试。

这只是人设指导。standing mount 仍向加入的 child 贡献 `agent-instructions`；任务里的摘录是额外、更能抓住注意力的副本，更快的工人才会跟着做。

## 备选方案

**把整份 `AGENTS.md` / `CLAUDE.md` 贴进每个代码任务提示词。** 不予采用：token 成本在每个工人上重复，并淹没任务本身。

**只靠 `agent-instructions`。** 不予采用：工人模型把那一大块当成背景，会跳过工程门槛。

**把同样的摘录做成 `WORKFLOW_WORKER_PERSONA` 里的固定目录。** 不予采用：相关门槛取决于这次改动；固定目录要么不完整，要么又是整文件倾倒。

**让规划者先委派一个只读指令文件的工人。** 不予采用：规划者已经有 `agent-instructions`，可以引用适用的行，不必多一趟往返。

## 影响

代码任务的工人提示词保持简短：几条引用的规则和文件指针。需要更多时工人可以去读点名的文件。非代码委派不变。编排者仍不能检查树；摘录来自它自己的指令上下文以及先前工人的报告。

## 测试

`workflow-orchestrator.spec.ts` 把 `WORKFLOW_WORKER_PERSONA` 固定为提及 coding-standard excerpts。编排者段落位于 `apps/cli/config/agent-presets/workflow/agent.cordis.yml`。
