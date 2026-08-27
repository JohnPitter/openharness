# Agent Note: Cursor GetUsableModels uses Connect frames and model_names

Status: implemented

English | [中文](2026-08-27-llm-cursor-usable-models-connect-frames.zh.md)

## Problem

After the [clientVersion pin](2026-08-26-llm-cursor-client-version-rejected.md), `llm.discoverModels` still returned ok with one model (`composer-2.5`). That is the configured fallback, not the account catalog. `listModels` only unwrapped a Connect body when a single data frame was the entire HTTP/2 payload; a data frame plus trailer (the same framing as `StreamUnifiedChatWithTools`) was fed to protobuf as raw bytes and decoded empty. `AvailableModelsResponse` in `lite.proto` also omitted `model_names = 1` from the 3.17.8 dump, so a names-only unary decoded to no rows.

## Decision

`payloadFromConnectBody` unwraps a buffer that `parseFrames` consumes completely: gzip data (`flags = 1`) is inflated, a trailer (`flags = 2`) goes through `decodeTrailer`, and data payloads are concatenated. A body that is not fully framed is protobuf as-is. `GetUsableModels` uses the same `application/connect+proto` headers as the chat stream and sends `frame(encodeModelsRequest())`.

`AvailableModelsResponse` declares `repeated string model_names = 1`. `decodeModelsResponse` lists `AvailableModel` rows first, then appends `model_names` ids that no row already carries. Empty decode, HTTP failure, timeout, or a trailer `error` still return the configured catalog.

The 2.5s listing bound and Composer 2.5 fallback stay as in [the array catalog](../architecture/2026-08-26-llm-cursor-models-array-catalog.md).

## Alternatives considered

**Seed `DEFAULT_MODELS` with guessed Grok / GPT / Claude ids.** Rejected: a wrong id fails at request time; the live unary is the account's usable set.

**Keep `application/proto` and an unframed request.** Rejected: the same host already speaks Connect on the chat RPC; listing must use that framing so a data+trailer body is not treated as protobuf.

**Treat every listing buffer as protobuf and ignore trailers.** Rejected: a covering data+trailer body decodes empty and falls back to Composer 2.5.

## Consequences

A pin the backend accepts plus a successful unary publishes Grok and the other usable ids in the picker. A rejected pin still fails inside the 2.5s bound via `decodeTrailer` and falls back. Unframed fixture bodies used by tests keep working.

## Testing

`adapter.spec.ts` pins Connect request headers and a framed unary, `model_names` without rows, gzip data, an unframed body, an empty listing, and a trailer error. `protobuf.spec.ts` pins name/row union and `payloadFromConnectBody`.
