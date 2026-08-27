# Agent Note: Workflow 规划者省略无法使用的构建上下文

Status: implemented

[English](2026-08-27-workflow-planner-omits-unusable-context.md) | 中文

## 问题

Workflow 根会话不能 grep、read 或 edit，但规划者的每一次请求仍在为只有这些工具才能使用的构建上下文付费。J-space 协议要求先 `skill` 再 Read；`skill` 和 `ralph` 仍留在目录里（`ralph` 最多 64 轮全新 child）；`subagent_fork` 会把协调者 transcript 播种给编码工人。被拒绝的工具已经去掉 schema，但 `tool:read` / `edit` / `grep` 及同类段落仍在告诉规划者去用它们。

这段前缀在按 token 计费的路由上直接计费，在按 request 计费的路由上仍占用窗口；一次 `skill` 或 Ralph 调用在两种计量下都是额外 request。[编排者/工人拆分](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md) 负责思考/执行目录，并不拥有这些残留的构建上下文。编码规范摘录仍需要规划者的 `agent-instructions` 基线，因此这里不能靠拿掉 64k mount 来省。

## 决策

`restrictWorkflowOrchestrator` 还在 depth-0 的 Workflow agent 上拒绝 `skill`、`ralph` 和 `subagent_fork`。同进程工人作为兄弟加入 standing mount，仍保留 `skill`（以及 fork）。Workflow preset 文件把 `tool-ralph` 设为 `disabled: true`，规划者和工人都不加载 Ralph 循环。编排者人设禁止加载 j-space 或任何其他 skill，并要求规划者在 `subagent` 任务里点名构建 pass。

当组装中的 agent 是 preset `workflow` 且委派深度为 0 时，Host 的 `jspace:protocol` 段为空。深度 ≥ 1 的工人在开关为 On 时仍收到协议。不带 agent 的裸 `assemble()` 仍注入该段。两个 Workflow picker（已设置 `role`）都隐藏 J-space 行。`JSPACE_DEFAULT_ENABLED` 以及 Off 时的 `hideFromModel('j-space')` 不变；全局隐藏会把 skill 从工人眼前拿掉。

`read`、`edit`、`write`、`grep`、`glob`、`bash`、`pwsh`、`jobs`、`web_search`、`web_fetch` 和 `ralph` 的工具指导段在 `ctx.tools.get(name, context.scope)` 为 undefined 时渲染空文本，与 `tool:subagent` 一致。Standard 和 Workflow 工人不受影响，因为这些工具仍然可见。

`workflow`、`todo`、goal 工具、`list_agents`、`send_message`、`interrupt_agent`、规划者的 `agent-instructions`、工人的 `maxBytes` 以及自动压缩均不变。

## 曾考虑的替代方案

**在 Workflow 规划者上跳过 `agent-instructions`。** 否决：工人摘录引自规划者所见；工人侧的整份指令会被当成背景。

**Workflow 工人也清空 J-space。** 否决：工人是实现 agent，可以 Read skill 模块。

**对 Workflow 会话调用 `hideFromModel('j-space')`。** 否决：hide 是进程全局的，会把 skill 从工人目录拿掉。

**从 Workflow YAML 里拿掉 `skill` / Ralph。** 对 `skill` 否决：工人通过 `composeFrom` 加入同一 mount。对 Ralph 接受：两种角色都不需要 64 轮循环。

**保留已拒绝工具的 `tool:*` 散文。** 否决：它与目录矛盾，且规划者每次请求都要付费。

## 后果

Workflow 规划者不能加载 skill、启动 Ralph，也不能 fork 自己的协调者 transcript。工人仍可加载 skill，并在 On 时遵守 J-space。Off 仍对宿主上的每个模型隐藏 `j-space`。按 request 计费和按 token 计费的提供方都会丢掉规划者这段浪费的前缀，以及浪费的构建 tool-call。

## 测试

`workflow-orchestrator.spec.ts` 用兄弟 child 钉住拒绝列表。`web-agent-presets.e2e.ts` 钉住编排者人设、省略的 schema、空的 `jspace:protocol` 和空的 `tool:read`。`host.client.spec.ts` 与 `jspace-settings.client.spec.ts` 钉住仅规划者省略。`model-select.client.spec.tsx` 在两个 Workflow picker 上隐藏 J-space 行。
