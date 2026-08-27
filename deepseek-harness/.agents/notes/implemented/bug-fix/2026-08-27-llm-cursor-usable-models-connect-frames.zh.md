# Agent Note: Cursor GetUsableModels 使用 Connect 帧与 model_names

Status: implemented

[English](2026-08-27-llm-cursor-usable-models-connect-frames.md) | 中文

## 问题

在 [clientVersion 钉扎](2026-08-26-llm-cursor-client-version-rejected.zh.md) 之后，`llm.discoverModels` 仍返回 ok 且只有一个模型（`composer-2.5`）。那是配置回退，不是账户目录。`listModels` 仅在单个数据帧等于整个 HTTP/2 载荷时才解开 Connect 正文；数据帧加 trailer（与 `StreamUnifiedChatWithTools` 相同的分帧）被当作原始字节交给 protobuf，解码为空。`lite.proto` 里的 `AvailableModelsResponse` 也漏掉了 3.17.8 dump 的 `model_names = 1`，因此只有名称的一元响应解码为零行。

## 决策

`payloadFromConnectBody` 解开 `parseFrames` 完整消费的缓冲区：gzip 数据（`flags = 1`）解压，trailer（`flags = 2`）交给 `decodeTrailer`，数据载荷拼接。未被完整分帧的正文仍按 protobuf 原样处理。`GetUsableModels` 使用与聊天流相同的 `application/connect+proto` 头，并发送 `frame(encodeModelsRequest())`。

`AvailableModelsResponse` 声明 `repeated string model_names = 1`。`decodeModelsResponse` 先列出 `AvailableModel` 行，再追加尚无对应行的 `model_names` id。空解码、HTTP 失败、超时或带 `error` 的 trailer 仍返回配置目录。

2.5 秒列举上限与 Composer 2.5 回退仍按 [数组目录](../architecture/2026-08-26-llm-cursor-models-array-catalog.zh.md) 所述。

## 考虑过的替代方案

**把猜测的 Grok / GPT / Claude id 写入 `DEFAULT_MODELS`。** 否决：错误 id 会在请求时失败；实时一元响应才是该账户可用集合。

**继续使用 `application/proto` 和无帧请求。** 否决：同一主机上的聊天 RPC 已使用 Connect；列举必须用该分帧，否则 data+trailer 正文会被当成 protobuf。

**把每个列举缓冲区都当 protobuf，并忽略 trailer。** 否决：覆盖完整的 data+trailer 正文会解码为空并回退到 Composer 2.5。

## 后果

后端接受的钉扎加上成功的一元响应会把 Grok 及其他可用 id 发布到选择器。被拒绝的钉扎仍在 2.5 秒上限内通过 `decodeTrailer` 失败并回退。测试使用的无帧 fixture 正文仍然有效。

## Testing

`adapter.spec.ts` 钉扎 Connect 请求头与分帧一元响应、无行时的 `model_names`、gzip 数据、无帧正文、空列表以及 trailer 错误。`protobuf.spec.ts` 钉扎名称/行合并与 `payloadFromConnectBody`。
