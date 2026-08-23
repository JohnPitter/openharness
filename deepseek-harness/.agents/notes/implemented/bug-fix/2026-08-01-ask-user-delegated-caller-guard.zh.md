# Agent Note: 拒绝运行时中归属于其他 agent 的 subagent 向人类发起交互

Status: implemented

[English](2026-08-01-ask-user-delegated-caller-guard.md) | 中文

## 问题

一次性 subagent 调用 `ask_user_question` 时可能无限阻塞。该调用会等待人类回答，但子级没有由自身独立拥有的人类交互通道，因此子级无法完成，等待其完成的父级也会随之停滞。

持久化会话谱系无法判断应答者是否存在。子会话之后可能恢复为新的顶层运行时根，而运行时中归属于其他 agent（智能体）的存活子级，其持久化委托深度却可能为零或缺失。共享 seam 上的错误指引还必须适用于每个消费方：`exit_plan_mode` 会使用 `ctx.userQuestions.ask()`，但不会调用 `ask_user_question`。

## 决策

如果存在 `AskUserQuestionRequest.agent`，`UserQuestionService.ask()` 会通过 `ctx.agents` 验证该 agent 就是注册表中的存活实例。人类 UI 等待只发生在用户正在回答的运行时根上。被委托的调用方绝不会创建该等待：[subagent 选项自动选定](../feature/2026-08-23-subagent-ask-user-auto-recommended.zh.md) 返回推荐（否则第一项）选项，没有选项的批次仍以 `DELEGATED_CALLER` 失败。缺失注册表或传入仅 id 相同的陈旧对象时，以 `CALLER_NOT_LIVE` 失败。该检查位于现有的已中止和空批次守卫之后、提供方分派之前。

以运行时所有权为主要权限依据。continuable 子级仍可能是注册表根（从没有 initiator 的 manager 作用域创建）；在 `origin` 为 `subagent` 且持久化父会话仍存活时，它们仍视为被委托。携带谱系的会话在无所有者且没有存活父级的情况下恢复时就是运行时根，可以提问。不带 agent 的程序化调用继续沿用现有提供方路径。

共享失败文本与具体消费方无关，并给出可执行指引：子级把尚未解决的问题或决策写入最终结果。委托约定本就会把该结果传给父级，父级可据此决定是否询问人类。服务和子级都不会宣称存在实际上并不存在的向上消息传递或回答转发能力。

该安全边界与浏览器的 composer 选举相互独立。提议的[语义 composer 阶段](../../proposed/architecture/2026-08-08-semantic-composer-chain-phases.zh.md)解决已有待处理交互与只读 subagent 界面的排序方式；它不会削弱此运行时守卫。

## 备选方案

**使用 `session.header.delegationDepth > 0`。** 不予采用：持久化谱系会在恢复后继续存在，却不能证明当前进程内所有者。该方案会拒绝有效的已恢复根，也可能放行持久化 header 不完整的存活子级。

**仅在 `dsh-tool-ask-user` 内拒绝。** 不予采用：`exit_plan_mode` 与直接调用方共用 `ctx.userQuestions.ask()`。服务是所有人机交互消费方共同经过的最窄操作边界。

**让子级向上委托或等待转发。** 不予采用：一次性委托没有公开从子级向父级请求的通道，也没有回答转发协议。唯一有保证的返回路径是子级的最终结果。

**依赖浏览器的 composer 修复。** 不予采用：呈现方式无法凭空产生由所有者负责的人类通道，非浏览器部署仍然需要该调用能够终止。

## 影响

运行时中归属于其他 agent 的子级，以及父会话仍存活的 continuable 子级，都不会等待 UI。带选项的问题通过自动选定解决；没有选项的问题以稳定的结构化错误快速失败。没有存活父级的确切存活根，以及不带 agent 的程序化调用，仍有资格获得人类回答，包括带有历史子级谱系的已恢复会话。`ask_user_question` 与 `exit_plan_mode` 共用此 seam。

## 测试

服务测试覆盖持久化深度为零的存活子级（无选项的 `DELEGATED_CALLER` 与带选项的自动选定）、带存活父级的 continuable subagent 根、深度为一的已恢复运行时根、缺失注册表、仅 id 相同的陈旧对象，以及每次拒绝或自动选定都不调用提供方。工具与 plan-mode 测试证明无选项消费方会呈现中性的 `DELEGATED_CALLER` 结果。无密钥组装快照委托一个尝试无选项 `ask_user_question` 的子级，固定其错误工具结果和最终交接，并证明父级可以完成，而不是一直等待回答。
