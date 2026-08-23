# @deepseek-ai/dsh-tool-milestone

English | [中文](README.zh.md)

The model-facing `milestone_write` tool: an append-only session index of findings, decisions, and fixes.

## What it does

Registers one tool, `milestone_write({ title, body, anchorSeq? })`, on `ctx.tools`. Each call appends a `milestone/write` event to the calling agent's session log. Replay is append-only: later writes never replace earlier ones. A non-agent caller has no owning session and is rejected.

When the calling session has a live parent (`header.parentSession`), the same identity is mirrored onto that parent with `origin: 'worker'` and `childSessionId`. A missing parent does not fail the child write.

The model-visible index is the titles-only runtime-context snapshot `milestone:index` (`ctx.systemPrompt.context`). An empty session contributes `''`; the channel rewrites only when the folded titles change. The list is not a growing system-prompt section.

## Validation

`execute` trims `title` and `body`, rejects empty text, and caps title at 160 characters and body at 4000. `anchorSeq`, when present, must be a non-negative integer.

## Rendering

Success returns `{ milestoneId, title }`; the Native renderer is `Wrote milestone: <title>`. UIs subscribe to `milestone/write` and render the chip, rail, and jump themselves.

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`milestone_write` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-milestone).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

Each assistant tool call retains `title`, `body`, and optional `anchorSeq`. Success returns exactly `Wrote milestone: <title>`. Stable failures are ``Error: invalid milestone: `title` must be a non-empty string``, ``Error: invalid milestone: `body` must be a non-empty string``, ``Error: invalid milestone: `title` must be at most 160 characters``, ``Error: invalid milestone: `body` must be at most 4000 characters``, ``Error: invalid milestone: `anchorSeq` must be a non-negative integer``, and `Error: milestone_write requires an owning agent session`. The `milestone/write` session event is UI and replay state, not a second model message. Titles also appear in the `milestone:index` runtime-context snapshot.

#### Token effect

Call arguments scale with the recorded body. The result is small and fixed-shape. The runtime-context index grows with title count, not bodies.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries. The runtime-context snapshot rewrites only when the folded title list changes.

### Runtime context

#### What the model sees

When at least one milestone exists:

```markdown
Milestones recorded in this session:
- <title>
```

Otherwise the contribution is empty and omitted.

#### Token effect

One line per recorded title after the fixed header.

#### KV Cache effect

The snapshot sits after retained history. Changing the title list rewrites only that snapshot, not the system-prompt prefix.

## Known Limitations and Deferred Work

- **No edit or delete** — records are append-only; a correction is a later milestone.
- **Parent mirror requires a live parent** — an offline parent leaves the child write intact and the root rail unchanged until that parent is live again.
- **Quota policy is out of scope** — request-versus-token auxiliary calls are a separate decision.
