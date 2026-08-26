# Agent Note: Cursor Settings catalog is a model-row array

Status: implemented

English | [中文](2026-08-26-llm-cursor-models-array-catalog.zh.md)

## Problem

The Cursor Settings card omitted the model list, and the composer picker omitted the Cursor group after Sign in. `Config.models` was a name dict, so `layoutOf('llm-cursor')` skipped `ModelListEditor` to keep Apply enabled. `listModels` called `GetUsableModels` with the transport's 120s header timeout; the host picker bounds each provider at 4s and drops a timed-out group instead of using the configured catalog.

## Decision

- `Config.models` is an array of `{ id, name?, contextWindow?, maxTokens? }` rows, defaulting to Composer 2.5 at 200k/32k, the same fields Kimi and DeepSeek expose to Settings.
- The Cursor card renders `ModelListEditor`. Inherited schema defaults populate the rows; Fetch calls `discoverModels` on `llm-cursor`.
- Native and SDK `listModels` abort credential resolution and the live listing at 2.5s. An empty, failed, or aborted listing returns the configured array so the picker still publishes a Cursor group.
- `installSettingsSection` `setSource` points the adapters at the live settings snapshot so Apply updates the fallback catalog without a restart.

The Sign-in and native-default decisions stay in [Cursor native default and Settings Sign in](2026-08-26-llm-cursor-settings-native.md).

## Alternatives considered

**Keep the name dict and a read-only live list.** Rejected: Fetch/Apply could not persist rows, and the picker still vanished when the RPC exceeded 4s.

**Leave listing unbounded and rely on the host 4s bound.** Rejected: that bound records a failure and drops the group; the catalog fallback inside `listModels` never ran.

## Consequences

- Settings → Models → Cursor → Customized settings shows Composer 2.5 until the user customizes or fetches.
- A hung `GetUsableModels` or SDK `Cursor.models.list` no longer removes Cursor from the picker.
- A hand-written `models:` map in `settings.yaml` is invalid for this section; the array form is the only accepted catalog.
