# Agent Note: OpenHarness 在 sidecar PATH 上随包提供 typescript-language-server

Status: implemented

[English](2026-09-09-openharness-ships-typescript-language-server.md) | 中文

## 问题

当进程 PATH 上没有 `typescript-language-server` 时，OpenHarness 无法打开或恢复 Standard 会话（Code、Workflow、Cordis 以同样方式失败）。
`lsp-stdio` 在插件加载时对每个已配置 server 调用 `ctx.subprocess.resolveExecutable`，命令缺失即抛错，于是 `cordis:group` 的 `lsp` 行失败，整个预设无法挂载。
[将 LSP 编入已发布预设的决策](../feature/2026-08-30-lsp-in-shipped-presets.zh.md) 把 `typescript-language-server` 做成 `apps/cli` 的真实依赖，它必须位于打包运行时的 `node_modules/.bin`，并在生成子进程时按 PATH 解析。
Windows 上的 Wails GUI 进程常常继承一条不含 npm 全局目录的 PATH，而 `@deepseek-ai/dsh` 的 `pnpm deploy --prod` 也可能把这个仅 CLI 使用的包漏出暂存树，于是便携 exe 找不到它本应随包提供的二进制。

## 决策

打包后的 `dsh-runtime` 包含 `typescript-language-server`、其对等依赖 `typescript`，以及 `node_modules/.bin` 下的 Windows `.cmd` / `.ps1` / POSIX shim。
`scripts/stage-typescript-language-server.ps1` 在 deploy 漏掉它们时，从 `deepseek-harness` 的 `node_modules`（或 `apps/cli`）拷入暂存树。
sidecar 重建 Node 环境，使 `{extracted}/dsh-runtime/node_modules/.bin` 位于 `PATH` 最前：丢掉已有的 `PATH` / `Path` 项（保留 `PATHEXT`），再写入一条 `PATH=binDir;oldPath`。
命令缺失时 `lsp-stdio` 仍然抛错；产品义务是随包提供该二进制并把它放到 PATH 上，而不是放宽加载期解析。

## 备选方案

**在 `lsp-stdio` 的 `apply()` 里跳过缺失的 language-server 命令，让预设仍能挂载。** 否决：已发布预设的决策已把该二进制当作打包依赖；静默变成空的 LSP 提供者会掩盖损坏的 runtime zip。加载期 `resolveExecutable` 保持失败即响。

**要求用户执行 `npm i -g typescript-language-server`。** 否决：OpenHarness 是便携 exe；Wails GUI 的 PATH 不得依赖全局 npm 安装。

**不改写 PATH，只从 `cwd/node_modules/.bin` 解析命令。** 否决：`lsp-stdio` 已通过 `subprocess-local` 文档约定走 PATH 查找，其他随包工具二进制也使用同一 `.bin` 目录。把该目录前置，正是各预设已经假定的解析方式。

## 后果

即使桌面 PATH 没有 npm 全局目录，Standard、Code、Workflow、Cordis 也能挂载，因为解压后的运行时 `.bin` 位于最前且含有该 CLI。
暂存 zip 会因 language-server 包及其 `typescript` 对等依赖而变大。
只跑 `pnpm deploy --prod`、不跑暂存脚本的重建可能再次漏掉该 CLI；该脚本就是保持 zip 完整的拷贝步骤。

## 测试

`internal/sidecar/env_test.go` 钉住 PATH 前置、`PATH`/`Path` 合并，以及保留 `PATHEXT`。
`go vet ./internal/sidecar` 覆盖启动点。
打 zip 之前，暂存断言 `dsh-runtime/node_modules/.bin/typescript-language-server.CMD` 与 `lib/cli.mjs` 存在。
