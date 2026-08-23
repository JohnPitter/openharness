# @deepseek-ai/dsh-tool-milestone

[English](README.md) | 中文

面向模型的 `milestone_write` 工具：只追加的会话索引，记录发现、决策与修复。

## 功能

在 `ctx.tools` 上注册一个工具 `milestone_write({ title, body, anchorSeq? })`。每次调用都会向调用 agent 的会话日志追加一条 `milestone/write` 事件。回放是只追加：后写不会替换先写。非 agent 调用方没有所属会话，因此会被拒绝。

当调用会话有在线父级（`header.parentSession`）时，同一身份会以 `origin: 'worker'` 和 `childSessionId` 镜像到该父级。父级缺失不会让子级写入失败。

模型可见的索引是仅含标题的运行时上下文快照 `milestone:index`（`ctx.systemPrompt.context`）。空会话贡献 `''`；该通道仅在折叠后的标题变化时重写。该列表不是不断增长的系统提示词 section。

## 验证

`execute` 会裁剪 `title` 和 `body`，拒绝空文本，并将标题限制为 160 个字符、正文限制为 4000 个字符。若提供 `anchorSeq`，必须是非负整数。

## 渲染

成功返回 `{ milestoneId, title }`；Native 渲染器为 `Wrote milestone: <title>`。UI 订阅 `milestone/write`，自行渲染芯片、轨道与跳转。

## 导出形状

函数／命名空间插件：导出 `name` / `inject` / `apply`，不提供默认导出。意外的 `export default` 会被 Loader 的 `unwrapExports` 折叠为默认导出，并导致 `inject` 丢失（参见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.zh.md)）。

## 模型体验

### 工具 schema

#### 模型看到什么

模型会看到生成的 [`milestone_write` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-milestone)。

#### Token 影响

在工具可见的每次请求上产生固定的 schema 成本。

#### KV Cache 影响

在定义与可见性不变时前缀稳定。插件生命周期或作用域限制可能使该 schema 起的复用失效。

### 工具调用历史与结果

#### 模型看到什么

每条 assistant 工具调用都会保留 `title`、`body` 以及可选的 `anchorSeq`。成功恰好返回 `Wrote milestone: <title>`。稳定失败为 ``Error: invalid milestone: `title` must be a non-empty string``、``Error: invalid milestone: `body` must be a non-empty string``、``Error: invalid milestone: `title` must be at most 160 characters``、``Error: invalid milestone: `body` must be at most 4000 characters``、``Error: invalid milestone: `anchorSeq` must be a non-negative integer``，以及 `Error: milestone_write requires an owning agent session`。`milestone/write` 会话事件是 UI 与回放状态，不是第二条模型消息。标题也会出现在 `milestone:index` 运行时上下文快照中。

#### Token 影响

调用参数随记录正文增长。结果本身短小且形状固定。运行时上下文索引随标题数量增长，不随正文增长。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使已有 KV-cache 条目失效。运行时上下文快照仅在折叠后的标题列表变化时重写。

### 运行时上下文

#### 模型看到什么

至少有一条里程碑时：

```markdown
Milestones recorded in this session:
- <title>
```

否则该贡献为空并被省略。

#### Token 影响

固定标题之后，每条已记录标题占一行。

#### KV Cache 影响

该快照位于保留历史之后。标题列表变化只重写该快照，不重写系统提示词前缀。

## 已知限制与推迟的工作

- **不可编辑或删除** — 记录只追加；更正是后续一条里程碑。
- **父级镜像需要在线父级** — 离线父级会保留子级写入，根会话轨道在该父级重新在线前保持不变。
- **配额策略不在本包范围** — 按请求还是按 token 计费的辅助调用是另一项决策。
