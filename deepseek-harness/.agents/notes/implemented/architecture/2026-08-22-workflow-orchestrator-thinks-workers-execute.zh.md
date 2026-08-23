# Agent Note: 工作流编排者只思考，工人执行

Status: implemented

[English](2026-08-22-workflow-orchestrator-thinks-workers-execute.md) | 中文

## 问题

Workflow 模式会选出规划模型和工人模型，但根会话仍保留完整的编码工具目录，人设还允许编排者“自己做一处小改动”。规划者可以 grep、编辑并跑 shell，工人模型并不独占信息收集与落地实现。

## 决策

workflow 的 standing mount 仍注册与 `standard` 相同的工具，使同进程 child 继承 grep、文件系统和 shell。根 workflow agent 发布后，`restrictWorkflowOrchestrator` 只在该 agent 的 scope 上拒绝这些工作工具。child 作为兄弟加入 standing mount，而不是嵌在父 agent 的 scope 下，因此拒绝不会传到工人。workflow 父会话的同进程 child 会收到 `WORKFLOW_WORKER_PERSONA`，除非 start 请求已经点名了 persona。编排者人设写明这些工作工具不可用，每次探查或修改都必须委派。

## 曾考虑的替代方案

**从 workflow preset 文件里拿掉工作工具。** child 通过 `composeFrom` 加入同一 standing mount，也会失去 grep 和 edit。

**只改人设、保留工具。** 模型仍能调用 grep 和 edit；人设不是强制。

**把 child scope 挂到编排者 agent 下，再在 child 上 allow-list。** 祖先的 restrict 会传到嵌套 scope，父级 deny 会把工具从工人眼前藏掉，除非 child 重新注册。兄弟加入加上只限制父级，符合现有的 createScope 拓扑。

## 后果

workflow 根会话即使忽略人设也不能调用 grep、edit 或 shell。工人仍可以。start 请求自带的 persona 会替换工人默认人设。进程外的产品 provider 不变。
