# Agent Note: Cursor native default and Settings Sign in

Status: implemented

English | [中文](2026-08-26-llm-cursor-settings-native.zh.md)

## Problem

`llm-cursor` was composed into the default bundle but could not ship in the OpenHarness desktop: the host TypeScript program did not list the package, Settings treated `llm-cursor` as an unknown layout (Apply disabled), Sign in only spoke to `/dsh-llm-pi-ai/oauth`, and the plugin defaulted to Cloud Agent SDK — a nested agent, not an LLM in the harness loop.

## Decision

- Host build lists `packages/llm/llm-cursor` in `tsconfig.host.json`. Default `transportMode` is `native` (Connect/protobuf HTTP/2); `sdk` remains an explicit settings override.
- `apiKeyEnv` defaults to `CURSOR_ACCESS_TOKEN`. Both adapters declare `metering: 'requests'`.
- Settings `layoutOf('llm-cursor')` is family `cursor`: OAuth buttons plus a pasteable token, no DeepSeek-shaped model list (the catalog is a name dict, filled by live `listModels`).
- The plugin mounts `GET/POST /dsh-llm-cursor/oauth/{status,login,logout}`. The Models OAuth client merges that prefix with the pi-ai one and routes `provider === 'cursor'` to Cursor.

## Alternatives considered

**Keep SDK as default.** Rejected: OpenHarness talks to the provider in-loop; Cloud Agent is a second agent.

**Reuse the pi-ai OAuth HTTP prefix.** Rejected: that handler is bound to `PiAiAdapter` routes; Cursor tokens and login live in `llm-cursor`.

**Edit the model dict as DeepSeek rows.** Rejected: Cursor `Config.models` is `Record<string, string>`; forcing the array editor would disable Apply.

## Consequences

- Settings → Models shows a Cursor card that can Sign in or store a JWT and then pick models from the live listing.
- A desktop runtime must copy `proto/lite.proto` next to the bundled `lib/` (`import.meta.url` resolves `../proto/lite.proto`).
