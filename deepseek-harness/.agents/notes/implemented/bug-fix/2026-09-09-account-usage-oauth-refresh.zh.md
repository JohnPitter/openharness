# Agent Note: 配额探测经由聊天刷新路径解析 OAuth 令牌

Status: implemented

[English](2026-09-09-account-usage-oauth-refresh.md) | 中文

## 问题

`PiAiAdapter.accountUsage()` 过去直接读取存储的 OAuth 凭据中的 `access` 作为探测令牌（`credentials.read(provider)`）。而聊天请求经由 `Models.getAuth()` 解析——它会在锁内刷新过期凭据并持久化轮换结果。当登录得到的访问令牌过期后（Claude Code 与 Codex 的令牌寿命以小时计），限额面板的探测会返回 `usage error (HTTP 401)`，而聊天——以及套餐的真实配额——仍然正常，直到某次聊天请求恰好刷新了存储的令牌对。于是面板随聊天活动在可用与 401 之间摇摆，正是报告的症状。

## 决策

`bearerToken()` 现在走与聊天请求相同的解析路径：在粘贴密钥分支之后调用 `snapshot.models.getAuth(provider)`，并使用返回的 `auth.apiKey`（对这些 OAuth 提供方即刷新后的访问令牌）。当 `getAuth` 找不到凭据时，仍回退到原始的存储读取。`accountUsage()` 还会在 `AUTH` 失败时重新解析令牌并重试恰好一次，以覆盖解析与请求之间发生的轮换（其他进程的并发刷新会写入持久存储）。

## 备选方案

**在 `bearerToken` 中手动刷新（读 `expires`、调用提供方令牌端点）。** 否决：这会复制 pi-ai 的加锁刷新、轮换持久化与各提供方令牌端点，两套实现会随时间漂移。

**不在 `AUTH` 时重试。** 否决：刷新路径无法覆盖解析与探测之间令牌被服务端吊销或轮换的窗口；UI 定时触发的探测用一次“重新解析并重试”即可闭合该窗口。

## 影响

存储凭据过期时，限额探测会执行一次令牌刷新（聊天本就会做的同类往返）而不再以 401 失败。无法解析的凭据仍会如实报告探测错误；粘贴密钥的路由（GLM、Kimi）行为不变。

## 验证

`adapter.spec.ts` 用过期的 Codex 存储凭据钉住刷新路径（探测请求的 `authorization` 头携带刷新后的令牌，存储中保留轮换结果），并用未过期凭据钉住 401 时的单次重试。
