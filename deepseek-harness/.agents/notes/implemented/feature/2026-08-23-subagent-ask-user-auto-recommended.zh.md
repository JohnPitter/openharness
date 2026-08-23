# Agent Note: Subagent 的 ask-user 自动选定推荐选项

Status: implemented

[English](2026-08-23-subagent-ask-user-auto-recommended.md) | 中文

## 问题

被委托的 agent 调用带可选选项的 `ask_user_question` 时，仍需要人类回答才能继续。一次性、归属于另一个 agent 的子级过去会以 `DELEGATED_CALLER` 失败。从 subagent manager 作用域创建的 continuable 子级是注册表根，因此会通过所有权守卫，并在绑定到子会话的问题上等待。父级对话不会接管该 composer，于是子级和等待它的父级都会停滞。模型已经用选项标签上的 `(Recommended)` 标出首选。

无选项时的快速失败仍由[委托调用方守卫](../bug-fix/2026-08-01-ask-user-delegated-caller-guard.zh.md)负责。

## 决策

`UserQuestionService.ask()` 会从选项标签为被委托的调用方自动作答，并且绝不分派 UI 提供方。被委托的调用方是归属于另一个存活 agent 的存活 agent，或会话 header 为 `origin: 'subagent'` 且 `parentSession` 仍是存活 agent 的注册表根。对每个问题：多选题选定所有 `(Recommended)` / `（推荐）` 标签；单选题选定第一个推荐标签（否则选第一项）。批次中任一没有选项的条目仍抛出 `DELEGATED_CALLER`。意图校验仍然先运行。

没有存活父级的已恢复带谱系会话仍是面向人类的根。不带 agent 的程序化调用仍走提供方。

## 备选方案

**对被委托的每次调用都保留 `DELEGATED_CALLER`。** 不予采用：带选项的问题已经标出推荐选择，拒绝它们会让子级重试或拖住父级，而不是继续任务。

**对每个会话都自动选定，包括用户的根。** 不予采用：根上的问题仍由人类在 composer 中回答。

**单独使用 `delegationDepth > 0`。** 不予采用：原因与委托调用方守卫相同，持久化深度会在用户稍后把子会话当作根打开时自动作答。

**在父级 initiator 下注册 continuable 子级，使它们不再是根。** 暂缓：该所有权变更的生命周期影响面更大；自动选定加上存活父级的 origin 检查即可解除等待。

## 影响

Subagent 的选项问题无需 composer 接管即可完成。选定的标签是模型自己的选项字符串，因此工具结果仍使用现有 JSON 词汇。没有选项的子级问题仍快速失败。根上的 `ask_user_question` 不变。

## 测试

服务测试覆盖被拥有子级的推荐与第一项选定、带存活父级的 continuable subagent 根、无选项的 `DELEGATED_CALLER`，以及仍到达提供方的已恢复根。工具测试覆盖经 `ask_user_question` execute 的推荐自动选定。辅助函数测试固定英文和中文后缀以及多选推荐标签。
