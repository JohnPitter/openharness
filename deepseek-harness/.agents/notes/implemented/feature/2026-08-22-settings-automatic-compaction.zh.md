# Agent Note: 通用设置控制自动压缩

Status: implemented

[English](2026-08-22-settings-automatic-compaction.md) | 中文

## 问题

自动压缩由加载期 `BasicCompactionConfig.auto` 与 `thresholdRatio`（默认 `0.8`）触发。通用设置对话框没有对应控件，因此关闭该行为或选择触发时机只能改 cordis.yml 并重新挂载引擎。

## 决策

第一个见到 `ctx.get('settings')` 的 `compaction-basic` 引擎会注册命名空间 `compaction-basic`，字段为 `auto`（默认 `true`）和 `thresholdPercent`（`25`、`50`、`75` 或 `100`；默认 `75`，即最接近 Config `0.8` 的可选比例）。注册从不读取 `ctx.settings`：agent preset 的 fiber 会隔离 compaction，且不 inject 宿主的 settings 服务，属性代理会拒绝挂载。之后的常驻挂载对该命名空间不再注册。压力检查在事件时用 `thresholdPercent / 100` 替换已路由 Config 的 `thresholdRatio`。`auto: false` 会在下一次检查时跳过 `agent/pre-step` 压力 listener 和溢出恢复；`/compact` 与 `compactNow()` 仍然可用。没有 settings 提供方的组合继续使用插件 Config，包括 `thresholdRatio: 0.8`。

ui-conversation 把同一命名空间绑定到两行通用设置（开/关与百分比菜单）。关闭自动压缩时禁用阈值选择器。该覆盖不改变溢出对阈值和保留策略的绕过。

这把实时覆盖加到[已路由模型上下文与压缩策略](../architecture/2026-07-20-routed-model-context-and-compaction-policy.zh.md)中的加载期策略之上。

## 考虑过的替代方案

**把 `auto` 和百分比放到 `ui-conversation` settings。** 不予采纳：引擎会依赖 UI 包，无头组合也无法共享这份文档。

**在通用设置中保留 `thresholdRatio: 0.8` 作为第五个选项。** 不予采纳：要求的离散集合是 `25` / `50` / `75` / `100`；`75` 是最接近的可选值。

**关闭 `auto` 时只关掉压力，把溢出留作安全网。** 不予采纳：已交付的 Config `auto: false` 本来就表示仅手动，包括不做溢出恢复。

**每个预设挂载都注册该命名空间，且不做幂等跳过。** 不予采纳：重复命名空间会让 `settings.register` 立即失败。

## 后果

因此，带 settings 的 Web 或桌面宿主会在操作者另选百分比之前，按已路由窗口的 75% 压缩，即使 cordis.yml 仍写着 `0.8`。从不加载 settings 的 CLI 和测试继续使用 `0.8`。第一个引擎 fiber 被销毁时会卸掉该命名空间，直到另一次挂载再次注册；常驻预设挂载会在进程生命周期内保住该 fiber。

## 测试

`user-settings.spec.ts` 覆盖 overlay 计算与被拒绝的段。`compaction-basic.spec.ts` 只注册一次 schema（包括在能 `get('settings')` 但不得读取 `ctx.settings` 的 fiber 上）、拒绝 `80`、在 `compactIfNeeded` 上覆盖 `25` / `100`，并在 `auto` 为 false 时跳过两个自动 listener。ui-conversation 的行与策略 spec 驱动开/关、50% 以及 Host 采纳。settings-chrome e2e 快照包含这两行新的通用设置。
