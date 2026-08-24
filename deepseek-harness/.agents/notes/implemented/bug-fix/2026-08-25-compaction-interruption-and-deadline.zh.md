# Agent Note: 压缩中断与有界期限

Status: implemented

[English](2026-08-25-compaction-interruption-and-deadline.md) | 中文

## 问题

持久化的 `session/end-seed` 证明此前会话生命周期中的工作不可能仍在运行，但客户端会让没有匹配结果的 `command/run` 永久保持待处理。提供方的 keepalive 也可能让一次压缩事务无限延长，因为原有 watchdog 只限制空闲读取。

## 决策

conversation assembler 按日志顺序为选择加入的生命周期 Definition 重放 `session/end-seed` 边界。命令 Definition 只在后续边界出现时将未匹配命令变为错误；没有边界时保持待处理，后续 `command/done` 仍然权威。分页窗口之外的边界不会被凭空推断。

压缩在所有摘要与上下文溢出重试之间共用一个五分钟的总体期限。期限独立于 `AbortSignal` 与摘要 promise 竞速，同时中止提供方信号并产生 `COMPACTION_TIMEOUT` 代码的 `LlmError`；手动 `/compact` 允许该代码，同时保留调用方取消优先级。事务仍只写入一个 `compaction/end`，释放维护准入，并清理定时器与监听器。

## 备选方案

**按时间推断孤立命令。** 不予采用：经过的时间不能证明活动命令已经停止，会错误关闭缓慢命令。

**只依赖中止来限制压缩。** 不予采用：提供方可能忽略 `AbortSignal`，让调用方和维护锁无限等待。

## 影响

恢复的会话会显示确定性的中断命令和压缩结果，而不是永久运行的行。忽略取消的提供方可能在后台继续，但不能让压缩调用方或持久化括号超过五分钟。

## 测试

聚焦的 assembler、trajectory、compaction-basic、manual-compaction 与 command-compact 测试覆盖边界重放、活动待处理保护、结果保留、永不结束的摘要器、共享重试期限、稳定超时码与取消优先级。
