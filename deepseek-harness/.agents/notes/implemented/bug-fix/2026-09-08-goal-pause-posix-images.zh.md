# Agent Note: User-owned goal pause and POSIX assistant-message images

Status: implemented

[English](2026-09-08-goal-pause-posix-images.md) | 中文

## Problem

`requireDirectHuman` 下的 `update_goal resume` 可以在用户暂停的同一轮次解除持久 paused goal，因此模型可以撤销用户的停止。GoalBar 只在 `phase === 'paused'` 时显示 resume，因此会话恢复或 fork 之后 active 但已停用续行（未运行）的目标提供的是 pause，而不是 resume。

助手 markdown 要求图片目标为绝对 HTTP(S)。收束散文中的 POSIX 绝对路径（`/tmp/…`，包括注册 workspace 之外的截图）会渲染为 alt 文本。

## Decision

恢复持久 paused goal 是用户动作。`update_goal resume` 在调用 goal 服务之前，拒绝匹配的当前 goal 且 `phase === 'paused'`（`GOAL_TOOL_RESUME_PAUSED`）。重新启用 active 但已停用续行的目标，以及恢复 `blocked`，仍然允许。提示词与 `update_goal` 描述告诉模型不要恢复 paused goal。

GoalBar 的 pause 为 `phase === 'active' && activation === 'armed'`。Resume 为 `phase === 'paused'` 或 `phase === 'active' && activation === 'disarmed'`。后者的条带文案是 `phase.active.disarmed`（zh/en/pt/es）。进程本地 activation 仍不入持久投影：`GoalService.get` 为 `@Remote('get')`，`goal/activation-changed` 是 JSON 安全并已加入转发名单，ui-goal 通过 `goals.get`、该事件和 `connection/reset` 注入 `createGoalActivationSource`。变更仍走 `ctx.remote.goals`；ApiProxy `GoalsApi` 仍只含变更。

已定稿的 `MarkdownText` 接受可选 `pathImages` 词汇表。`AssistantMarkdown.localPathMediaUrl` 把 HTTP(S) 页面上的 POSIX 绝对目标映射为 `${origin}/api/file?path=`。加载失败则显示 alt 或原始路径。流式渲染关闭该词汇表。ApiProxy 经可选的 `downloads.file` 和 `ctx.fs` 提供 `GET`/`HEAD /api/file`，字节上限取自附件 `maxImageBytes`。即使 Windows 上 Node `path.isAbsolute` 为 false，也接受 POSIX `/` 路径。`downloads.file` 为可选，因此不改 connection fixture。

## Alternatives considered

**把 activation 写入持久 goal 投影。** 否决：activation 按设计是进程本地的；折进 `goal` 会在恢复会话时启用续行。

**把带 Scope 的 `goal/changed` 转发给浏览器。** 否决：载荷携带 Agent，对 `ctx.remote.$on` 不是 JSON 安全的。

**只靠提示词约束，不设 `GOAL_TOOL_RESUME_PAUSED`。** 否决：工具执行器必须拒绝该调用。

**第二条图片流水线或新网关。** 否决：本 fork 有 ApiProxy，没有 session-controller / `@Remote` gateway fetch。Host 路径与 `session.export` 同属 GET 下载族。

## Consequences

模型不能恢复用户暂停的 goal；GoalBar 的 resume 覆盖 paused 与未运行目标。当 Host 有 `ctx.fs` 时，助手收束散文可以显示 POSIX 绝对路径图片。实际 UI 需要重新生成 Typert `goals.get`。Windows 本地 `C:\…` 目标仍保持不可显示。connection fixture 不实现 `goals/get` 或 `/api/file`。

## Testing

`tool-goal` 拒绝 paused resume，并仍允许通过工具重新启用 disarmed-active。`goal` 固定 create、session-start 与 resume 上的 `goal/activation-changed`。ui-goal 覆盖 GoalBar armed/disarmed 控件与 activation source。ui-primitives 与 ui-conversation 覆盖 `pathImages` 与 `localPathMediaUrl`。apiproxy 覆盖 `/api/file` 路由与 POSIX 路径拒绝。
