# Agent Note: 会话归档查看与会话删除

Status: implemented

[English](2026-08-25-session-archive-view-and-delete.md) | 中文

## 问题

归档会把会话从所有分组视图中隐藏，且没有查看或恢复入口，因此用户归档一行之后就找不到它。产品还需要真正的破坏性删除，而这并不是[归档集合](2026-07-31-session-archive-global-set.zh.md)的职责。

## 决策

**归档仍是注册表级全局隐藏集合；workspace 浏览器增加尾部「已归档」分区并提供取消归档；破坏性移除是独立的 `session.delete`，只删除 `origin: 'subagent'` 后代。**

归档字段、`workspace.archiveSession` 以及 `host/archived-sessions-changed` 的全快照姿态保持不变。`tree.ts` 仍从 workspace 分组、Ungrouped、内容搜索和单列表的活动列表中隐藏已归档 id。这些 id 出现在尾部 **已归档** 分组（`ARCHIVED_KEY`）中，默认折叠，没有新建、拖拽或 workspace 菜单。`workspace.unarchiveSession` 从集合中移除一个 id，且不触碰记账，因此恢复后的行回到原先的 workspace 席位。本地归档当前打开的会话仍会清空到 New Session；从「已归档」打开一行会保持选中；其他标签页的归档帧仅在当前 id 新加入集合时才清空当前会话。

`session.delete` 属于 session 域。Host 先 dispose 它创建或恢复的 handle，再对完整身份集合调用 `SessionPersistence.delete` 和 `workspaceRegistry.forgetSession`：被点名的根会话以及每个 `origin: 'subagent'` 后代，不包括普通 fork。以具名子代理作为删除根会应答 `agent-busy`。未知 id 应答 `session-not-found`。`host/session-deleted` 总会从客户端列表中丢掉该行，包括 `host/session-removed` 会保留为空闲激活的 origin-subagent 行。Session 行的删除操作会打开确认框，说明将永久删除会话日志。

## 已考虑的替代方案

**把归档当成删除。** 否决：归档集合存在的目的就是让日志和记账在隐藏后仍然保留；用户要的是查看文件夹和真正删除这两项独立操作。

**随父会话删除普通 fork。** 否决：fork 是拥有独立日志的同级会话；只有 subagent origin 的子会话归父会话所有。

**在 `workspaceView` 中过滤已归档 id。** 否决：原归档 Note 已经把记账与显示分开，以便取消归档能恢复位置。

**复用 `host/session-removed` 做删除。** 否决：移除会把 origin-subagent 行保留为空闲激活；删除必须丢掉它们。

## 后果

已归档会话可以在侧边栏底部找到。删除不可撤销，并且会一并移除 origin-subagent 后代。删除 Workspace 注册记录仍然不会删除会话。这扩展了[会话归档集合](2026-07-31-session-archive-global-set.zh.md)，并补上[Workspace 注册记录删除](2026-07-27-workspace-registration-deletion.zh.md)决策中单独保留的会话删除能力。

## 测试

Workspace 注册表测试覆盖取消归档的幂等性以及 `forgetSession`。Apiproxy 测试覆盖取消归档帧、带冷 subagent 后代的实时删除、具名子代理的 `agent-busy`，以及未知 id 的 `session-not-found`。客户端 tree、行和浏览器规格覆盖「已归档」分区、取消归档和删除确认。workspace-management e2e 会归档进「Archived」、取消归档，然后删除种子日志。
