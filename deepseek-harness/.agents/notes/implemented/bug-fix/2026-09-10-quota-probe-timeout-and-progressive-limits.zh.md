# Agent Note: 配额探测限时，限额页随到达绘制卡片

Status: implemented

[English](2026-09-10-quota-probe-timeout-and-progressive-limits.md) | 中文

## 问题

环境配额（侧栏徽章与 composer `QuotaRing` 上的 `useProviderQuota`）以及设置 → 限额（`QuotasSection`）调用 `llm.accountUsage` 时没有探测超时。Cursor 的 `fetchCursorAccountUsage` 会打开 HTTP/2 `connect()`，除非传入 signal，否则会一直等。挂起的 `GetCurrentPeriodUsage` 让徽章一直空白；限额页用 `Promise.all`，因此整页计划卡片都不出现。徽章与圆环各自探测同一提供方。

RPC 一元调用的默认超时是 30 秒，对环境读数仍然过长。

## 决策

每次客户端配额探测以 2.5 秒为上限（与 Kimi 实时目录列举超时同一量级）。`useProviderQuota` 与限额页用可释放的超时 signal 和 `awaitWithAbort` 包装每次 `accountUsage`，因此忽略 `AbortSignal` 的 loader 仍会失败关闭。卸载会中止调用方的等待；另一表面仍需要时，共享的在途探测不会被取消。

`loadAccountUsage` 把可选 `AbortSignal` 转给 `api.accountUsage`。`fetchCursorAccountUsage` 在调用方未传 signal 时应用同一 2.5 秒上限，在中止或超时时装销毁 HTTP/2 请求，并始终 `client.close()`。Pi-ai 的 `fetchUsageJson` 已经尊重调用方 signal。

限额页在 `providers()` 返回后，随每个探测结算绘制卡片（在途行使用加载占位）。不支持的路由仍被省略。超时或中止变成 `{ supported: true, error }`，文案为 `usage.quotaTimeout`，因此其他计划仍可见。刷新会中止上一批并重新加载每个提供方。

徽章与圆环按 loader 函数与提供方共享 60 秒成功缓存，因此两个环境表面不会对 Cursor 打两次。失败不缓存；一分钟节奏会重试。

环境徽章与圆环仍通过 `leadQuotaWindow` 在出错时隐藏。

## 备选方案

**依赖 RPC 客户端 30 秒一元超时。** 否决：徽章会空半分钟，限额页仍等待 `Promise.all`，而且宿主侧没有 signal 的 HTTP/2 `connect()` 不会因为 HTTP POST 超时而被中止。

**限额页继续 `Promise.all`，只加 2.5 秒上限。** 否决：即便有超时，页面也会停在整页加载提示上，直到最慢的提供方结束。

**跳过 60 秒单飞行缓存。** 作为可选项被接受；缓存很小（`WeakMap`：loader → 提供方 → 在途或 TTL 视图），并阻止徽章+圆环打开两个 HTTP/2 会话。

**移植官方 Session V3 / parent-subagent-catalog-foundation。** 否决：与配额探测无关。

## 影响

挂起的 Cursor 或 Codex 探测在 2.5 秒内失败，而不再挂起徽章、圆环或限额页。限额页显示已经返回的每一项计划。徽章与圆环每提供方每分钟共享一次成功读取。超时文案以 `usage.quotaTimeout` 存在于 zh/en/pt/es。

这扩展了 [Cursor 月度配额](2026-09-10-cursor-monthly-quota.zh.md) 与 [首要窗口徽章/圆环](2026-09-09-quota-ring-composer-chip.zh.md)，不改变这些表面展示哪一个窗口。

## 测试

`usage-quota-live.client.spec.tsx` 钉住中止/超时辅助、缓存 TTL、在途合并，以及两个圆环共享同一 loader。徽章与圆环 spec 断言探测中止或挂起时环境读数保持隐藏。`quotas-section.client.spec.tsx` 在 Cursor 永不返回时画出 Kimi，并在已结算计划旁保留超时的 Cursor 卡片。`llm-cursor` 的 `usage.spec.ts` 中止挂起请求、拒绝已中止的 signal，并在调用方省略 signal 时超时。
