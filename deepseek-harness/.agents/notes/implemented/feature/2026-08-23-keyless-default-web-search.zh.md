# Agent Note: 免密钥 DuckDuckGo 默认 web 搜索

Status: implemented

[English](2026-08-23-keyless-default-web-search.md) | 中文

## 问题

已交付的 `web_search` 走 DeepSeek 原生搜索服务器工具。该路径每次调用都需要 `DEEPSEEK_API_KEY` 以及 DeepSeek 的计费 token，即使会话使用 Kimi、Claude Code、Codex 或 GLM 也是如此。DeepSeek 余额缺失或为空时，互联网搜索会失败，而聊天仍可工作。仓库内已有 Exa 与 Perplexity，但它们同样需要付费密钥，因此换成其中任一提供方并不能去掉对额外厂商余额的依赖。

## 决策

`packages/bundle/base/cordis.patch.yml` 挂载 `dsh-web`，配置 `searchProvider: duckduckgo`，并挂载 `@deepseek-ai/dsh-web-search-duckduckgo`。该提供方向 DuckDuckGo 的无 JS HTML 端点（`https://html.duckduckgo.com/html/` 或 `$DUCKDUCKGO_SEARCH_BASE_URL`）POST `q=`，映射 `result__a`／`result__snippet` 行，解开 `uddg=` 包装，丢弃广告，并以 `duckduckgo` 注册。它不需要 API 密钥，也不发起辅助模型请求。`dsh-tool-web` 仍以 `fetch: false` 和 `searchTimeoutMs: 60000` 交付。DeepSeek 搜索行保留在组合中且 `disabled: true`，以便覆盖层无需新增软件包即可重新启用；Web 快照通道会这样做，并将 `searchProvider: deepseek-official` 指向本地 Messages fixture。

不挂载 `web_fetch`、显式提供方选择以及覆盖层替换，仍遵循[默认 web 搜索挂载](2026-07-31-web-default-search.zh.md)。本笔记只拥有已交付默认配置选择哪一个搜索后端。

## 考虑过的替代方案

**将 Exa 或 Perplexity 作为默认提供方。** 不予采纳：二者都需要各自的付费 API 密钥；对只有 coding-plan 密钥的用户，这会重复 DeepSeek 余额不足导致的失败。

**继续挂载并选中 DeepSeek 搜索。** 不予采纳：会话可以在非 DeepSeek 路由上成功，而每次 `web_search` 仍会因缺少 DeepSeek 凭据或余额而失败。

**用启用 `web_fetch` 代替搜索提供方。** 不予采纳：默认抓取会让模型自选任意 URL；HTML 搜索只访问一个固定端点。

**在 `dsh-tool-web` 内抓取 DuckDuckGo。** 不予采纳：提供方选择属于 `ctx.web`；工具包不得导入某个厂商后端。

## 后果

默认 `web_search` 无需存储 DeepSeek、Exa 或 Perplexity 密钥即可工作。结果质量跟随 DuckDuckGo HTML 标记；标记变更可能返回更少来源而不使调用失败。DeepSeek 原生搜索仍作为已禁用的组合行可用。Web search-round 快照仍通过覆盖层驱动真实 DeepSeek 提供方，而不是已交付的默认 id。
