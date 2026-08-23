# Agent Note: A live session can switch agent preset

Status: implemented

English | [中文](2026-08-22-live-session-agent-preset-switch.zh.md)

## Problem

Once a session had any `turn/start`, the header showed the mode as static chrome and `agentPreset.select` answered `agent-preset-locked`. Changing PTC, Standard, Workflow, or a custom preset required a new session and dropped the conversation.

## Decision

`agentPreset.select` recomposes a live session. It no-ops when that agent already runs the named preset, answers `agent-preset-locked` while `agent.status === 'running'`, and otherwise `recompose`s then appends `agent-preset/selected`. The session header is a menu over the same roster as the General row. A child session (`origin === 'subagent'`) stays a name because it `composeFrom`s the parent. The new-session chip still stages only a blank session.

Historical tool calls stay in the log; later turns use the new composition. Reconstruction already reads `resolveSessionPreset`, so a resume follows the last switch rather than the creation header.

This reverses the blank-only product rule in [per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md).

## Alternatives considered

**Keep the blank-only lock.** Rejected: the conversation is the thing the operator wants to keep.

**Queue the switch until the in-flight turn ends.** Rejected: that turn started under the previous tools; a silent swap at `turn/end` would change composition under a prompt the operator did not reissue.

**Mint a new session for the new preset.** Rejected: it drops the log the operator is looking at.

## Consequences

Slash catalogs go stale through the existing `agent-preset/selected` forward. Changing the General-row default still does not mutate live sessions. Logged tool cards from the previous preset remain in the transcript.

## Testing

`api-proxy-agent-preset.spec.ts` recomposes after `turn/end` and refuses while `status === 'running'`. `components.client.spec.tsx` drives the header menu, the running disable, the subagent name, and a refused select. The web e2e header snapshot is a button; a follow-up case switches the seeded session from that control.
