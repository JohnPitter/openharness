# @deepseek-ai/dsh-llm-kimi

Kimi for Code chat-completions adapter for the harness LLM seam: direct `fetch` + SSE (framed by `eventsource-parser`) translating Moonshot AI's coding-subscription wire format (OpenAI chat-completions compatible) into the `StreamChunk` protocol. The adapter appends `/chat/completions` to the configured base URL.

The package root exposes the Cordis plugin contract and `KimiAdapter`; wire serialization, SSE parsing, and chunk translation helpers are not part of that root contract.

## Config

```yaml
- id: llm-kimi
  name: '@deepseek-ai/dsh-llm-kimi'
  config:
    apiKeyEnv: KIMI_API_KEY    # default; resolved per request via ctx.credentials, then the environment
    baseURL: https://api.kimi.com/coding/v1 # optional; $KIMI_BASE_URL then the public API when omitted
    thinking: enabled          # optional; provider default is enabled
    reasoningEffort: high      # optional; off | low | high | max — omitted ⇒ high
    maxTokens: 32768           # optional positive per-request output cap; this is the default
    defaultContextWindow: 262144 # optional positive-integer fallback; this is the default
```

The plugin registers the single provider route `kimi-for-coding` (display name `Kimi for Code`, settings namespace `llm-kimi`, `metering: 'requests'`). The default catalog advertises one model: `kimi-for-coding` (`Kimi for Coding`, 262,144-token context window, 32,768-token output cap). With a configured key, `listModels` probes the endpoint's live `GET {baseURL}/models` listing under a 2.5s abort and merges it over the catalog — live entries win per id (including capacities, which also enrich resolutions of otherwise uncatalogued ids). A hang, a missing key, or any endpoint failure keeps the configured catalog plus the last successful live listing. The Models page **Fetch available models** button uses the same listing through `ctx.llm.registerModelDiscovery('llm-kimi', …)` and reports a failed probe to the form rather than falling back.

## Thinking

Kimi for Code models do not share one thinking wire:

- **K3** (`k3`, `k3-256k`, `kimi-k3*`): always thinks. The serializer emits top-level `reasoning_effort` (`low` / `high` / `max`; coding-API default `high`) and never `thinking`. Session-title requests use `low`.
- **K2.7 Code** (`kimi-for-coding`, `kimi-for-coding-highspeed`): thinking is always on. The serializer emits `thinking: { type: 'enabled' }` (or omits nothing that would disable it). The picker exposes only High.
- **Other K2.x**: `thinking: { type: 'enabled' | 'disabled' }`. Effort `high` maps to enabled, `off` to disabled. `thinking: disabled` is a deployment lock that publishes only `off`.

A request with `GenerateOptions.purpose: 'session-title'` or `'compaction'` disables thinking on K2-toggle models and uses `low` on K3.

## Prompt-cache affinity

When `GenerateOptions.sessionId` is set, the request carries `prompt_cache_key` with that session id (the same convention as kimi-cli), improving Kimi-side cache reuse across turns of one session.

## Cache accounting and request identity

Usage fields are OpenAI-standard: `cacheReadTokens` maps from `prompt_tokens_details.cached_tokens` / `prompt_cache_hit_tokens`, and `prompt_tokens` includes cache hits (subtracted to keep disjoint harness counts). Error responses retain the HTTP status, a valid `Retry-After` delay, and the request id from `x-request-id` or `x-trace-id` when present.

Dynamic configuration (settings + credentials), error codes, and stream idle-timeout behavior match the DeepSeek adapter this package is forked from; see `packages/llm/llm-deepseek/README.md` for the shared mechanics.

## Known Limitations and Deferred Work

- **A settings `models` list replaces the composition list wholesale** — settings-layer merging is per-field, and arrays are one field.
- **`tool_choice` is not mapped** — not part of the core vocabulary.
- **Requests use raw `fetch`, not `@cordisjs/plugin-http`** — no shared proxy/interception configuration.
- **Serialization flattens user and tool-result content to text blocks** — plugin-added block types are skipped, and empty tool output crosses the wire as the literal `(no output)`.
