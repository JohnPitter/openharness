# Agent Note: Workflow 纯文本规划器为有视觉的工人接纳图片

Status: implemented

中文 | [English](2026-08-27-workflow-text-only-planner-forwards-images.md)

## Problem

`sessions.prompt` 仅在**会话**（规划器）模型的 `inputModalities` 声明 `image` 时接纳图片部件。Workflow 模式下规划器常常是按 request 计费的纯文本路由，而工人芯片上才是带视觉的模型。此时 composer 会以 `MODEL_DOES_NOT_SUPPORT_IMAGES` 拒绝附件，即便被委派的工人本可以使用这些像素。

另一方面，spawn 与 workflow 的 `agent()` 子代理只收到文本 `prompt`。它们不继承父日志（`inheritsParentContext = false`），Workflow 编排器也不能调用 `read_image` 或 `subagent_fork`。即便图片已落到父会话，也不会到达工人。

[Web 多模态接纳](2026-07-22-web-multimodal-image-input-and-durable-attachments.md) 负责宿主预检与规划器请求的纯文本投影。[编排器/工人分工](../architecture/2026-08-22-workflow-orchestrator-thinks-workers-execute.md) 负责谁可采集与修改。二者都未覆盖“以工人能力接纳”或“在 spawn 提示中附带图片”。

## Decision

**接纳。** 当提示含图片且规划器路由不接受图片时，若该 agent 的 composed preset 为 `workflow`，且 `agentDefaultModel.currentWorkerSelection()` 解析到接受图片的路由（`inputModalities` 未定义或包含 `image`），则 `createApiProxy` 仍接纳。否则沿用既有的 `MODEL_DOES_NOT_SUPPORT_IMAGES` 拒绝。规划器请求仍走 `projectImagesForTextModel`，纯文本规划器只看到占位符，看不到像素。

**转发。** `spawnPromptWithParentImages` 将每个 Workflow spawn / workflow 子提示构造成任务文本，加上父会话最近一条真实 `user/message` 中的图片块。`tool-subagent` 与 `workflow-worker-thread` 都使用该助手。非 Workflow 父会话保持纯文本。Workflow 人设告知规划器为工人描述视觉任务；工人人设说明所附图片已被转发。

## Alternatives considered

**要求规划器自身具备视觉。** 否定了“廉价协调器把看图与改码交给有视觉的工人”这一产品分工。

**把 Workflow spawn 改成 fork 以继承历史。** 编排器禁止 `subagent_fork`，且 fork 会把整段规划器 transcript 拉进每个工人。

**把图片落盘并让规划器在提示里写路径供 `read_image`。** 规划器不能调用 `read_image`；路径仍需工人知道去哪读，且在持久化之前接纳已经失败。

**仅在客户端软放行。** 宿主门禁是权威；只改客户端仍会收到 `attachment-error`。

## Consequences

带纯文本规划器与有视觉工人的 Workflow 会话可以接纳用户图片。每次 `subagent` / workflow `agent()` 启动都会附上这些持久引用，使工人模型看到图片。Standard 与 Code preset 不变。ACP 与 `read_image` 门禁仍按规划器/路由本地处理。测试覆盖有无工人选择时的宿主接纳，以及 Workflow 与其它 preset 下父回合图片收集。
