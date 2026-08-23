# @deepseek-ai/dsh-web-search-duckduckgo

[English](README.md) | 中文

由 [DuckDuckGo](https://duckduckgo.com) HTML 端点支持的免密钥 `WebSearchProvider`，用于 harness [web 能力 seam](../web/README.zh.md)（`ctx.web`）。它向 DuckDuckGo 的无 JS HTML 端点 POST `q=`，并把 `result__a`／`result__snippet` 行映射为 seam 规范化的 `WebSearchResult`。不使用 API 密钥，也不发起辅助模型调用。

这是一个**实现**包：它向 `ctx.web` 注册提供方，不拥有 `ctx.web` 键，也不注册面向模型的工具（后者属于 `@deepseek-ai/dsh-tool-web`）。与 `@deepseek-ai/dsh-web-search-exa` 一样，它是函数／命名空间插件（`inject: ['web']`），负责注册后端，而非默认导出服务。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `baseURL` | `https://html.duckduckgo.com/html/` | HTML 搜索端点；提供方向此地址 POST `q=`。回退到 `$DUCKDUCKGO_SEARCH_BASE_URL`。无法解析时提供方不可用。 |

```yaml
- id: web-search-duckduckgo
  name: '@deepseek-ai/dsh-web-search-duckduckgo'
```

## 映射

DuckDuckGo 返回 HTML 结果行，不返回生成答案，因此省略 `content`。每个 `result__a` 映射为 `WebSearchSource`：`url` ← href（解开 `uddg=` 重定向包装）、`title` ← 锚点文本、`snippet` ← 随后的 `result__snippet`（若存在）。广告块（`result--ad`）、没有 `uddg` 的 DuckDuckGo 托管 href，以及重复 URL 会被丢弃。缺失 snippet 时省略该字段。`maxResults` 由 seam 强制执行。提供方失败（HTTP 错误、网络失败、响应体读取失败）以 `WebError` `WEB_PROVIDER_ERROR` 呈现；中止请求以 `WEB_ABORTED` 呈现。HTTP 重定向会在访问 `Location` 指向的目标之前被拒绝，并以 `WEB_PROVIDER_ERROR` 呈现。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.zh.md) 间接影响；该工具保留此提供方经 `maxResults` 限制的 URL、标题与 snippet，或将确切的错误消息 `DuckDuckGo search aborted`、`DuckDuckGo search request failed: <error>`、`DuckDuckGo search error (HTTP <status>)` 和 `DuckDuckGo returned an unprocessable response body: <error>` 置于消费方的错误包装层内；生成答案不进入上下文。

#### KV Cache 影响

不会直接导致 KV Cache 失效；请求前缀变更由上述消费方负责。

## 已知限制与暂缓事项

- **HTML 标记是提供方私有的解析约定** — DuckDuckGo 可能更改 class 名或包装更多链接；缺失的结果行会变成空的来源列表，而不是硬失败。
- **按错误形状分类中止** — 只有 `DOMException` 且名为 `AbortError` 时才映射为 `WEB_ABORTED`；携带自定义原因的中止（例如 `dsh-timeout` 的 `TimeoutReason`）会呈现为 `WEB_PROVIDER_ERROR`。
