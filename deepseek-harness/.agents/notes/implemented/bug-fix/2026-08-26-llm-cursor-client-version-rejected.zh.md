# Agent Note: Cursor 列举需要当前的 clientVersion 钉扎

Status: implemented

[English](2026-08-26-llm-cursor-client-version-rejected.md) | 中文

## 问题

native Cursor adapter 发送编译期的 `x-cursor-client-version` 钉扎。Cursor 发布 `3.17.21` 之后，后端拒绝 `3.17.19`，Connect trailer 为 `resource_exhausted`，人可读详情是 “Your version of Cursor is no longer supported… cursor.com/downloads”。`GetUsableModels` 在 2.5 秒列举时限内失败，选择器只发布配置回退（Composer 2.5）。同一 trailer 打在 `StreamUnifiedChatWithTools` 上被映射为 `RATE_LIMIT`，循环重试五次。

在实时列举成功之前，Grok 以及 Cursor 目录的其余模型不会出现。它们不是独立的 OpenHarness 提供方。

## 决策

`DEFAULT_CLIENT_VERSION` 为 `3.17.21`，与 `stable`/`win32-x64-user` 通道以及已安装 Cursor 的 `product.json` `version` 一致。schema 与 adapter 构造默认值使用该常量。native 传输头从实时 settings 快照读取 `clientVersion`，因此 Apply 无需重启即可提高钉扎。

`decodeTrailer` 仍把配额类 `resource_exhausted` 映射为 `RATE_LIMIT`。当合并后的消息包含 `no longer supported` 或 `cursor.com/downloads` 时，代码为 `PROVIDER_ERROR`，循环不会把被拒绝的钉扎当作配额。

咨询用 `models` 数组仍是 Composer 2.5。实时 `GetUsableModels` 在一元响应被解码后才是 Grok 及其他 Cursor id 的目录（[列举解码](2026-08-27-llm-cursor-usable-models-connect-frames.zh.md)）。

## 考虑过的替代方案

**启动时探测 updater API，并把其报告的最新版本发出去。** 否决：每次启动多一次网络；非官方头必须作为可审查的源码钉扎。

**把猜测的 Grok / GPT / Claude id 写入 `DEFAULT_MODELS`。** 否决：错误 id 会在请求时失败；钉扎被接受后，实时列举已经返回该账户可用集合。

**继续把所有 `resource_exhausted` 映射为 `RATE_LIMIT`。** 否决：版本详情与配额文本可区分；五次配额重试只会拖延一个在改头之前不可能成功的钉扎。

## 后果

仍接受 `3.17.21` 的后端会把完整可用目录交给选择器。下一次 Cursor 桌面版升级可以用同样方式拒绝此钉扎；维护者在同一次变更中提高 `DEFAULT_CLIENT_VERSION`。不含版本短语的配额与账单 trailer 仍是 `RATE_LIMIT`。
