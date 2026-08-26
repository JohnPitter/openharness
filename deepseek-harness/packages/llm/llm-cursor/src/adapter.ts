import { createHash } from 'node:crypto'
import { release } from 'node:os'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  decodePayload,
  decodeResponse,
  decodeModelsResponse,
  decodeTrailer,
  encodeModelsRequest,
  encodeRequest,
  frame,
  parseFrames,
} from './protobuf.ts'
import { createHttp2Transport } from './transport.ts'
import type { CursorHttp2Transport } from './transport.ts'

export type GhostMode = true | false | 'implicit-false'

export interface CursorTransportConfig {
  baseURL: string
  clientVersion: string
  timezone: string
  machineId: string
  macMachineId?: string
  ghostMode: GhostMode
  /** Milliseconds to wait for response headers before failing with `LlmError('TIMEOUT')`; defaults to 120000 (120s). */
  timeoutMs?: number
}

const endpoint = '/aiserver.v1.ChatService/StreamUnifiedChatWithTools'
const modelsEndpoint = '/aiserver.v1.AiService/GetUsableModels'

function textOf(message: GenerateOptions['messages'][number]): string {
  return message.content.map((block) => {
    if ('text' in block) return block.text
    if (block.type === 'tool-call') return block.arguments
    if (block.type === 'tool-result') return block.content.map(x => 'text' in x ? x.text : '').join('')
    return ''
  }).join('')
}

function base64urlNoPad(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Implements Cursor's timestamp prefix checksum for a request. */
export function checksum(machineId: string, macMachineId: string | undefined, nowMs: number): string {
  const c = BigInt(Math.floor(nowMs / 1e6))
  const raw = new Uint8Array([
    Number((c >> 40n) & 0xffn),
    Number((c >> 32n) & 0xffn),
    Number((c >> 24n) & 0xffn),
    Number((c >> 16n) & 0xffn),
    Number((c >> 8n) & 0xffn),
    Number(c & 0xffn),
  ])
  let previous = 165
  for (let i = 0; i < raw.length; i++) {
    const current = raw[i] ?? 0
    const obfuscated = (current ^ previous) + (i % 256)
    raw[i] = obfuscated
    previous = obfuscated
  }
  return base64urlNoPad(raw) + machineId + (macMachineId ? `/${macMachineId}` : '')
}

/** Derives a stable, non-secret identity for hosts without configured identity. */
export function defaultMachineId(): string {
  const user = process.env.USERNAME ?? process.env.USER ?? 'unknown'
  const host = process.env.COMPUTERNAME ?? 'unknown'
  return createHash('sha256').update(`${process.platform}:${process.arch}:${user}:${host}`).digest('hex')
}

function serverName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '') || 'tool'
}

/** `zone` unchanged when `Intl.DateTimeFormat` accepts it as a timezone, else `undefined`. */
function validTimezone(zone: string): string | undefined {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

/** Concatenate an async byte-chunk stream into one buffer. */
async function collectBody(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of body) {
    chunks.push(chunk)
    total += chunk.length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** Native Connect/protobuf Cursor adapter, transported over HTTP/2 (required by `api2.cursor.sh`'s ALPN). */
export class CursorAdapter extends LlmAdapter {
  private readonly sessionId = crypto.randomUUID()
  private readonly transport: CursorHttp2Transport
  private readonly ownsTransport: boolean

  /**
   * @param resolveKey - resolves the current bearer access token.
   * @param models - resolves the configured provider→model-name catalog fallback.
   * @param config - transport origin, client identity headers, and timeout.
   * @param transport - inject a fake transport for tests; when omitted, an
   *   HTTP/2 session transport is created and owned by this instance (closed
   *   on {@link dispose}).
   */
  constructor(
    private readonly resolveKey: () => Promise<string>,
    private readonly models: () => Record<string, string>,
    private readonly config: CursorTransportConfig = {
      baseURL: 'https://api2.cursor.sh',
      clientVersion: '3.17.19',
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      machineId: defaultMachineId(),
      ghostMode: false,
    },
    transport?: CursorHttp2Transport,
  ) {
    super()
    this.ownsTransport = transport === undefined
    this.transport = transport ?? createHttp2Transport({
      baseURL: config.baseURL,
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    })
  }

  /** Close the owned HTTP/2 session. A no-op when a transport was injected (the caller owns it). Idempotent. */
  dispose(): void {
    if (this.ownsTransport) this.transport.close()
  }

  override providerInfo(provider: string) {
    return { id: provider, name: 'Cursor' }
  }

  private headers(key: string): Record<string, string> {
    const requestId = crypto.randomUUID()
    const timezone = validTimezone(this.config.timezone)
    return {
      authorization: `Bearer ${key}`,
      'content-type': 'application/connect+proto',
      accept: 'application/connect+proto',
      'connect-protocol-version': '1',
      'user-agent': 'connect-es',
      'x-cursor-client-version': this.config.clientVersion,
      'x-cursor-checksum': checksum(this.config.machineId, this.config.macMachineId, Date.now()),
      ...(timezone === undefined ? {} : { 'x-cursor-timezone': timezone }),
      'x-cursor-client-type': 'ide',
      'x-cursor-client-layout': 'editor',
      'x-cursor-client-device-type': 'desktop',
      'x-cursor-client-os': process.platform,
      'x-cursor-client-os-version': release(),
      'x-cursor-client-arch': process.arch,
      'x-new-onboarding-completed': 'false',
      'x-request-id': requestId,
      'x-amzn-trace-id': `Root=${requestId}`,
      'x-session-id': this.sessionId,
      'x-ghost-mode': String(this.config.ghostMode),
    }
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider !== 'cursor') return []
    try {
      const key = await this.resolveKey()
      const response = await this.transport.request({
        path: modelsEndpoint,
        headers: { ...this.headers(key), 'content-type': 'application/proto', accept: 'application/proto' },
        body: new Uint8Array(encodeModelsRequest()),
      })
      const bytes = await collectBody(response.body)
      if (response.status !== 200) throw new Error(`Cursor HTTP ${response.status}`)
      const packets = parseFrames(bytes)
      const first = packets[0]
      const payload = packets.length === 1 && first !== undefined && first.size === bytes.length
        ? decodePayload(first.flags, first.payload)
        : bytes
      return decodeModelsResponse(payload).map(model => ({ provider: 'cursor', id: model.id, name: model.name }))
    } catch (error) {
      console.warn('Cursor listModels RPC failed; using configured catalog', error)
      return Object.entries(this.models()).map(([id, name]) => ({ provider: 'cursor', id, name }))
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
    if (options.temperature !== undefined || options.stop !== undefined) {
      throw new LlmError('Cursor transport does not support this generation option', 'UNSUPPORTED')
    }
    const key = await this.resolveKey()
    if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
    const system = options.system ?? options.messages
      .find(message => message.role === 'system')?.content
      .map(block => 'text' in block ? block.text : '').join('')
    const messages = options.messages
      .filter(message => message.role !== 'system')
      .map(message => ({ text: textOf(message), type: message.role === 'assistant' ? 2 : 1 }))
    const headers = messages.map((message, i) => ({ id: `${i}-${crypto.randomUUID()}`, type: message.type }))
    const tools = options.tools?.map(tool => ({
      name: tool.name,
      serverName: serverName(tool.name),
      description: tool.description,
      parameters: JSON.stringify(tool.parameters),
    }))
    const body = frame(encodeRequest({
      model: options.model,
      conversation: messages,
      headers,
      conversationId: crypto.randomUUID(),
      ...(system === undefined ? {} : { explicitContext: system }),
      ...(tools === undefined ? {} : { tools }),
    }))
    let response: Awaited<ReturnType<CursorHttp2Transport['request']>>
    try {
      response = await this.transport.request({
        path: endpoint,
        headers: this.headers(key),
        body,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (error instanceof LlmError) throw error
      throw new LlmError(error instanceof Error ? error.message : 'Cursor request failed', 'PROVIDER_ERROR', { cause: error })
    }
    if (response.status !== 200) {
      throw new LlmError(
        `Cursor HTTP ${response.status}`,
        response.status === 401 || response.status === 403 ? 'AUTH' : 'PROVIDER_ERROR',
        { status: response.status },
      )
    }
    let index = -1
    let active: 'text' | 'reasoning' | 'tool-call' | undefined
    let activeTool: { id: string; name: string } | undefined
    let outputTokens = 0
    let sawUsage = false
    let sawTool = false
    let sawTrailer = false
    const assembled = new Map<number, string>()
    const open = function* (
      kind: 'text' | 'reasoning' | 'tool-call',
      value: string,
      tool?: { id: string; name: string },
    ): Generator<StreamChunk> {
      if (active !== kind) {
        if (active !== undefined) {
          yield {
            type: 'block-end',
            index,
            block: active === 'text'
              ? { type: 'text', text: assembled.get(index) ?? '' }
              : active === 'reasoning'
                ? { type: 'reasoning', text: assembled.get(index) ?? '' }
                : {
                  type: 'tool-call',
                  id: activeTool?.id ?? '',
                  name: activeTool?.name ?? '',
                  arguments: assembled.get(index) ?? '',
                },
          } as StreamChunk
        }
        active = kind
        activeTool = tool
        index++
        assembled.set(index, '')
        yield { type: 'block-start', index, blockType: kind }
      }
      assembled.set(index, (assembled.get(index) ?? '') + value)
      yield kind === 'text'
        ? { type: 'text-delta', index, text: value }
        : kind === 'reasoning'
          ? { type: 'reasoning-delta', index, text: value }
          : {
            type: 'tool-call-delta',
            index,
            id: (tool?.id ?? '') as never,
            ...(tool?.name === undefined ? {} : { name: tool.name }),
            argumentsDelta: value,
          }
    }
    try {
      let pending = new Uint8Array()
      for await (const chunk of response.body) {
        if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
        const merged = new Uint8Array(pending.length + chunk.length)
        merged.set(pending)
        merged.set(chunk, pending.length)
        pending = merged
        const packets = parseFrames(pending)
        for (const packet of packets) {
          if (packet.flags === 2) {
            sawTrailer = true
            decodeTrailer(packet.payload)
            continue
          }
          const decoded = decodeResponse(decodePayload(packet.flags, packet.payload))
          if (!decoded) continue
          if (decoded.usage) {
            outputTokens += decoded.usage.outputTokens
            sawUsage = true
          }
          if (decoded.text) {
            yield* open('text', decoded.text)
          } else if (decoded.thinking) {
            yield* open('reasoning', decoded.thinking)
          } else if (decoded.citations) {
            yield* open('text', decoded.citations.map(c => `\n[${c.title || c.url}](${c.url})`).join(''))
          } else if (decoded.tool) {
            sawTool = true
            yield* open('tool-call', decoded.tool.args, decoded.tool)
          }
        }
        pending = pending.slice(packets.reduce((total, packet) => total + packet.size, 0))
      }
      if (pending.length) throw new LlmError('Cursor stream ended with an incomplete frame', 'STREAM_CLOSED')
      if (!sawTrailer) throw new LlmError('Cursor stream ended without a Connect trailer', 'STREAM_CLOSED')
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
      throw new LlmError(error instanceof Error ? error.message : 'Cursor stream failed', 'PROVIDER_ERROR', { cause: error })
    }
    if (active !== undefined) {
      yield {
        type: 'block-end',
        index,
        block: active === 'text'
          ? { type: 'text', text: assembled.get(index) ?? '' }
          : active === 'reasoning'
            ? { type: 'reasoning', text: assembled.get(index) ?? '' }
            : {
              type: 'tool-call',
              id: activeTool?.id ?? '',
              name: activeTool?.name ?? '',
              arguments: assembled.get(index) ?? '',
            },
      } as StreamChunk
    }
    if (sawUsage) yield { type: 'usage', usage: { inputTokens: 0, outputTokens } }
    yield { type: 'finish', reason: { kind: sawTool ? 'tool-calls' : 'stop' } }
  }
}
