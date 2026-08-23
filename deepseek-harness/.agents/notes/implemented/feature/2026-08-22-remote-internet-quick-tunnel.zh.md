# Agent Note: Remote 通过公网 HTTPS 隧道发布，而不是绑定局域网

Status: implemented

[English](2026-08-22-remote-internet-quick-tunnel.md) | 中文

## 问题

手机不在这台 PC 的 Wi-Fi 上时，即使监听器绑定 `0.0.0.0`，也无法打开一个只广告私有 IPv4 的入口。家用 NAT、CGNAT 以及关闭的 UPnP 会拦住从互联网进入桌面的 TCP，因此只分享局域网 URL 的「Remote」一旦操作者改用蜂窝或其他网络就会失败。

## 决策

**EnableRemote 通过 Cloudflare Quick Tunnel 发布回环上的 harness，并把该 HTTPS URL（加上既有的不可猜测 `access` token）放到 QR 上。** `internal/remote` 监听 `127.0.0.1`，用同一套 cookie 门反向代理到 sidecar，并运行缓存的 `cloudflared tunnel --url`；`RemoteChip` 复制的是其 `*.trycloudflare.com` 主机。首次开启会把钉住的 `cloudflared` `2026.8.2` 下载到 `%LOCALAPPDATA%\openharness\cloudflared` 并校验 SHA-256；之后复用该二进制。DisableRemote 与应用退出会杀掉隧道进程。PC 需要出站互联网；手机可以在任意网络。持有仍有效链接的人能像在桌面上一样操作全部会话。

侧栏 chip 的位置不变：[Remote 放在侧栏、位于模型 chip 之上](2026-08-22-lan-remote-sidebar-chip.zh.md)。

## 考虑过的替代方案

**UPnP / NAT-PMP，再把 WAN IPv4 放进 QR。** 已拒：CGNAT 和许多 ISP 路由器根本建不成可达映射，从蜂窝访问时广告出的 URL 仍然失败。

**手写端口转发说明。** 已拒：操作者要求的是 PC 开机且 OpenHarness 打开即可访问，而不是去配置路由器。

**ngrok 或需要 Cloudflare 账户的具名隧道。** 已拒：Quick Tunnel 不需要账户或额外产品登录；URL 已随每次 EnableRemote 与 token 一起轮换。

**继续广告局域网 IPv4，把互联网视为范围外。** 已拒：那正是手机离开 Wi-Fi 就无法到达的行为。

## 后果

Remote 不再打开入站局域网端口或 Windows 防火墙规则。下载 `cloudflared`、校验或拿到 `trycloudflare.com` URL 失败时，EnableRemote 失败，而不是回退成只含局域网的 QR。Quick Tunnel 主机名是 Cloudflare 的临时测试主机；Cloudflare 宕机或策略变化会让 EnableRemote 失败，直到另一个发布者替换 `openPublicTunnel`。测试注入该函数，从不下载二进制。

## 测试

`internal/remote` 单元测试注入 `openPublicTunnel`，断言广告 URL、cookie 门、隧道停止、日志行主机名解析和 SHA-256 辅助函数。`remote-chip.client.spec.tsx` 仍驱动面板文案，包括互联网警告。
