# Agent Note: Remote 放在侧栏、位于模型 chip 之上

Status: implemented

[English](2026-08-22-lan-remote-sidebar-chip.md) | 中文

## 问题

OpenHarness Remote 是桌面壳操作（通过 `postMessage` 向 Wails 父窗口索取 QR 与带 token 的 URL），不是按会话的模型设置。把它放进 composer `ModelSelect` 根菜单，会把主机级网络控制与 Model / Effort / J-space 混在一起，并在 workflow 工人选择器上隐藏它，同时侧栏底部在「当前使用的模型」行之上仍是空的——操作者正是在那里找会话 chrome。

## 决策

**Remote 是 `sidebar.footer.action` chip（`id: lan-remote`，`order: -20`），叠在用量/模型 chip（`id: usage-status`，`order: -10`）之上。** `RemoteChip` 沿用既有 `openharness:remote-enable` / `openharness:remote-ready` / `openharness:remote-disable` 消息与桌面父窗口通信。顶层 web 标签页（`window.parent === window`）打开同一面板并给出仅桌面可用的说明，从不发送 enable。composer 模型菜单只保留 Model / Effort / J-space。

该 QR 上的 URL 是公网 HTTPS 隧道：[Remote 通过公网 HTTPS 隧道发布，而不是绑定局域网](2026-08-22-remote-internet-quick-tunnel.zh.md)。

## 考虑过的替代方案

**继续把 Remote 作为 `ModelSelect` 根菜单第一行。** 已拒：该控制不是模型选择，且侧栏已经拥有当前模型行和 Settings。

**做成 Settings 分区或标题栏控件。** 已拒：操作者需要 QR 紧挨实时会话 chrome，而不离开对话。

## 后果

展开的侧栏依次显示 Remote、提供方/模型用量 chip、然后是 Settings。iframe 中的 harness 没有 OpenHarness exe 仍无法启动 Remote。仅浏览器的 `dsh web` 可以打开 chip 并读到仅桌面可用的文案。

## 测试

`remote-chip.client.spec.tsx` 驱动 idle/connecting/active 文案、仅桌面、enable/ready/error、复制与停止、Escape 与外侧 pointerdown，以及折叠轨。`browser-plugin.client.spec.ts` 钉住注册顺序 `-20` 再 `-10`。`model-select.client.spec.tsx` 断言 composer 根菜单从 Model 起、没有 Remote 行。
