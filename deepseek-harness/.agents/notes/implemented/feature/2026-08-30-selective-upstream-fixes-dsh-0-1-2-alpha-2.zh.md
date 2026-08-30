# Agent Note: 从上游 dsh-v0.1.2-alpha.2 择入的修复

Status: implemented

[English](2026-08-30-selective-upstream-fixes-dsh-0-1-2-alpha-2.md) | 中文

## Problem

上游 `deepseek-ai/deepseek-harness` 在本 fork 上次取样的 alpha.1 标签之上发布了 `dsh-v0.1.2-alpha.2`。两项架构级变更仍推迟（[alpha.1 择入](2026-08-29-selective-upstream-fixes-dsh-0-1-2-alpha-1.md)）：用 `@Remote` API Gateway 替换 `ApiProxy`，以及会话 UI 的模块拆分。其余变更日志仍有本 fork 可以在不做该迁移的前提下吸收的恢复与列表工作。

## Decision

四项上游内容按本 fork 当前树手写移植：

1. **`@`/`/` 菜单 stale-while-revalidate**（`packages/client/ui-input-trigger`）：查询细化时保留上一批行与高亮，组进入 `pending`；高亮组未 `ready` 时 Enter 与 Tab 消费按键但不挑选。未移植上游的目录下钻 / 面包屑——本 fork 没有 `drill` 候选。
2. **设置触发器焦点还原**（`packages/client/ui-settings-general`）：关闭对话框后在关闭提交之后把焦点交回触发器，对话框不再占用焦点。
3. **连接恢复指示器**（`packages/client/connection`、`ui-primitives`、`ui-settings-general`）：`ConnectionState` 为 `'connected' | 'disconnected' | 'connecting'`。退避封顶后循环停在 `'disconnected'` 直到 `reconnect()` 或 `stop()`；`stop()` 中止重试睡眠。宽侧栏显示 `ConnectionIndicator`（中断、连接中圆点、两秒已恢复）。双流 mux+host 握手未改——本 fork 未采用推迟的网关上的 generation-source 重写。
4. **按预设分组的插件清单**（`packages/preset/agent-presets`、`packages/host/plugin-inventory`、`packages/client/ui-settings-plugin-inventory`）：`compositionInventory()` 读本运行时的驻留挂载，否则读组合文件；`pluginInventory.list()` 为异步并携带可选 `agentPresets`。驻留 `PresetTree` 收回父 Loader 条目的 `subtree` 槽，使预设行不出现在 `loader.entries()`。设置页把会话插件按预设分组（带切换器），全局宿主条目单独列出。随附预设的显示名经 `packages/preset/agent-presets/src/display.ts` 解析，使用本 fork 的 id（`standard`、`code`、`workflow`、`minimal`、`cordis`），而非上游的 `ptc`。

凡移植引入的文案都补了 pt/es 词典。已存在、与 Windows 无关、或绑在推迟架构上的条目未移植：token/time 芯片（本 fork 已有 TTFT / 时长 / tok/s）、日程 UI、DeepSeek `web_search` 错误端点、拆分后 `ui-chat` 中的会话 UI 打磨、网关 O(1) 流队列、Node 24.0–24.11 HMR、macOS/Linux skip-stat、`RemoteError`、英雄页鱼动画、npm peerDeps 裁剪。

## Alternatives considered

**合并 alpha.2 标签。** 与 alpha.1 同样拒绝：数千文件、session-projection 迁移、Cordis vendor 升级，以及上述两项推迟的架构变更。

**直接 cherry-pick 上游提交。** 拒绝：本 fork 的 locale、提供者和连接握手已经分叉，几乎每个触及的文件都会冲突。

## Consequences

桌面设置底栏在 Host 断开时给出一键重试，插件列表与用户已有的预设会话/全局划分对齐，作曲器 `@`/`/` 菜单在细化进行中不再提交过期行。后续网关移植必须保留本 fork 的 mux+host `ConnectionController`，并把 `'reconnecting'` 调用方改写为 `'connecting'` / `'disconnected'`。`pluginInventory.list` 快照字段一变，就必须重新生成 Typert Host/remote 产物。

## Verification

对触及的包跑聚焦套件，并在 Typert 重新生成后按需 `tsc -b` 客户端与宿主聚合。
