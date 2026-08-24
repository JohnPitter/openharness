# Agent Note: 选择器目录列举保持有界

Status: implemented

[English](2026-08-24-model-catalog-listing-timeout.md) | 中文

## 问题

`session.models` 通过 `Promise.all` 对每条已公布路由调用 `listModels()` 来组建 composer 选择器。Kimi 适配器在选择器路径上发起 `GET {baseURL}/models` 且没有 abort。Node `fetch` 没有默认超时。一次挂起的探测会让整个目录一直 pending。客户端一元超时是 30 秒；抛出之后 `ModelDirectory.load()` 仍把 `status` 留在 `'loading'`，因为只有 `ok: false` 的结果才会记录 `error`。seat 的 inject 吞掉了这次 throw。菜单停在「正在刷新模型列表…」且分组为空，因此没有 Retry 条，也无法选择其他提供方。

设置页的发现已经会把失败的探测报告给表单。那条路径不是这条目录 RPC。

## 决策

选择器目录不得等待一次无界探测。

`KimiAdapter.listModels` 在 `CATALOG_LISTING_TIMEOUT_MS`（2.5 秒）处中止实时列举，并把配置目录与上次成功的实时列举合并。挂起、缺少密钥、非 OK 响应或无法读取的正文都走该回退。当列举曾经成功时，实时容量仍会充实未编目的 `resolveModel` id。

`buildModelCatalog` 将每次 `listModels` 与 `MODEL_CATALOG_PROVIDER_TIMEOUT_MS`（4 秒）竞速。挂起成为该路由的 `failures` 行；其他分组仍返回。

`ModelDirectory.load` 和 `select` 在 RPC throw 时记录 `status: 'error'`，以便菜单内 Retry 条可以触发。更新的 generation 仍拥有 store。

Models 页的获取按钮仍走 `registerModelDiscovery`，并把探测失败报告给表单。

## 备选方案

**`listModels` 只返回配置目录，实时列举留在设置页按钮。** 不予采用：已配置的密钥是 K3 及端点后续 id 进入选择器、而无需设置往返的方式。abort 在端点作答时保留该合并，在不作答时丢弃它。

**只依赖 30 秒的客户端一元超时。** 不予采用：那次 throw 之后目录停在 `loading`，UI 不重载就无法恢复，其他提供方也卡在同一次 pending 的 `Promise.all` 后面。

**后台刷新实时列举，立即返回配置目录。** 不予采用：第一次 `session.models` 会漏掉实时 id，直到之后某次 reload；而这条路径在静默探测之后不会重发 `llm/adapters-updated`。

## 影响

永不作答的 Kimi 端点不再挡住选择器里的 DeepSeek、Claude Code、Codex 或 GLM。第一次打开可能缺少仅实时存在的 id，直到探测成功后的下一次打开，或直到「获取可用模型」。配额和聊天 `fetch` 路径不变；它们保留各自的空闲 watchdog。

## 测试

`llm-kimi` 的 `adapter.spec.ts` 覆盖实时合并、后续失败后保留上次成功列举，以及 abort signal 回退。`api-proxy-models.spec.ts` 将假计时器推进过每提供方时限，并断言挂起路由成为 failure，而 DeepSeek 仍成组。`browser-plugin.client.spec.ts` 拒绝 `session.models` 并断言目录离开 `loading` 进入 `error`。
