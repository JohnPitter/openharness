# Agent Note: One WebSocket-cached owner per pi-ai route

Status: implemented

English | [中文](2026-08-26-pi-ai-websocket-session-transport.zh.md)

## Problem

Workflow mode with the same OpenAI Codex model on the planner and worker chips failed mid-stream with `WebSocket error`, surfaced as `PI_AI_ERROR` before classification was widened. The planner session keeps a pi-ai `websocket-cached` connection open keyed by `sessionId`. A spawned worker is a new session with its own `sessionId` on the same `openai-codex` route, so pi-ai opened a second cached WebSocket on the same ChatGPT Codex account and the provider returned a transport failure.

HTTP-only pi-ai routes (Claude Code, GLM, OpenCode) do not share this failure mode: they stream over SSE and tolerate concurrent sessions on one credential.

## Decision

- `PiAiAdapter` tracks the first `sessionId` per provider route whose profile uses `websocket`, `websocket-cached`, or `auto` (unset Codex catalog transport counts as `auto`). That session keeps the profile transport; any other `sessionId` on the same route receives `transport: 'sse'` for that `streamSimple` call.
- The owner map clears when the resolved profile snapshot changes so a configuration reload does not pin a stale session to a rebuilt route.
- `classifyPiAiError` maps Codex WebSocket wordings (`WebSocket error`, `WebSocket closed 1006`, `websocket_connection_limit_reached`) to `TRANSPORT` so `llm-retry` can retry transient drops; SSE fallback is what prevents the second socket from opening in the common Workflow case.

## Alternatives considered

**Serialize all `stream()` calls on a route.** Rejected: parent and child streams are already sequential; the planner socket stays open after its stream completes, so a mutex does not remove the collision.

**Force SSE on every Codex route in `cordis.patch.yml`.** Rejected: it removes `websocket-cached` continuation for the planner and every compaction or title call on that session.

**Fork workers so they inherit the parent `sessionId`.** Rejected: spawn is the shipped Workflow delegation path; fork would duplicate parent transcript into every worker and conflicts with the fork-one-shot composition policy.

## Consequences

- Workflow planner plus Codex worker on the same account completes without opening colliding cached WebSockets; the worker uses SSE while the planner keeps cached continuation.
- Any future pi-ai route configured with websocket-eligible transport gets the same policy without a route-name allowlist.
- Secondary sessions on those routes pay SSE latency and do not reuse the cached `previous_response_id` path for that connection.
