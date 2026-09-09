# Agent Note: Model catalog search and listing discovery

Status: implemented

English | [中文](2026-09-08-model-catalog-search-and-discovery.zh.md)

## Problem

Custom-provider discovery on this fork still expected an OpenAI `data` array, sent Bearer plus attribution headers, and omitted the named route's profile `headers`. A gateway that authenticates with extra headers, speaks Anthropic Messages, or returns an enriched `models` object therefore looked empty or unauthorized. Adopted rows also dropped a missing display name and unused capacity fields, so the composer picker could not show live capabilities the endpoint had already disclosed.

The Settings fetch dialog and the composer two-level Model/Effort menu listed every advertised id with no filter. OpenCode Free/Zen/Go grouping and the Workflow orchestrator/worker pickers already exist on this fork; a catalog search must sit on those surfaces rather than replace them.

## Decision

Hand-port of the listing and search work from upstream `dsh-v0.1.2-alpha.4` / `dsh-v0.1.3-alpha.1` (present on `dsh-v0.1.5-alpha.1`) onto this tree. Namespace-keyed interrogation, catalog-route short-circuit, and `settings.yaml` ownership stay with [draft-provider endpoint interrogation](../architecture/2026-08-04-draft-provider-endpoint-interrogation.md).

`packages/llm/llm-pi-ai/src/discovery.ts` now interrogates `anthropic-messages` at native `GET /v1/models?limit=1000` (`x-api-key`, `anthropic-version`) in addition to the two OpenAI protocols. The listing parser prefers a `data` array, else an object-valued `models` map whose property key is the request id. It backfills `name` from the adopted id and reads context-window and max-output fields from the common gateway spellings (`contextWindow` / `context_window` / `context_length` / `max_input_tokens` / `limit.context`, and `maxOutputTokens` / `max_output_tokens` / `maxTokens` / `max_tokens` / `limit.output` / `top_provider.max_completion_tokens`). A named configured route supplies profile `headers` plus the stored credential inside the Host; a typed key still wins. Catalog aliases keep using `catalogIdOf` (`claude-code` → `anthropic`) so a shipped coding-plan route still answers from the installed registry with no network call.

Settings `ModelListEditor` adds a search field over the fetch picker (id and optional display name). **Select all** applies to the visible set; **Deselect all** clears the whole selection so a hidden tick cannot be adopted. OpenCode `group` headings are unchanged. The composer `ModelSelect` model pane gets a search input that filters provider groups by id, name, or description; the two-level menu, Workflow dual picker, and `ModelDirectory.resetConnected` last-good snapshot are untouched. `llm-kimi` keeps its own `GET /models` with the 2.5s abort and catalog fallback.

Locales are zh/en/pt/es on both UI packages.

## Alternatives considered

**Merge the 0.1.5-alpha.1 tag.** Rejected: the fork still uses ApiProxy, extra providers, OpenCode grouping, and the Workflow dual picker. The tag also rewrites discovery's second argument and drops `catalogIdOf`.

**Cherry-pick the upstream commits.** Rejected: locales, `ModelSelect` Workflow seats, and `ModelListEditor` grouping conflict in the same files.

**Redesign the composer dropdown around a single searchable list.** Rejected: Figma 496:26454's two-level Model/Effort menu and the Workflow dual picker must keep working. Search is a filter on the existing model pane.

**Share listing helpers with Kimi.** Rejected: Kimi's live merge, 2.5s abort, and silent catalog fallback are adapter-specific. Sharing the parser would risk applying pi-ai's fail-loud listing rules to that path.

## Consequences

A custom OpenAI-compatible or Anthropic Messages gateway can be asked what it serves, including deployment headers from `settings.yaml`, and adopted rows carry the name and capacities the listing disclosed. Catalog routes, including Claude Code's inherited Anthropic vendor, still answer from the installed registry. The Settings picker and composer model pane can be filtered without flattening OpenCode groups or collapsing the Workflow dual picker. Azure, Codex Responses, and Google remain `DISCOVERY_UNSUPPORTED`. Kimi and Cursor discovery stay on their own adapters.

## Testing

`packages/llm/llm-pi-ai/tests/discovery.spec.ts` covers the `models` map, Anthropic listing URL/headers, capacity aliases, profile headers, name backfill, and recorded OpenRouter / models.dev / DeepSeek / Anthropic-reference fixtures, and still covers the `claude-code` catalog alias. `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` filters the fetch dialog and keeps Free/Zen grouping. `packages/client/ui-model-selection/tests/model-select.client.spec.tsx` filters the model pane and keeps both Workflow pickers.
