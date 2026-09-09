# Agent Note: OpenHarness ships typescript-language-server on the sidecar PATH

Status: implemented

English | [中文](2026-09-09-openharness-ships-typescript-language-server.zh.md)

## Problem

OpenHarness cannot open or resume a Standard session (and Code, Workflow, and Cordis fail the same way) when `typescript-language-server` is not on the process PATH.
`lsp-stdio` calls `ctx.subprocess.resolveExecutable` for every configured server at plugin load and throws if the command is missing, so the `cordis:group` `lsp` row fails and the whole preset fails to mount.
The [LSP-in-shipped-presets decision](../feature/2026-08-30-lsp-in-shipped-presets.md) makes `typescript-language-server` a real `apps/cli` dependency that must live in the packaged runtime's `node_modules/.bin` and resolve on PATH at spawn time.
A Wails GUI process on Windows often inherits a PATH with no npm globals, and `pnpm deploy --prod` of `@deepseek-ai/dsh` can omit that CLI-only package from the staged tree, so the portable exe cannot find the binary it already designed as a shipped dependency.

## Decision

The packaged `dsh-runtime` includes `typescript-language-server`, its `typescript` peer, and the Windows `.cmd` / `.ps1` / POSIX shims under `node_modules/.bin`.
`scripts/stage-typescript-language-server.ps1` copies those packages and shims from `deepseek-harness` `node_modules` (or `apps/cli`) into staging when deploy omitted them.
The sidecar rebuilds the Node environment so `{extracted}/dsh-runtime/node_modules/.bin` is first on `PATH`: it drops existing `PATH` / `Path` entries (not `PATHEXT`) and sets one `PATH=binDir;oldPath`.
`lsp-stdio` still throws when the command is absent; the product obligation is to ship the binary and put it on PATH, not to weaken load-time resolve.

## Alternatives considered

**Skip a missing language-server command inside `lsp-stdio` `apply()` so the preset still mounts.** Rejected: the shipped-presets decision already treats the binary as a packaged dependency, and a silent empty LSP provider would hide a broken runtime zip. Load-time `resolveExecutable` stays fail-loud.

**Ask the user to `npm i -g typescript-language-server`.** Rejected: OpenHarness is a portable exe; a Wails GUI PATH must not require a global npm install.

**Resolve the command from `cwd/node_modules/.bin` without rewriting PATH.** Rejected: `lsp-stdio` already documents PATH lookup through `subprocess-local`, and other shipped tool binaries use the same `.bin` directory. Prepending that directory is the resolution the presets already assume.

## Consequences

Standard, Code, Workflow, and Cordis mount on a desktop PATH that has no npm globals, because the extracted runtime's `.bin` is first and contains the CLI.
The staged zip is larger by the language-server package and the `typescript` peer.
A rebuild that runs `pnpm deploy --prod` without the staging script can drop the CLI again; the script is the copy step that keeps the zip complete.

## Testing

`internal/sidecar/env_test.go` pins PATH prepend, `PATH`/`Path` collapse, and `PATHEXT` preservation.
`go vet ./internal/sidecar` covers the spawn site.
Staging asserts `dsh-runtime/node_modules/.bin/typescript-language-server.CMD` and `lib/cli.mjs` exist before the zip is written.
