# Agent Note: Cursor Settings catalog is a model-row array

Status: implemented

[English](2026-08-26-llm-cursor-models-array-catalog.md) | 中文

## 问题

Cursor 的 Settings 卡片没有模型列表，登录后 composer 选择器也没有 Cursor 分组。`Config.models` 曾是名称字典，因此 `layoutOf('llm-cursor')` 跳过 `ModelListEditor` 以免禁用 Apply。`listModels` 调用 `GetUsableModels` 时沿用传输层 120 秒的响应头超时；宿主选择器对每个提供方限定 4 秒，超时的分组会被丢弃，而不会改用已配置的目录。

## 决策

- `Config.models` 是 `{ id, name?, contextWindow?, maxTokens? }` 行组成的数组，默认 Composer 2.5（200k/32k），字段与 Kimi、DeepSeek 交给 Settings 的目录相同。
- Cursor 卡片渲染 `ModelListEditor`。继承的 schema 默认值填入各行；Fetch 对 `llm-cursor` 调用 `discoverModels`。
- native 与 SDK 的 `listModels` 在 2.5 秒处中止凭据解析和实时列表。空列表、失败或中止时返回配置数组，选择器仍会发布 Cursor 分组。
- `installSettingsSection` 的 `setSource` 让 adapter 读取实时 settings 快照，Apply 无需重启即可更新回退目录。

登录与 native 默认仍由 [Cursor native default and Settings Sign in](2026-08-26-llm-cursor-settings-native.zh.md) 负责。

## 考虑过的替代方案

**保留名称字典，另加只读实时列表。** 否决：Fetch/Apply 无法持久化行；RPC 超过 4 秒时选择器仍然会消失。

**列表不设上限，依赖宿主 4 秒限制。** 否决：该限制记为失败并丢掉分组；`listModels` 内部的目录回退不会执行。

## 后果

- Settings → Models → Cursor → 自定义设置 在用户自定义或拉取之前显示 Composer 2.5。
- 只有当 `x-cursor-client-version` 仍被后端接受时，实时 `GetUsableModels` 才会把 Grok 以及该账户目录的其余模型填进选择器（[版本钉扎](../../bug-fix/2026-08-26-llm-cursor-client-version-rejected.zh.md)）。
- 挂起的 `GetUsableModels` 或 SDK `Cursor.models.list` 不再把 Cursor 从选择器中移除。
- 手写进 `settings.yaml` 的 `models:` 映射对本节无效；数组是唯一接受的目录形式。
