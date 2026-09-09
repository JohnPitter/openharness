# Agent Note: Stream identity, hidden Windows subprocesses, and fail-closed root markers

Status: implemented

English | [中文](2026-09-08-stream-id-windows-hide-root-marker.zh.md)

## Problem

Three independent defects from official `dsh-v0.1.5-alpha.1` also exist on this fork.

A continuation SSE delta that repeats a tool call's `id` or `name` as `''` or `null` overwrites the identity established by the first delta, because `!== undefined` treats both as present. The assembled block then fails as `unknown tool ""`, and an empty `callId` persists into `tool/result`. The same translator lives in `llm-deepseek` and the fork-only `llm-kimi` clone.

Windows creates a visible console window for a non-terminal child when the GUI host has none, so a background command or a `taskkill` helper can flash and steal focus.

Project-root discovery treated every marker resolve or stat failure as absence and continued upward, so an `EACCES` or provider I/O error could load an ancestor `AGENTS.md` and report success.

## Decision

`acceptIdentity` in both DeepSeek and Kimi translators assigns `id` and `name` only from a non-empty string. An empty string, `null`, or any other incoming value leaves the established identity unchanged. A tool call that never receives an identity still closes with the empty-string fallback; this port does not add `MALFORMED_TOOL_CALL`.

The local subprocess provider sets `windowsHide: true` on every non-terminal `spawn` on the Windows path and on both synchronous `taskkill` call sites (`spawn.ts` and `windows-inspector.ts`). Terminal processes keep PTY-owned visibility.

Root-marker discovery continues upward only when host `stat` reports `ENOENT` or `ENOTDIR`, or when a filesystem provider returns no stat information or reports `FS_NOT_FOUND`. Every other marker error is rethrown after the cancellation check. Instruction-file candidates keep their skip-on-unavailable policy, which does not change project identity. The [workspace-context note](../feature/2026-06-24-workspace-context.md) still owns baseline injection and the default `.git` walk; this note owns the fail-closed probe.

## Alternatives considered

**Treat empty `id`/`name` as an assignment because the field is present.** Rejected: continuation deltas observed from OpenAI-compatible gateways re-send those fields empty or null, and that assignment is the reported erasure.

**Refuse a stream whose tool call never receives an identity (`MALFORMED_TOOL_CALL`).** Rejected for this port: upstream later narrowed the same fix to identity acceptance after the refusal overrode a provider `max-tokens` finish into retries. The fork still uses ApiProxy and does not ship that failure code.

**Hide only the main child, or expose a caller option for `windowsHide`.** Rejected: `taskkill` helpers still flash, and consumers cannot know whether the local host has a console.

**Treat every marker failure as absence and continue upward.** Rejected because an inaccessible child directory would inherit unrelated ancestor instructions while discovery reports success.

**Stop at the first unavailable marker and use the session working directory as the root.** Rejected because it converts an unknown project root into a different project identity.

## Consequences

Streamed tool calls keep the first non-empty identity across empty continuation deltas on both DeepSeek and Kimi. Background Windows subprocesses and `taskkill` helpers do not create visible windows. Project-root discovery favors correct project identity over availability: one non-missing metadata failure anywhere in the ancestor walk rejects baseline loading with the original error, and no workspace-context Session event is written for that failure.

## Testing

Focused unit tests in `llm-deepseek` and `llm-kimi` cover empty, null, repeated, and parallel continuation identities. `subprocess-local` injects the process launchers and pins `windowsHide` for the main child and both `taskkill` paths. Agent-instruction tests cover confirmed provider absence and unavailable host and provider marker metadata, and prove ancestor instructions do not enter derived model history.
