# Agent Note: 权限标签、工具行与中止错误的 locale chrome

Status: implemented

[English](2026-08-22-locale-ui-chrome-and-abort-messages.md) | 中文

## 问题

composer 把 locale 文案与英文 chrome 混在一起：Access chip 显示 `Full access` / `Read Only` / `Workspace Write`，工具行显示 `Pwsh` / `Code` / `Tool call`，`/compact` 保留 wire 名，Inspect / IN / OUT 是英文字面量。折叠错误行显示 `Error: wait aborted` 和 `Error: code run failed (abort): [object Object]`，因为 `AbortSignal.reason` 常常是 `AgentCancelCause` 对象，而 `String(object)` 就是 `[object Object]`。模型撰写的工具描述（pwsh 的 `description` 参数）按构造即是英文，必须保持原文。

## 决策

**UI chrome 是 locale 文案；模型撰写的参数与持久化执行器英文留在会话日志上。** 权限选择器使用 `access.*` / `preset.*` 键，并将该名称内插进确认对话框（见 [GUI Full access 风险确认](2026-07-31-gui-full-access-confirmation.zh.md)）。工具行在 `toolRowModel` 中保留英文标题，在渲染点经 `localizedToolTitle` / `localizeDisplayedError` 翻译。已知执行器前缀（`Error: wait aborted`、`code run failed (abort): …`、`command aborted`）在折叠行与 Output 区重映射；未知正文保持原文。`formatThrownMessage` / worker `messageOf` 渲染 `{ kind }` 取消原因，而不是 `[object Object]`。

## 考虑过的替代方案

**机器翻译模型 `description` 参数和每一段工具结果正文。** 已拒：那些字符串对模型可见，并从会话日志重建；UI 改写会与回放和模型不一致。

**把 `toolRowModel.title` 改成 locale 键。** 已拒：纯模型保持无语言，以便单测在没有 `t` seat 时钉住分类；只有渲染点做本地化。

**把 `Full access` 保留为英文产品品牌。** 已拒：该 chip 紧挨已完全本地化的 composer 文案，且确认框已经内插 locale 名称。

## 后果

葡萄牙语会话显示 Acesso total、Código、Chamada de ferramenta、Compactar，以及 Erro: espera cancelada。停止一次 `run_code` 调用会记录 `code run failed (abort): user`，而不是 `[object Object]`。仍含 `[object Object]` 的历史日志只在 UI 中映射为「已取消」locale 字符串。
