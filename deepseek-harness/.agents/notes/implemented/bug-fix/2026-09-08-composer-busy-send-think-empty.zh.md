# Agent Note: Composer 繁忙发送、Think 摘要标记与空 Host 提示

Status: implemented

[English](2026-09-08-composer-busy-send-think-empty.md) | 中文

## 问题

三处彼此独立的缺陷共用 composer 与 Host 准入路径。

`ui-conversation.busyEnter` 设置在智能体运行时为普通 Enter 选择 Queue 或 Steer。运行中草稿的发送按钮仍调用公开的 `InputActions.submit()` 面，而 `SessionInputShell.actions` 将其固定为 `'queue'`，按钮标签也停留在 `input.send`（「发送消息」）。选择 Steer 的用户从 Enter 得到 Steer，从同一草稿旁的按钮得到 Queue。Settings 行的标题和描述只点名 Enter 键。[alpha.1 的发送/停止席位](../feature/2026-08-29-selective-upstream-fixes-dsh-0-1-2-alpha-1.zh.md) 已经让运行中草稿显示发送而不是停止；它没有把那次点击绑到该偏好上。

折叠的 Think 摘要把推理块的首行或最新一行当作原始文本显示。模型会用 Markdown 粗体（`**…**`）包裹该行，因此折叠行会露出星号。

composer 会对 trim 后为空的草稿无操作，但 ApiProxy 上的 `session.prompt` 与 `session.updateQueue` 编辑会接受仅含空白的文本。仅含图片的提示必须保持有效。

## 决策

运行中的发送按钮按与普通 Enter 相同的模式投递。`InputBar` 每个渲染计算一次 `resolveSubmitMode(busyEnter, running, 'enter', steeringAvailable)`。`steeringAvailable` 为 `subagent === null`：普通会话与键盘路径共用该谓词；已寻址子会话保持本分支仅 Queue 的继续执行传输（[可续跑子智能体中断](../feature/2026-08-06-continuable-subagent-interrupt.zh.md)）。主按钮点击走 `ComposerKeyboard.submit(mode)`。仅当这次点击会投递一条普通消息时，标签才标明 Queue 或 Steer：运行中、可 steer、已启用、非空、未认领、且不是将进入命令裁决的 `/` 行。该状态显示 `input.send.queue` 或 `input.send.steer`（zh/en/pt/es）；其余发送席位保持 `input.send`；普通运行中会话在草稿为空或被 owner 阻塞时仍显示停止。Cmd/Ctrl+Enter 仍是相反模式。composer 栏的 inject 面发布 `hooks.busyEnter` 而不再放解析闭包，`resolveSubmitMode` 是 `submission-policy.ts` 中的纯函数。Settings 行标题为「繁忙时的发送行为」，描述 Enter 与发送按钮；`busyEnter` 字段、默认值和 Host schema 不变。

折叠 Think 摘要会去掉首行或最新一行中的每一个 `**`。展开后的 `thinkBody` 文本不变。活动摘要折叠未改。

`session.prompt` 拒绝既无非空白文本也无非文本部分的内容，在 Agent 准入之前以 `bad-request` 作答。仅含图片（以及空白加图片）的提示仍然有效。`session.updateQueue` 对仅含空白文本的编辑以同一错误码作答；非文本队列编辑仍以 `attachment-error` 失败。本分支的提示词协议没有通用文件附件类型，因此此处的「仅文件」即仅图片。

## 备选方案

**发送按钮保持 Queue，只改写 Settings。** composer 仍会在同一设置下为同一草稿提供两条提交路径。

**把模式穿进 `InputActions.submit(mode)`。** 公开的 provide 通道面会让任意会话范围 slot 选择投递模式。栏已经拥有 `ComposerKeyboard.submit(mode)`。

**为可续跑子会话启用 steering，以对齐上游 `dsh-v0.1.5-alpha.1`。** 本分支的继续执行传输仍仅支持 Queue；改动它超出这三处缺陷。

**重写 Think 的活动摘要折叠。** 缺陷是折叠行上的字面量 `**`。扩大折叠会把本次移植与无关的展示工作混在一起。

**为空提示新增专用 RPC 错误码。** ApiProxy 已把语义拒绝映射到 `bad-request`；为一条消息加宽同构错误表没有必要。

## 后果

Settings 中的 Steer 现在会让 Enter 与运行中发送按钮都走 Steer，按钮也会标明该模式。在 Steer 偏好下把按钮当作永远 Queue 出口的用户改为使用 Cmd/Ctrl+Enter。可续跑子会话的发送仍为 Queue 并保持普通标签。折叠 Think 行不再显示粗体标记。仅含空白的 Host 提示与队列编辑会失败关闭；仅含图片的提示仍可准入。

## 验证

`input-bar.client.spec.tsx` 钉住运行中按钮在两种偏好下的标签与投递、实时改标、空闲普通发送、斜杠与已认领命令的普通发送，以及仅附件时的 Queue 命名。`submission-policy.client.spec.ts` 钉住纯解析函数。`enter-behavior-row.client.spec.tsx` 与 settings-chrome ARIA golden 携带新文案。`reasoning-row.client.spec.tsx` 从已结算和流式摘要中去掉 `**`，且不改展开正文。`api-proxy-empty-prompt.spec.ts` 拒绝空白提示与队列编辑，且不把仅含图片的内容判为空。
