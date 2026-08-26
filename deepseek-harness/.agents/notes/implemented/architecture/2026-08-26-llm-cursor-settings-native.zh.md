# Agent Note: Cursor 默认 native 与 Settings 登录

Status: implemented

[English](2026-08-26-llm-cursor-settings-native.md) | 中文

## 问题

`llm-cursor` 已编入默认 bundle，但无法随 OpenHarness 桌面版发布：宿主 TypeScript 程序未列出该包，Settings 将 `llm-cursor` 视为未知布局（Apply 禁用），Sign in 只对接 `/dsh-llm-pi-ai/oauth`，插件默认走 Cloud Agent SDK——那是嵌套 agent，不是 harness 循环中的 LLM。

## 决策

- 宿主构建在 `tsconfig.host.json` 中列出 `packages/llm/llm-cursor`。默认 `transportMode` 为 `native`（Connect/protobuf HTTP/2）；`sdk` 仍可在 settings 中显式覆盖。
- `apiKeyEnv` 默认为 `CURSOR_ACCESS_TOKEN`。两个 adapter 均声明 `metering: 'requests'`。
- Settings `layoutOf('llm-cursor')` 为家族 `cursor`：OAuth 按钮、可粘贴 token，以及与 Kimi 共用的模型行数组编辑器（[目录](2026-08-26-llm-cursor-models-array-catalog.zh.md)）。
- 插件挂载 `GET/POST /dsh-llm-cursor/oauth/{status,login,logout}`。Models 的 OAuth 客户端将该前缀与 pi-ai 合并，并把 `provider === 'cursor'` 路由到 Cursor。

## 考虑过的替代方案

**保持 SDK 为默认。** 否决：OpenHarness 在循环内与提供方通话；Cloud Agent 是第二个 agent。

**复用 pi-ai 的 OAuth HTTP 前缀。** 否决：该 handler 绑定 `PiAiAdapter` 路由；Cursor 的 token 与登录属于 `llm-cursor`。

**目录行编辑。** 由 [模型数组目录](2026-08-26-llm-cursor-models-array-catalog.zh.md) 负责；本笔记不选择 Settings 的模型列表控件。

## 后果

- Settings → Models 显示 Cursor 卡片，可以 Sign in 或存储 JWT，再从实时列表选择模型。
- Windows 的 Sign in 用 `start "" "<url>"` 打开浏览器，避免 `cmd` 把 `loginDeepControl?challenge=&uuid=&mode=` 在 `&` 处切断。
- 桌面 runtime 必须把 `proto/lite.proto` 拷到打包后的 `lib/` 旁（`import.meta.url` 解析 `../proto/lite.proto`）。
