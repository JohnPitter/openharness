# Agent Note: J-space 关闭时对模型隐藏该 skill

Status: implemented

[English](2026-08-23-jspace-off-hides-from-model.md) | 中文

## 问题

composer 上的 J-space 开关关闭时，只清空了 `jspace:protocol` 系统提示词段。打包的 `j-space` skill 仍可被模型调用，其目录描述几乎匹配所有编码任务，因此 `skill` 工具目录仍会让模型加载它。模型随后在每一步用 `{name:"j-space"}` 调用 `skill`。skill 正文要求加载模块；它们又以相同参数再次调用 `skill`。`repeat-tool-reminder` 在连续 3/5/8 次相同调用时注入提醒，并不拦截。Think 记录显示模型试图停止，而目录和协议仍在重新指示加载。

## 决策

**关闭时对模型隐藏 `j-space`。** `ui-jspace.enabled` 为 false 时，`ui-model-selection` 调用 `ctx.skills.hideFromModel('j-space')`。`list`/`snapshot`/`get` 报告 `modelInvocable: false`；`skill` 工具和会话目录不再列出该名称；`/j-space` 仍可供用户调用。会话中途关闭时，下一步 pre-step 会重发替换目录。

**协议不再让任何人重新加载。** 打开时只做 fast/full/loop 分类，最多允许一次 `skill` 加载，并向工人说明 pass，而不是指示重新加载。

**仍留在 surface 上的成功 `skill` 结果不能再次加载。** `dsh-tool-skill` 在第一次成功结果仍可见时拒绝对该名称的第二次调用。压缩若隐藏了该结果，则允许重新加载。

打包的 `j-space` 描述不再匹配普通一眼可完成的编辑；skill 正文要求用 Read 从 resource base 加载模块，而不是再次调用 `skill`。

## 备选方案

**在打包 skill 文件上写 `disable-model-invocation: true`。** 不予采用：打开时仍需要一次性模型加载，静态 frontmatter 无法跟随实时开关。

**让 `repeat-tool-reminder` 否决而不是建议。** 不予采用：正当的相同重试（权限被拒、不稳定的 fetch）必须保持畅通；重复加载由 skill 加载器拒绝。

**关闭时仍只改提示词。** 不予采用：协议去掉之后，仍是目录指令在维持循环。

## 影响

已有会话在关闭后（或包含本变更的运行时之后）的下一步会生效。工人不再收到父级“加载 j-space”的指示。Workflow 规划者即使在 On 时也不收到协议；该前缀削减由[无法使用的构建上下文 note](../simplification/2026-08-27-workflow-planner-omits-unusable-context.zh.md)负责。用户 `/j-space` 仍会注入正文。

## 测试

`skill.spec.ts` 覆盖隐藏计数、非法名称，以及 `get()` 仍返回正文。`host.client.spec.ts` 对已注册的 `j-space` 切换关/开。`tool-skill.spec.ts` 覆盖隐藏后的目录省略、加载器拒绝、结果仍可见时的 already-loaded 拒绝，以及先前参数 JSON 畸形的情况。
