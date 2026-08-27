# Agent Note: 工作流编排者只思考，工人执行

Status: implemented

[English](2026-08-22-workflow-orchestrator-thinks-workers-execute.md) | 中文

## 问题

Workflow 模式会选出规划模型和工人模型，但根会话仍保留完整的编码工具目录，人设还允许编排者“自己做一处小改动”。规划者可以 grep、编辑并跑 shell，工人模型并不独占信息收集与落地实现。

## 决策

workflow 的 standing mount 仍注册与 `standard` 相同的工具，使同进程 child 继承 grep、文件系统和 shell。根 workflow agent 发布后，`restrictWorkflowOrchestrator` 只在该 agent 的 scope 上拒绝这些工作工具，包括 `milestone_write`；工人为何写索引由[会话里程碑 note](../feature/2026-08-23-session-milestones.zh.md)负责。child 作为兄弟加入 standing mount，而不是嵌在父 agent 的 scope 下，因此拒绝不会传到工人。workflow 父会话的同进程 child 会收到 `WORKFLOW_WORKER_PERSONA`，除非 start 请求已经点名了 persona。编排者人设和 `workflow` 工具的 `tool:<toolName>` 提示词段把 `subagent` 定为一两项任务的唯一路径：`workflow` 运行通过 `agent()` 启动工人的 JavaScript 脚本，不是 shell，也不能代替 grep、edit 或 pwsh。Workflow 的 spawn `subagent` 工具设置 `foregroundWait: never`，因此一次委派从不等待工人；该调度策略由[从不等待 note](../feature/2026-08-27-workflow-planner-never-waits-on-workers.zh.md)负责。当委派任务会创建或编辑代码时，编排者人设要求工人提示词里只放编码规范摘录和指令文件路径，而不是整份 `AGENTS.md`；该提示词策略由[编码规范摘录 note](../feature/2026-08-23-workflow-planner-coding-standard-excerpts.zh.md)负责。

## 曾考虑的替代方案

**从 workflow preset 文件里拿掉工作工具。** child 通过 `composeFrom` 加入同一 standing mount，也会失去 grep 和 edit。

**只改人设、保留工具。** 模型仍能调用 grep 和 edit；人设不是强制。

**在编排者人设里把 `subagent` 和 `workflow` 写成可互换。** 规划者会把 `workflow` 当作被拒绝的 shell 的替身，而一段不调用 `agent()` 就 return 的脚本不会启动任何工人。把 `subagent` 定为一两项任务的路径，并写明 `workflow` 不是 shell，比从目录里藏掉该工具更便宜。

**从编排者目录里藏掉 `workflow` 工具。** 大规模扇出仍需要这段脚本；误用是拿它代替 grep、edit 或 pwsh，而不是能力本身。

**把 child scope 挂到编排者 agent 下，再在 child 上 allow-list。** 祖先的 restrict 会传到嵌套 scope，父级 deny 会把工具从工人眼前藏掉，除非 child 重新注册。兄弟加入加上只限制父级，符合现有的 createScope 拓扑。

## 后果

workflow 根会话即使忽略人设也不能调用 grep、edit 或 shell。工人仍可以。start 请求自带的 persona 会替换工人默认人设。进程外的产品 provider 不变。规划者仍能看见 `workflow` 工具；靠指导而不是目录限制，把一两项任务导向 `subagent`。一次 Workflow `subagent` 调用立即返回；规划者可以继续接收用户指令并再拉起工人。创建代码的工人只会收到规划者放进任务里的摘录，再加上 standing mount 已经贡献的 `agent-instructions`。省略 `skill`、Ralph、fork、规划者 J-space 协议以及已拒绝工具指导的前缀削减由[无法使用的构建上下文 note](../simplification/2026-08-27-workflow-planner-omits-unusable-context.zh.md)负责。
