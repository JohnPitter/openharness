# Agent Note: 每条 pi-ai 路由仅一个 websocket-cached 所有者

Status: implemented

[English](2026-08-26-pi-ai-websocket-session-transport.md) | 中文

## 问题

Workflow 模式下，规划器与工作者的 Codex 芯片选择同一模型时，流式输出中途以 `WebSocket error` 失败；在分类器扩展之前，该错误呈现为 `PI_AI_ERROR`。规划器会话按 `sessionId` 保持一条 pi-ai `websocket-cached` 连接。spawn 出来的工作者是新会话，在同一 `openai-codex` 路由上拥有不同的 `sessionId`，因此 pi-ai 在同一 ChatGPT Codex 账户上打开了第二条缓存 WebSocket，提供方返回传输失败。

纯 HTTP 的 pi-ai 路由（Claude Code、GLM、OpenCode）没有这种模式：它们通过 SSE 流式传输，同一凭据上的并发会话可以并存。

## 决策

- `PiAiAdapter` 为每条 profile 使用 `websocket`、`websocket-cached` 或 `auto`（未设置的 Codex catalog 传输视为 `auto`）的提供方路由，记录第一个 `sessionId` 为所有者。该会话保持 profile 传输；同一路由上任何其他 `sessionId` 在该次 `streamSimple` 调用中收到 `transport: 'sse'`。
- 当解析后的 profile 快照变化时清空所有者映射，避免配置重载把陈旧会话钉在已重建的路由上。
- `classifyPiAiError` 将 Codex WebSocket 措辞（`WebSocket error`、`WebSocket closed 1006`、`websocket_connection_limit_reached`）映射为 `TRANSPORT`，以便 `llm-retry` 可重试瞬时断开；SSE 回退才是避免 Workflow 常见场景中打开第二条 socket 的机制。

## 考虑过的替代方案

**在同一路由上串行化所有 `stream()` 调用。** 否决：父与子流本就顺序执行；规划器 socket 在其流结束后仍保持打开，互斥锁无法消除碰撞。

**在 `cordis.patch.yml` 中强制 Codex 全程 SSE。** 否决：会剥夺规划器以及该会话上每次压缩或标题调用的 `websocket-cached` 延续。

**让工作者 fork 以继承父级 `sessionId`。** 否决：spawn 是随附 Workflow 委派路径；fork 会把父 transcript 复制进每个工作者，并与 fork-one-shot 组合策略冲突。

## 后果

- Workflow 中 Codex 规划器与同账户 Codex 工作者可完成委派，不再打开冲突的缓存 WebSocket；工作者走 SSE，规划器保留缓存延续。
- 任何未来配置为 websocket 类传输的 pi-ai 路由自动获得相同策略，无需路由名白名单。
- 这些路由上的次要会话承担 SSE 延迟，且不在该连接上复用缓存的 `previous_response_id` 路径。
