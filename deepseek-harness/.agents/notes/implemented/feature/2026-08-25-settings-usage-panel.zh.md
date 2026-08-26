# Agent Note: Settings 用量面板

Status: implemented

[English](2026-08-25-settings-usage-panel.md) | 中文

## 问题

Settings → Usages 只列出 coding-plan 的实时账户配额。token 消耗、按日历史和常用模型留在各会话日志里，因此打开 Settings 的用户看不到本 Host 的用量；删除会话后，这些消耗也无法再被扫描到。

## 决策

**沿用已有的 `usages` Settings 分节作为用量面板：一份 Host 本地的按日／按模型账本，外加原来就在该页的配额卡片。**

`usage.panel` 是新的客户端请求领域。Host 按 token-meter 的方式折叠 `request/header` 以及 `assistant/chunk`／`assistant/message` 用量样本：同一 turn/step 的后续样本替换先前桶，且不增加 `requests`。日期取自 `event.time` 的 Host 本地日历。路由以 JSON `[provider, model]` 元组为键，因此模型 id 可以包含 `/`。在任何 header 之前到达的用量记到 `unknown`／`unknown`。

持久文件是 `$DSH_HOME/usage-panel.json`。网关插件把该路径传入 `createApiProxy`；测试省略路径，折叠只留在进程内。启动时账本先读文件（缺失、损坏或版本不匹配视为空），再通过 `sessionPersistence.list`／`inspect` 回填仍在的会话日志，同时缓冲实时 `session/event`，然后按每会话 seq 水位线重放缓冲，避免 inspect 与实时事件重复计数。已删除会话仍留在按日和按模型合计中，因为这些桶在文件里，不在日志里。

浏览器页面（`UsagesSection`）保持导航 id `usages`，因此侧栏用量 chip 仍打开它。页面展示今日／7 日／全部合计、14 日柱、按用量排序的模型，然后是已有的 `llm.accountUsage` 配额卡片。

## 已考虑的替代方案

**每次打开 Settings 都扫描全部会话。** 否决：在大型语料上很慢，而且会丢掉已删除会话。

**把 `token-meter` 扩成全局文件账本。** 否决：token-meter 是带封闭配置的每会话投影；Host 本地文件和 RPC 属于网关。

**再加一个 Settings 导航 id。** 否决：用量 chip 已经打开 `usages`；第二页会把配额和历史拆开。

**把折叠放进 `llm.*`。** 否决：这些值是 Host 本地会话记账，不是提供方账户配额。

## 后果

打开 Settings → Painel／Panel／面板即可看到本 Host 的请求与 token 历史，即使会话已被删除。配额仍是同一页的下半部分。账本文件不是账单：它跟随适配器在用量样本上报告的值。

## 测试

`usage-panel.spec.ts` 覆盖新 step 与同 step 替换、按日／按模型拆分、水位线、回填、损坏文件以及实时缓冲。`api-proxy-usage.spec.ts` 通过 `usage.panel` 折叠一个实时会话。载体测试往返新方法。`usages-section.client.spec.tsx` 覆盖空历史、排序模型、配额卡片、刷新和加载失败。
