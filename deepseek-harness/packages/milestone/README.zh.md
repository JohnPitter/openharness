# milestone/：会话里程碑家族

[English](README.md) | 中文

面向模型的里程碑能力。它是单一**产品**包，因为一个 agent（智能体）会话拥有只追加的记录；不存在可替换的提供方约定。

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`tool-milestone/`](tool-milestone/README.zh.md) | 记录会话里程碑并发布仅含标题的索引。 | （注册到 `ctx.tools`） |

子级 README 负责工具、持久化和渲染约定。
