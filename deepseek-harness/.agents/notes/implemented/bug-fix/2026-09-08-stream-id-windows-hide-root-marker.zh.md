# Agent Note: 流式身份、隐藏 Windows 子进程与失败即关闭的根标记

Status: implemented

[English](2026-09-08-stream-id-windows-hide-root-marker.md) | 中文

## 问题

官方 `dsh-v0.1.5-alpha.1` 中的三项彼此独立的缺陷在本 fork 上同样存在。

后续 SSE 分片若把工具调用的 `id` 或 `name` 重复为 `''` 或 `null`，会覆盖首次分片已建立的身份，因为 `!== undefined` 把二者都当成“有值”。组装后的块随后以 `unknown tool ""` 失败，空的 `callId` 还会写入 `tool/result`。同一转换器存在于 `llm-deepseek` 与 fork 专有的 `llm-kimi` 克隆中。

当 GUI 宿主没有可见控制台时，Windows 会为非终端子进程创建可见控制台窗口，因此后台命令或 `taskkill` 辅助进程会闪现并抢占焦点。

项目根发现把所有标记 resolve 或 stat 故障都当作缺失并继续向上，因此 `EACCES` 或提供方 I/O 错误可能加载祖先 `AGENTS.md` 并报告成功。

## 决策

DeepSeek 与 Kimi 转换器中的 `acceptIdentity` 只接受非空字符串作为 `id` 与 `name`。空串、`null` 或任何其他传入值都会保留已建立的身份。从未收到身份的工具调用仍以空串回退关闭；本次移植不引入 `MALFORMED_TOOL_CALL`。

本地子进程提供方在 Windows 路径上为每次非终端 `spawn`、以及两处同步 `taskkill` 调用点（`spawn.ts` 与 `windows-inspector.ts`）设置 `windowsHide: true`。终端进程仍由 PTY 实现决定可见性。

只有当宿主 `stat` 报告 `ENOENT` 或 `ENOTDIR`，或文件系统提供方未返回 stat 信息，或从解析或 stat 报告 `FS_NOT_FOUND` 时，根标记发现才会继续向上。检查取消后，其他标记错误会原样重新抛出。指令文件候选项保留“不可用则跳过”的策略，这不会改变项目身份。[工作区上下文说明](../feature/2026-06-24-workspace-context.zh.md)仍负责基线注入与默认 `.git` 上溯；本说明负责失败即关闭的探测。

## 考虑过的替代方案

**因为字段存在，就把空的 `id`/`name` 当作赋值。** 不予采用：已观察到的 OpenAI 兼容网关会在后续分片中把这些字段重复为空串或 null，而那种赋值正是被报告的擦除。

**拒绝从未收到身份的工具调用流（`MALFORMED_TOOL_CALL`）。** 本次移植不予采用：上游随后把同一修复收窄为只接受身份，因为拒绝会把提供方已发送的 `max-tokens` finish 覆盖成重试。本 fork 仍使用 ApiProxy，也没有该失败 code。

**只隐藏主子进程，或把 `windowsHide` 暴露为调用方选项。** 不予采用：`taskkill` 辅助进程仍会闪现，且消费方无法可靠知道本地宿主是否有控制台。

**把所有标记故障都当作缺失并继续向上。** 不予采用，因为无法访问的子目录可能继承无关祖先项目中的指令，而发现过程仍报告成功。

**在第一个不可用标记处停止，并把会话工作目录用作根目录。** 不予采用，因为这会把未知的项目根转换为另一个项目身份。

## 后果

DeepSeek 与 Kimi 上的流式工具调用会在空的后续分片中保留第一个非空身份。Windows 后台子进程与 `taskkill` 辅助进程不会创建可见窗口。项目根发现优先保证项目身份正确，而非可用性：祖先遍历中任何不是缺失的元数据故障都会使基线加载以原始错误拒绝，且该失败不会写入工作区上下文 Session event。

## 测试

`llm-deepseek` 与 `llm-kimi` 中的聚焦单元测试覆盖空串、null、重复以及并行后续身份。`subprocess-local` 注入进程启动器，并为主子进程与两条 `taskkill` 路径固定 `windowsHide`。agent-instructions 测试覆盖确认的提供方缺失，以及不可用的宿主与提供方标记元数据，并证明祖先指令不会进入派生模型历史。
