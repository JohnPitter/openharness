# Agent Note: 路由计费

Status: implemented

[English](2026-08-23-route-metering.md) | 中文

## 问题

DeepSeek 按 token 加缓存计费；编码计划（Kimi for Code、Claude Code、Codex、GLM、OpenCode）按请求窗口计费。harness 过去会在每条路由上触发标题 LLM 和压力压缩 LLM，Workflow 工人在 chip 为空时继承规划器。两件事都会烧掉请求配额。配额 chip 已经存在；GLM 解析器只接受 `TOKENS_LIMIT` / `CREDIT_LIMIT`，丢掉了请求窗口。会话里程碑是另一套索引；见[会话里程碑 note](2026-08-23-session-milestones.zh.md)。

## 决策

每个适配器在 `LlmProviderInfo` 上声明 `metering?: 'tokens' | 'requests'`。消费方读取 `ctx.llm.providerMetering(provider)`，路由未注册或未声明时默认为 `tokens`。客户端不得从提供方 id 推断该单位。编码计划路由声明 `requests`；按 token 付费的路由省略该字段。

按请求计费的路由不启动自动标题提供方，剪枝之后也不跑压力压缩 LLM。本地剪枝仍会运行。规范溢出和 `/compact` 仍会摘要，否则会话会卡住。按 token 计费的路由保持原先的自动标题和压力压缩行为。

`parseZaiUsage` 把捕获到的 GLM `TIME_LIMIT`（以及同类请求计数类型）映射为 `requests` / `requests-weekly` 窗口。现有配额 chip 和设置 → 用量会渲染这些 id。

当父会话是 Workflow、规划器按请求计费、且未选择工人 chip 也未在请求里点名 child 提供方时，`resolveChildAgentOptions` 抛出 `WorkflowWorkerRequiredError`，而不是继承。显式工人始终胜出。按 token 计费的规划器在 chip 为空时仍继承。composer 升起 `blocked.worker` 直到选出工人；规划器不可路由时仍优先于该阻塞。

## 曾考虑的替代方案

**从提供方名称推断计费。** 自定义 OpenAI 兼容网关可以长得像编码计划，却仍按 token 计费。拥有协议格式的适配器必须声明单位。

**在按请求计费的路由上连溢出和 `/compact` 也跳过。** 无法压缩的会话会卡在上下文窗口之上，没有恢复路径。

**Workflow 工人始终继承规划器。** 这会在用户已经选来思考的同一计划上再占一个请求窗口名额。

**即使用户选了工人，也拦截每一个按请求计费的工人。** chip 是显式选择；继承未设置的 chip 才是事故。

**没有捕获载荷就猜测 GLM 请求窗口的 `type`。** 解析器会发明一个线上 monitor 并不发送的判别值。

## 后果

辅助标题和压力压缩 LLM 不再消耗编码计划配额。溢出和手动压缩仍会花费一次请求，这是有意设计。GLM/Kimi/Claude Code 上的 Workflow 在第一次委派前必须有工人 chip。宿主 `session.models` 携带 `currentMetering`，客户端不必反推单位。

## 测试

适配器测试钉住已声明与省略的 `metering`。按请求计费适配器上的压缩压力会剪枝且不摘要；溢出仍会摘要。挂载按请求计费 `LlmRuntime` 适配器时，会话标题的自动 generate 不会被调用；回退标题仍会落地。`resolveChildAgentOptions` 覆盖抛出／继承／显式工人／请求提供方。GLM fixture 包含捕获的 `TIME_LIMIT`。composer 阻塞和配额标签覆盖 `blocked.worker` 与 `requests` 窗口。
