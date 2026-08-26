import protobuf from 'protobufjs'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { LlmError } from '@deepseek-ai/dsh-llm'

const protoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'proto', 'lite.proto')
const source = readFileSync(protoPath, 'utf8').replace(/^import "google\/protobuf\/timestamp\.proto";\r?\n/m, '')
const root = protobuf.parse(source, { keepCase: false }).root
const requestType = root.lookupType('aiserver.v1.StreamUnifiedChatRequestWithTools')
const responseType = root.lookupType('aiserver.v1.StreamUnifiedChatResponseWithTools')
const modelsRequestType = root.lookupType('aiserver.v1.AvailableModelsRequest')
const modelsResponseType = root.lookupType('aiserver.v1.AvailableModelsResponse')

type RequestOptions = {
  model: string
  conversation: Array<{ text: string; type: number }>
  headers: Array<{ id: string; type: number }>
  conversationId: string
  explicitContext?: string
  tools?: Array<{ name: string; serverName: string; description: string; parameters: string }>
}

/** Encode a real Cursor request using the reflection metadata from lite.proto. */
export function encodeRequest(options: RequestOptions): Uint8Array {
  const stream = {
    streamUnifiedChatRequest: {
      conversation: options.conversation,
      fullConversationHeadersOnly: options.headers.map(header => ({ bubbleId: header.id, type: header.type })),
      ...(options.explicitContext === undefined ? {} : { explicitContext: { context: options.explicitContext } }),
      modelDetails: { modelName: options.model },
      isChat: options.tools === undefined,
      conversationId: options.conversationId,
      isAgentic: options.tools !== undefined,
      unifiedMode: options.tools === undefined ? 1 : 2,
      ...(options.tools === undefined ? { shouldDisableTools: true } : {}),
      mcpTools: options.tools?.map(tool => ({
        name: tool.name,
        serverName: tool.serverName,
        description: tool.description,
        parameters: tool.parameters,
      })) ?? [],
    },
  }
  const message = requestType.fromObject(stream)
  requestType.verify(message)
  return requestType.encode(message).finish()
}

/** Encode the model-picker request selected from the dump's complete AvailableModels schema. */
export function encodeModelsRequest(): Uint8Array {
  const message = modelsRequestType.fromObject({
    isNightly: false,
    includeLongContextModels: true,
    excludeMaxNamedModels: false,
    additionalModelNames: [],
  })
  modelsRequestType.verify(message)
  return modelsRequestType.encode(message).finish()
}

/** Encode a model-picker fixture with protobufjs reflection. */
export function encodeModelsResponse(
  models: Array<{ name: string; clientDisplayName?: string; serverModelName?: string; contextTokenLimit?: number }>,
): Uint8Array {
  const message = modelsResponseType.fromObject({ models })
  modelsResponseType.verify(message)
  return modelsResponseType.encode(message).finish()
}

/** Decode the model-picker response selected from the dump's complete AvailableModels schema. */
export function decodeModelsResponse(data: Uint8Array): Array<{ id: string; name: string; contextWindow?: number }> {
  const decoded = modelsResponseType.decode(data)
  const value = modelsResponseType.toObject(decoded, { longs: String, enums: String, defaults: false }) as Record<string, unknown>
  const models = Array.isArray(value.models) ? value.models as Array<Record<string, unknown>> : []
  return models.map((model) => {
    const rawId = model.serverModelName ?? model.name
    const id = typeof rawId === 'string' ? rawId : ''
    const rawName = model.clientDisplayName ?? model.name
    const name = typeof rawName === 'string' ? rawName : id
    const contextWindow = typeof model.contextTokenLimit === 'number' ? model.contextTokenLimit : undefined
    return { id, name, ...(contextWindow === undefined ? {} : { contextWindow }) }
  }).filter(model => model.id.length > 0)
}

export type Decoded = {
  text?: string
  thinking?: string
  usage?: { outputTokens: number }
  citations?: Array<{ title: string; url: string; chunk: string }>
  tool?: { id: string; name: string; args: string }
}

/** Encode a stream response fixture with protobufjs reflection. */
export function encodeResponseFixture(response: { text?: string; debuggingOnlyTokenCount?: number }): Uint8Array {
  const message = responseType.fromObject({ streamUnifiedChatResponse: response })
  responseType.verify(message)
  return responseType.encode(message).finish()
}

/** Decode one framed response payload using the same protobuf schema as encoding. */
export function decodeResponse(data: Uint8Array): Decoded | null {
  const decoded = responseType.decode(data) as protobuf.Message & Record<string, unknown>
  const value = responseType.toObject(decoded, { longs: String, enums: String, defaults: false }) as Record<string, unknown>
  const response = value.streamUnifiedChatResponse as Record<string, unknown> | undefined
  if (response !== undefined) {
    const result: Decoded = {}
    if (typeof response.text === 'string' && response.text.length > 0) result.text = response.text
    const thinking = response.thinking as Record<string, unknown> | undefined
    if (thinking && typeof thinking.text === 'string' && thinking.text.length > 0) result.thinking = thinking.text
    if (typeof response.debuggingOnlyTokenCount === 'number') result.usage = { outputTokens: response.debuggingOnlyTokenCount }
    const citation = response.webCitation as Record<string, unknown> | undefined
    const refs = citation?.references
    if (Array.isArray(refs)) {
      result.citations = refs.map((ref) => {
        const item = ref as Record<string, unknown>
        const title = typeof item.title === 'string' ? item.title : ''
        const url = typeof item.url === 'string' ? item.url : ''
        const chunk = typeof item.chunk === 'string' ? item.chunk : ''
        return { title, url, chunk }
      }).filter(ref => ref.url.length > 0)
    }
    if (result.text || result.thinking || result.usage || result.citations?.length) return result
  }
  const call = value.clientSideToolV2Call as Record<string, unknown> | undefined
  if (call) {
    const id = typeof call.toolCallId === 'string' ? call.toolCallId : crypto.randomUUID()
    const name = typeof call.name === 'string' ? call.name : ''
    const args = typeof call.rawArgs === 'string' ? call.rawArgs : '{}'
    return { tool: { id, name, args } }
  }
  return null
}

export function frame(data: Uint8Array, flags = 0): Uint8Array {
  const out = new Uint8Array(5 + data.length)
  out[0] = flags
  new DataView(out.buffer).setUint32(1, data.length)
  out.set(data, 5)
  return out
}

/**
 * Encode a Connect end-of-stream trailer frame (flags `0x02`), for test
 * fixtures. Every real stream ends with one; `error` omitted encodes a clean
 * `{}` trailer (normal end), matching the shape {@link decodeTrailer} expects.
 * @param error - the Connect error payload to encode, when simulating a failed stream.
 */
export function trailerFrame(error?: { code: string; message: string; details?: unknown[] }): Uint8Array {
  const json = JSON.stringify(error === undefined ? {} : { error })
  return frame(new TextEncoder().encode(json), 2)
}

export function parseFrames(data: Uint8Array): Array<{ flags: number; payload: Uint8Array; size: number }> {
  const out: Array<{ flags: number; payload: Uint8Array; size: number }> = []
  let offset = 0
  while (offset + 5 <= data.length) {
    const size = new DataView(data.buffer, data.byteOffset + offset + 1).getUint32(0)
    if (offset + 5 + size > data.length) break
    out.push({ flags: data[offset] ?? 0, payload: data.slice(offset + 5, offset + 5 + size), size: size + 5 })
    offset += size + 5
  }
  return out
}

export function frames(data: Uint8Array): Uint8Array[] {
  return parseFrames(data).map(item => item.payload)
}

export function decodePayload(flags: number, payload: Uint8Array): Uint8Array {
  if (flags === 0) return payload
  if (flags === 1) return gunzipSync(payload)
  throw new LlmError(`Unknown Connect frame flags: 0x${flags.toString(16)}`, 'PROTOCOL')
}

/** One `aiserver.v1.ErrorDetails` entry from a Connect trailer's `error.details`. */
interface ConnectErrorDetail {
  debug?: { details?: { detail?: unknown } }
}

/** The JSON payload of a Connect end-of-stream trailer (frame flags `0x02`) carrying a failure. */
interface ConnectErrorTrailer {
  error: {
    code?: unknown
    message?: unknown
    details?: unknown
  }
}

function isConnectErrorTrailer(value: unknown): value is ConnectErrorTrailer {
  return typeof value === 'object' && value !== null && 'error' in value
    && typeof value.error === 'object' && value.error !== null
}

/** Maps the Connect protocol's standard error codes to this adapter's stable {@link LlmError} codes. */
function mapConnectErrorCode(code: unknown): string {
  if (code === 'unauthenticated' || code === 'permission_denied') return 'AUTH'
  if (code === 'resource_exhausted') return 'RATE_LIMIT'
  return 'PROVIDER_ERROR'
}

/**
 * The human-readable detail message nested in the first `ErrorDetails` entry
 * (`details[].debug.details.detail`), when present. Cursor's backend carries
 * its user-facing explanation here; `error.message` alone is often a generic
 * placeholder (e.g. `"Error"`).
 */
function firstDetailMessage(details: unknown): string | undefined {
  if (!Array.isArray(details)) return undefined
  for (const entry of details as ConnectErrorDetail[]) {
    const detail = entry.debug?.details?.detail
    if (typeof detail === 'string' && detail.length > 0) return detail
  }
  return undefined
}

/**
 * Decode a Connect end-of-stream trailer frame (flags `0x02`). Unlike data
 * frames, the trailer payload is always JSON, never protobuf — Connect's
 * streaming protocol terminates every stream with one such frame, carrying
 * either `{}`/metadata (normal end) or `{"error": {...}}` (failure).
 * @param payload - the raw trailer frame payload (never gzip-compressed).
 * @throws LlmError when the trailer carries an `error`: code `AUTH` for
 *   `unauthenticated`/`permission_denied`, `RATE_LIMIT` for
 *   `resource_exhausted`, `PROVIDER_ERROR` otherwise. The message combines
 *   `error.message` with the nested human-readable detail when present; the
 *   server's original code is carried as `cause`.
 */
export function decodeTrailer(payload: Uint8Array): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload).toString('utf8'))
  } catch (error) {
    throw new LlmError('Cursor stream trailer is not valid JSON', 'PROTOCOL', { cause: error })
  }
  if (!isConnectErrorTrailer(parsed)) return
  const { error } = parsed
  const serverMessage = typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Cursor stream error'
  const humanDetail = firstDetailMessage(error.details)
  const message = humanDetail === undefined ? serverMessage : `${serverMessage}: ${humanDetail}`
  throw new LlmError(message, mapConnectErrorCode(error.code), {
    cause: new Error(`Cursor error code: ${typeof error.code === 'string' ? error.code : 'unknown'}`),
  })
}
