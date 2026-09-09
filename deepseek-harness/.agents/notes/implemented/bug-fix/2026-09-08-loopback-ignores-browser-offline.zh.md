# Agent Note: 回环页忽略浏览器离线；模型目录在 reset 时保留上次成功快照

Status: implemented

[English](2026-09-08-loopback-ignores-browser-offline.md) | 中文

## Problem

0.1.57 的连接移植（[择入的 alpha.2 恢复](../feature/2026-08-30-selective-upstream-fixes-dsh-0-1-2-alpha-2.zh.md)）订阅 `window` 的 `online`/`offline`，并调用 `ConnectionController.setNetworkAvailable`。进入离线会中止当前 generation。下一 generation 的 `onConnected` 发出 `connection/reset`，而 `ModelDirectory.resetConnected` 在重新拉取前会清空 `current` 与 `groups`。

OpenHarness（以及 127.0.0.1 上的 `dsh web`）连的是回环 sidecar。`navigator.onLine` 报告的是广域网，不是回环。WebView2 会在 sidecar 仍可用时发出虚假 `offline`。作曲器芯片于是读到 `trigger.fallback`（“Selecionar modelo”），菜单为空，直到 `session.models` 返回。

## Decision

回环页面权威（`ConnectionHandle.isLoopback`）不订阅浏览器 online/offline。非回环页面仍保留该监视：广域网断开时应暂停重试。

`ModelDirectory.resetConnected` 不再清空快照。它使进行中的写入失效并调用 `load()`，而 `load()` 本来就会把 `status` 设为 `'loading'` 且不丢掉上次成功的 `current`/`groups`。Host 应答到达后仍替换快照。被寻址的子代理会话仍跳过这次重新加载。

## Alternatives considered

**继续清空，以免未保存的本地选择在 Host 重启后残留。** 拒绝：OpenHarness 的重连几乎总是同一个 sidecar 进程。在 `session.models` 落地前显示上次成功快照，与 0.1.57 已用于 `@`/`/` 菜单的 stale-while-revalidate 规则相同。Host 重启仍会收敛到已记录的选择。

**对 `offline` 做防抖，而不是在回环上跳过。** 拒绝：真正的广域网断开也不应中止 127.0.0.1 的 generation。防抖只是在计时结束后仍会拆掉健康的 sidecar。

**到处忽略 `navigator.onLine`。** 拒绝：经隧道的非回环客户端在浏览器报告离线时应停止重试。

## Consequences

桌面 OpenHarness 在 WebView2 网络闪断期间仍保持模型芯片有内容。经隧道的手机客户端仍尊重离线。真正的流丢失仍会重连并刷新目录，但刷新期间芯片不再闪成空。

## Testing

`client-apply.client.spec.ts` 断言回环 `start()` 不安装 `offline` 监听，而非回环页在该监听触发后进入 `disconnected`。`connection.client.spec.ts` 覆盖 `setNetworkAvailable(false)` 中止活 generation。`browser-plugin.client.spec.ts` 断言 `connection/reset` 在 `loading` 时保留上次成功的 `current`/`groups`，随后写入 Host 目标。
