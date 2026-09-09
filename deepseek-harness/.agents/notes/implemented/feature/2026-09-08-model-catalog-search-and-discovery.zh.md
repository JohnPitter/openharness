# Agent Note: 模型目录搜索与列表发现

Status: implemented

[English](2026-09-08-model-catalog-search-and-discovery.md) | 中文

## Problem

本 fork 的自定义提供方发现仍要求 OpenAI 的 `data` 数组，只发送 Bearer 与归属标头，且不带具名路由的 profile `headers`。用额外标头认证、讲 Anthropic Messages、或返回充实 `models` 对象的网关，因此看起来像空目录或未授权。采纳的行也会丢掉缺失的显示名称和未用的容量字段，于是 composer 选择器无法展示端点已经公布的实时能力。

设置页的获取对话框与 composer 的两级 Model/Effort 菜单会列出每一个已公布 id，没有过滤。本 fork 已有 OpenCode Free/Zen/Go 分组与 Workflow 规划器／工人双选择器；目录搜索必须落在这些表面上，而不是替换它们。

## Decision

从上游 `dsh-v0.1.2-alpha.4` / `dsh-v0.1.3-alpha.1`（亦见于 `dsh-v0.1.5-alpha.1`）把手写移植列表与搜索工作到本树。按 namespace 键询问、catalog 路由短路、以及 `settings.yaml` 所有权仍属于[草稿提供方端点询问](../architecture/2026-08-04-draft-provider-endpoint-interrogation.zh.md)。

`packages/llm/llm-pi-ai/src/discovery.ts` 现在除两种 OpenAI 协议外，还会以原生 `GET /v1/models?limit=1000`（`x-api-key`、`anthropic-version`）询问 `anthropic-messages`。列表解析器优先 `data` 数组，否则读对象值的 `models` 映射，其属性键即为请求 id。它用已采纳的 id 回填 `name`，并从常见网关拼写读取上下文窗口与最大输出字段（`contextWindow` / `context_window` / `context_length` / `max_input_tokens` / `limit.context`，以及 `maxOutputTokens` / `max_output_tokens` / `maxTokens` / `max_tokens` / `limit.output` / `top_provider.max_completion_tokens`）。已配置的具名路由在 Host 内提供 profile `headers` 与已存凭据；键入的密钥仍优先。catalog 别名继续使用 `catalogIdOf`（`claude-code` → `anthropic`），因此随附的编程计划路由仍由已安装注册表作答、完全不联网。

设置页 `ModelListEditor` 在获取选择框上增加搜索（id 与可选显示名称）。**全选**作用于可见集合；**取消全选**清空整个选择，以免误采纳被筛掉的勾选。OpenCode `group` 标题不变。composer `ModelSelect` 的模型面板增加搜索输入，按 id、名称或说明过滤提供方分组；两级菜单、Workflow 双选择器、以及 `ModelDirectory.resetConnected` 的 last-good 快照均未改动。`llm-kimi` 仍走自己的 `GET /models`，带 2.5s abort 与 catalog 回退。

两个 UI 包的文案均为 zh/en/pt/es。

## Alternatives considered

**合并 0.1.5-alpha.1 标签。** 拒绝：本 fork 仍使用 ApiProxy、额外提供方、OpenCode 分组与 Workflow 双选择器。该标签还改写了 discovery 的第二个参数并去掉了 `catalogIdOf`。

**Cherry-pick 上游提交。** 拒绝：locale、`ModelSelect` 的 Workflow 席位、以及 `ModelListEditor` 分组会在同一批文件里冲突。

**把 composer 下拉改成单一可搜索列表。** 拒绝：Figma 496:26454 的两级 Model/Effort 菜单与 Workflow 双选择器必须继续工作。搜索只是现有模型面板上的过滤器。

**与 Kimi 共用列表辅助函数。** 拒绝：Kimi 的实时合并、2.5s abort 与静默 catalog 回退是适配器特有的。共用解析器会把 pi-ai 的失败即报规则套到那条路径上。

## Consequences

自定义 OpenAI 兼容或 Anthropic Messages 网关可以被询问其服务的模型，包括来自 `settings.yaml` 的部署标头，采纳的行会带上列表公布的名称与容量。catalog 路由——包括 Claude Code 继承的 Anthropic 厂商——仍由已安装注册表作答。设置页选择框与 composer 模型面板可以过滤，而不会压平 OpenCode 分组或折叠 Workflow 双选择器。Azure、Codex Responses 与 Google 仍为 `DISCOVERY_UNSUPPORTED`。Kimi 与 Cursor 的发现仍在各自适配器上。

## Testing

`packages/llm/llm-pi-ai/tests/discovery.spec.ts` 覆盖 `models` 映射、Anthropic 列表 URL／标头、容量别名、profile 标头、名称回填，以及录制的 OpenRouter / models.dev / DeepSeek / Anthropic 参考夹具，并仍覆盖 `claude-code` catalog 别名。`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` 过滤获取对话框并保留 Free/Zen 分组。`packages/client/ui-model-selection/tests/model-select.client.spec.tsx` 过滤模型面板并保留两个 Workflow 选择器。
