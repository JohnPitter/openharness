# Agent Note: Workflow 规划者从不在工人上等待

Status: implemented

[English](2026-08-27-workflow-planner-never-waits-on-workers.md) | 中文

## 问题

Workflow 规划者若在前台等待一次 `subagent` 调用，其轮次会一直跑到该工人结束。此后 composer 会把用户的后续指令排队或插入当前轮次，而不是开启规划者的新轮次；规划者也无法在第一个 child 返回之前，为其余独立任务启动工人。

`backgroundMode: continuable` 已把省略的 `run_in_background` 默认到后台，但显式传入 `false` 仍会等待。规划模型把“下一步动作依赖该结果”当成常态，因此每次委派都在等待。

[编排者/工人拆分](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.zh.md) 负责思考/执行目录。[可继续委派的后台优先默认值](2026-08-11-background-first-continuable-delegation.zh.md) 负责仍允许前台覆盖的实例如何解析省略参数。两者都不禁止该覆盖。

## 决策

`dsh-tool-subagent` 接受 `foregroundWait: 'allowed' | 'never'`（默认 `allowed`）。`never` 从 schema 中省略 `run_in_background`，并始终走后台路由，即使模型仍传入 `false`。schema 与执行保持一致：不等待既不出现在参数里，也不会被执行。`never` 加上 `enableRunInBackground: false` 会在 apply 时失败。

Workflow preset 的 spawn `subagent` 行把 `foregroundWait: never` 与 `backgroundMode: continuable` 一起设置。编排者人设写明每次调用立即返回、独立任务在同一条消息里一起启动、规划者保持准备接收后续用户指令，并且剩余工作继续拉起工人。工人结果仍以[由服务投递的结算通知](2026-08-06-manager-owned-subagent-settlement-delivery.zh.md)到达。

其他 preset 保持 `foregroundWait: allowed`。Workflow standing mount 上的 fork、Codex 和 Claude Code 工具行不变：规划者看不见 fork，产品行保持 `disabled`。

## 曾考虑的替代方案

**只靠人设和现有的 continuable 默认值。** 模型仍能传入 `false`，该调用会把规划者轮次卡住直到工人结束。仅靠提示词偏好，正是这项配置要关掉的缺陷。

**只在 `restrictWorkflowOrchestrator` 里强制后台。** 执行时覆盖、schema 仍提供 `false`，会造成 schema 与能力不一致；本包对 `enableRunInBackground: false` 已经拒绝这种分歧。

**在 Workflow 工具上设置 `enableRunInBackground: false`。** 该选项会省略参数并始终在前台等待，与所需调度相反。

**再加一套省略参数的默认值。** [后台优先](2026-08-11-background-first-continuable-delegation.zh.md) 已经否决了可能与 `backgroundMode` 冲突的第二套默认。`foregroundWait: never` 去掉前台路由，并不另选省略参数的默认值。

**模型仍传入 `false` 时让调用失败。** 未声明字段会立刻报错，但工人不会启动，规划者只能重试。该实例已经省略该参数；未声明的 `false` 不能恢复已去掉的等待路由。

## 后果

Workflow 规划者的一次委派返回 `{ kind: 'continuable', subagentId }` 并释放父级轮次。工人运行期间用户可以继续发指令，规划者也可以在同一轮或后续轮次再启动 child。仍传入 `run_in_background: false` 的模型仍会在后台启动工人；该多余字段既不等待，也不会让调用失败。Standard、Code 和 Cordis preset 在模型要求时仍会等待。包测试钉住 schema 省略、多余 `false` 走后台，以及与禁用后台在 apply 时的冲突；`web-agent-presets.e2e.ts` 钉住 Workflow 人设、`tool:subagent` 指引和被省略的参数。
