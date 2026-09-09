# Agent Note: 运行时长时钟在满 60 分钟后进位到小时

Status: implemented

[English](2026-09-09-run-duration-hours.md) | 中文

## Problem

`ui-conversation` 消息 chrome 中的 `formatRunDuration` 将经过毫秒向下取整为整秒，再把分钟格式化为 `floor(total / 60)` 且不做对 60 取模。因此 live「Deep diving…」时钟、已结束的「用时」页脚以及压缩进度耗时标签在超过一小时后会显示 `66min 59s` 这类值。

## Decision

该 helper 把经过秒数拆成 `hours`、`minutes % 60` 与 `seconds % 60`。当 `hours > 0` 时，使用新的 `duration.hours` 模板，分钟与秒均为两位补零（pt 为 `1h 06min 59s`）。不足一小时的时长仍走现有 `duration.minutes` 与 `duration.seconds` 模板。负数仍在向下取整前钳制为零。

`StatsLine.formatDuration` 保持不变；它以紧凑的 `2m42s` 风格格式化作曲器 dock 的延迟合计，不是 Deep diving 时钟。

## Alternatives considered

**在分钟模板中增加可选的小时占位符。** 拒绝：各语言都要在一条字符串里做别扭分支，且分钟分支若不单独进位仍有重复计数风险。

**让消息 chrome 复用 `StatsLine.formatDuration`。** 拒绝：dock helper 是无单位的英文简写，不是本地化的回合 chrome。

## Consequences

回合 chrome 与压缩进度在达到 3600 秒及以上时显示带小时的耗时标签。zh、en、pt、es 均在 `duration.minutes` 之后新增 `duration.hours`。

## Verification

`chat-view.client.spec.tsx` 通过 zh 词典固定零值、负数钳制、不足一分钟的向下取整、不足一小时的分钟、恰好一小时、66 分 59 秒以及多小时余量。
