# Agent Note: LSP composed into the shipped agent presets

Status: implemented

English | [中文](2026-08-30-lsp-in-shipped-presets.zh.md)

## Problem

The [LSP capability seam](../architecture/2026-07-15-lsp-capability-seam.md) shipped three fully tested packages — `dsh-lsp`, `dsh-lsp-stdio`, `dsh-tool-lsp` — but no deployment composed them: not `packages/bundle/base`, not any of the four shipped agent presets (Standard, Code, Workflow, Cordis), not `apps/cli/package.json`. The seam note already named this the intended extension point ("future presets belong in composition plugins or `cordis.yml` overlays"), so the model-facing `lsp` tool never reached a real session despite the capability being product-ready.

## Decision

Compose the seam into every shipped preset that already carries `tool-fs-search` (Standard, Code, Workflow's worker, Cordis): one `cordis:group` row (`id: lsp`) isolating `ctx.lsp` — the only service the three packages publish — with `lsp-service` (`dsh-lsp`), `lsp-stdio` (`dsh-lsp-stdio`) configured with one `typescript` server entry, and `tool-lsp` (`dsh-tool-lsp`) inside it. `lsp-stdio` and `tool-lsp` register no service of their own and need no realm.

`typescript-language-server` and its `typescript` peer become real (not `npx`) dependencies of `apps/cli`, deployed into the packaged runtime's `node_modules/.bin` alongside every other shipped tool binary, rather than fetched over the network on first use — consistent with the product's "everything on your disk" position. `command: typescript-language-server` resolves on the child's PATH at spawn time, the same resolution `lsp-stdio` already documents.

TypeScript/JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`) is the first and only configured language: `typescript-language-server` resolves `typescript` relative to the analyzed workspace, so results depend on that project's own `typescript` install — an inherent property of the server, not something the harness papers over. Extending `servers` in each preset is how a deployment adds another language.

## Alternatives considered

**Spawn the server through `npx --yes`, matching the `examples/headless-agent/e2b.cordis.yml` demo.** Rejected for the shipped product: a packaged desktop app whose whole pitch is local-first, no-cloud-in-the-middle should not depend on an npm registry fetch the first time a session opens a TypeScript file, especially offline or on a restricted network.

**Compose `lsp`/`lsp-stdio`/`tool-lsp` once in `packages/bundle/base` instead of per preset.** Rejected: `ctx.lsp` is a named service exactly like `ctx.compaction`/`ctx.toolResultPruner` (see the [compaction capability-seam note](../feature/2026-06-18-compaction-capability-seam.md)), and the `web-app` bundle already disables the base bundle's session-scoped services in favor of preset-owned, isolated instances (see [host-plane ownership after presets](2026-08-10-host-plane-ownership-after-presets.md)); a base-bundle registration would collide with a per-preset one under the same non-isolated name.

**Support every language server the harness could plausibly reach (Python, Go, Rust, ...) in this change.** Rejected: unproven demand and untested startup/latency per server; TypeScript establishes the composition shape, proven by the package's own pinned e2e test, and `servers` is additive per preset without a source change.

## Consequences

Every session using Standard, Code, the Workflow worker, or the Cordis preset now sees the `lsp` tool and its system-prompt guidance; token cost is the fixed schema/prompt cost the [tool-lsp README](../../../packages/lsp/tool-lsp/README.md) documents, present on every request while the plugin is active. `typescript-language-server`/`typescript` add to the packaged runtime's installed size. A workspace without its own `typescript` install gets structured LSP errors from a query, not silently wrong results.

## Testing

`apps/cli/tests/lsp-composition.spec.ts` boots the exact composition (a `cordis:group`-isolated `lsp`/`lsp-stdio`/`tool-lsp` row set, real `dsh-fs-local`/`dsh-subprocess-local`, the pinned `typescript-language-server` binary) through the real Cordis Loader and asserts the `lsp` tool schema registers — the same rigor `memory-mcp-configs.spec.ts` uses for the MCP example overlays. `verify-cordis-config` covers all four edited preset files and `packages/lsp/lsp-stdio`'s own pinned `typescript-server.e2e.ts` already proves a live query round-trip through the same server binary, so this test does not repeat that.
