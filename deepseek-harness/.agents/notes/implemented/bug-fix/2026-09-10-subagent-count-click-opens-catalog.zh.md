# Agent Note: 数量控件点击打开子代理目录

Status: implemented

[English](2026-09-10-subagent-count-click-opens-catalog.md) | 中文

## 问题

`SubagentHeaderLineage` 中后代数量控件（`CatalogDropdown` 的 `variant: 'count'`）没有点击处理函数。目录只在 `mouseenter` 后延迟 150ms 才打开。在 OpenHarness 桌面 WebView 上点击“N 个子代理”没有任何反应，用户无法打开树。

上游 `dsh-v0.1.5-rc.1` 仍使用这一仅悬停触发器；缺口在本桌面壳，而不是缺少官方 Session V3 目录。

## 决策

数量触发器的 `onClick` 调用 `changeOpen(!open)`，因此点击会切换目录。悬停仍是附加路径，保持 150ms 打开延迟与 120ms 跨越宽限。键盘 ArrowDown 仍打开树并聚焦第一行。

提供 `openTitle` 的切换器在点击时仍导航到该祖先（并关闭已打开的目录）。不带 `openTitle` 的切换器与数量控件使用同一条点击切换路径，因此 sibling 切换不再只靠悬停。

此变更不移植官方 `feat/parent-subagent-catalog-foundation` 或 Session V3。

## 备选方案

**保持悬停为唯一指针路径，并文档化 ArrowDown。** 否决：现场报告是点击无反应；WebView2 不会可靠触发测试当作主路径的悬停延迟。

**把祖先切换器拆成 title 热区与单独箭头。** 否决：祖先点击已经表示“向上走”；悬停与 ArrowDown 仍打开该目录。报告的缺失是数量胶囊。

**移植官方 PR #3859（`worktree-sidebarsubagent`）。** 否决：该工作解析的是工作区文件树里的 subagent 会话根，不是此对话目录触发器。

## 影响

在桌面 WebView 上点击“N 个子代理”会打开目录（再点一次关闭）。悬停测试保留，并增加 jsdom 点击切换用例。[Web 子代理目录约定](../feature/2026-07-27-web-subagent-conversations.zh.md) 在悬停之外记录了这条点击路径。

## 测试

`packages/client/ui-subagent/tests/conversation-ui.client.spec.tsx` 点击数量触发器并断言树打开，再点一次断言关闭。既有的悬停延迟与跨越宽限用例保持不变。
