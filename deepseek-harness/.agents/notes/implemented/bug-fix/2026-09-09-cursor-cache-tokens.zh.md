# Agent Note: Cursor 的轮次上报缓存令牌桶

Status: implemented

[English](2026-09-09-cursor-cache-tokens.md) | 中文

## 问题

agent.v1 解码器过去只从 `turn_ended` 读取 `input_tokens`/`output_tokens`，因此每个 Cursor 轮次都以 `cacheReadTokens: 0` 进入令牌计量，侧栏徽章的缓存命中率无论服务端行为如何都停在 0%。

## 决策

`decodeServerFrame` 现在映射稀疏 proto 中已声明的 `TurnEndedUpdate` 字段（`cache_write_tokens = 3`、`cache_read_tokens = 4`），adapter 在字段存在时把两者带入 `usage` chunk，遵循 harness 的互斥桶约定。对账号的实测表明服务端确实会填充这些字段（每轮都有 `cache_write`），而 composer-2.5 在不同 `Run` 调用之间 `cache_read` 保持为 0——Cursor 不在 run 之间复用提示词缓存——因此即便显示 0%，命中率也是真实读数。

## 备选方案

**不解码桶字段、直接对 Cursor 隐藏缓存读数。** 否决：线上协议披露了真实数值，今天的 cache write 已非零，且账号合约并未排除其他模型或未来服务端行为产生 cache read 的可能。

## 影响

Cursor 会话的 token 总量现在计入 cache write；徽章的缓存命中率反映服务端上报的 read 值。计费行为不变：Cursor 路由仍按请求计量。

## 验证

`agent-proto.spec.ts` 对缓存字段做编解码往返；`adapter.spec.ts` 钉住 `usage` chunk 携带两个桶。一次双轮实测确认服务端发送 `cacheWriteTokens`，且各 run 之间 `cacheReadTokens` 为 0。
