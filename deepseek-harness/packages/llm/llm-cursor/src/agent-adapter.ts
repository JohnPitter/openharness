/**
 * Native Cursor adapter over the `agent.v1.AgentService/Run` BiDi protocol.
 *
 * The deprecated `aiserver.v1.ChatService` endpoints are rejected server-side
 * (`ERROR_DEPRECATED` / version-gated trailers), so the native transport is
 * the agent protocol the cursor-agent client speaks: each turn opens one
 * Connect BiDi stream with a `run_request`, answers the server's exec RPCs
 * (`request_context_args` with a minimal tool-less context, `mcp_args` with
 * results for the harness-declared tools), and consumes `interaction_update`
 * deltas until `turn_ended`. A run stays open across `stream()` calls while
 * tool calls are pending: the harness's tool results re-enter the same run as
 * `mcp_result` frames rather than starting a new conversation.
 *
 * @module @deepseek-ai/dsh-llm-cursor/agent-adapter
 */

import { platform, release } from 'node:os'
import { CallId, LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type {
  ContentBlock, GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import {
  decodeServerFrame, decodeUsableModelsResponse, encodeMcpResult, encodeRequestContextResult,
  encodeRunRequest, encodeUsableModelsRequest, type AgentToolDefinition,
} from './agent-proto.ts'
import { frame, parseFrames, payloadFromConnectBody, decodeTrailer } from './protobuf.ts'
import { createHttp2Transport } from './transport.ts'
import type { CursorHttp2Transport, InteractiveHttp2Stream } from './transport.ts'
import {
  CATALOG_LISTING_TIMEOUT_MS, checksum, resolveCatalogModel,
  type CursorCatalogModel, type GhostMode,
} from './adapter.ts'

export { DEFAULT_CLIENT_COMMIT, DEFAULT_CLIENT_VERSION } from './adapter.ts'

/** {@link CursorAgentAdapter} transport and identity configuration. */
export interface CursorAgentTransportConfig {
  baseURL: string
  clientVersion: string
  /** Cursor build commit sent as `x-cursor-client-commit`, paired with `clientVersion`. */
  clientCommit: string
  timezone: string
  machineId: string
  macMachineId?: string
  ghostMode: GhostMode
  /** Milliseconds with only heartbeat frames before a run fails with `LlmError('TIMEOUT')`. */
  runStallTimeoutMs?: number
}

/** One MCP call the server asked the client to execute, awaiting the harness's tool result. */
interface PendingMcpCall {
  execId: number
  callId: string
  name: string
  argsJson: string
}

/** Queued events of one run: streamed chunks plus terminal failures. */
type RunEvent = StreamChunk | { type: 'run-error'; error: unknown }

/** Live BiDi run state shared across the `stream()` calls of one harness turn. */
interface ActiveRun {
  stream: InteractiveHttp2Stream
  queue: RunEvent[]
  notify: (() => void) | undefined
  pending: Map<string, PendingMcpCall>
  done: boolean
  touchedAt: number
}

const RUN_EXPIRY_MS = 30 * 60 * 1000
const DEFAULT_RUN_STALL_TIMEOUT_MS = 120_000
const CATALOG_PATH = '/aiserver.v1.AiService/GetUsableModels'
const RUN_PATH = '/agent.v1.AgentService/Run'

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

async function collectBody(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  let out: Uint8Array = new Uint8Array(0)
  for await (const chunk of body) out = concat(out, chunk)
  return out
}

/**
 * Cursor adapter speaking `agent.v1.AgentService/Run` over Connect/protobuf
 * HTTP/2. Registered against the `cursor` provider route.
 */
export class CursorAgentAdapter extends LlmAdapter {
  private readonly transport: CursorHttp2Transport
  private readonly runs = new Map<string, ActiveRun>()
  private lastGoodModels: LlmModelInfo[] | undefined

  constructor(
    private readonly resolveKey: () => Promise<string>,
    private readonly readCatalog: () => readonly CursorCatalogModel[],
    private readonly config: CursorAgentTransportConfig,
    transport?: CursorHttp2Transport,
  ) {
    super()
    this.transport = transport ?? createHttp2Transport({ baseURL: config.baseURL })
  }

  /** Tear down every live run and the shared HTTP/2 session. */
  dispose(): void {
    for (const run of this.runs.values()) run.stream.close()
    this.runs.clear()
    this.transport.close()
  }

  private headers(token: string): Record<string, string> {
    const ghost = this.config.ghostMode === 'implicit-false' ? 'implicit-false' : String(this.config.ghostMode)
    const requestId = crypto.randomUUID()
    return {
      'authorization': `Bearer ${token}`,
      'x-cursor-client-version': this.config.clientVersion,
      'x-cursor-client-commit': this.config.clientCommit,
      'x-cursor-checksum': checksum(this.config.machineId, this.config.macMachineId, Date.now()),
      'x-cursor-timezone': this.config.timezone,
      'x-cursor-client-type': 'ide',
      'x-cursor-client-layout': 'editor',
      'x-cursor-client-device-type': 'desktop',
      'x-cursor-client-os': platform(),
      'x-cursor-client-os-version': release(),
      'x-cursor-client-arch': process.arch,
      'x-new-onboarding-completed': 'false',
      'x-request-id': requestId,
      'x-amzn-trace-id': `Root=${requestId}`,
      'x-session-id': crypto.randomUUID(),
      'x-ghost-mode': ghost,
    }
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Cursor', metering: 'requests' }
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve(resolveCatalogModel(this.readCatalog(), provider, model))
  }

  override async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    const catalog = this.readCatalog()
    try {
      const token = await this.resolveKey()
      const response = await this.transport.request({
        path: CATALOG_PATH,
        headers: {
          ...this.headers(token),
          'content-type': 'application/proto',
          'accept': 'application/proto',
          'connect-protocol-version': '1',
        },
        body: encodeUsableModelsRequest(),
        signal: AbortSignal.timeout(CATALOG_LISTING_TIMEOUT_MS),
      })
      if (response.status !== 200) throw new LlmError(`Cursor HTTP ${response.status}`, 'PROVIDER_ERROR')
      const body = payloadFromConnectBody(await collectBody(response.body))
      const seen = new Set<string>()
      const models: LlmModelInfo[] = []
      for (const usable of decodeUsableModelsResponse(body)) {
        const id = usable.modelId ?? ''
        if (id === '' || seen.has(id)) continue
        seen.add(id)
        const row = catalog.find(entry => entry.id === id)
        models.push({
          provider: 'cursor',
          id,
          name: usable.displayName !== undefined && usable.displayName !== '' ? usable.displayName : (row?.name ?? id),
        })
      }
      if (models.length === 0) throw new LlmError('Cursor returned no usable models', 'PROVIDER_ERROR')
      this.lastGoodModels = models
      return models
    } catch (error) {
      console.error('Cursor listModels RPC failed; using configured catalog', error)
      if (this.lastGoodModels !== undefined) return this.lastGoodModels
      return catalog.map(row => ({ provider: 'cursor', id: row.id, name: row.name ?? row.id }))
    }
  }

  /**
   * Stream one harness turn.
   *
   * A user message carrying only tool results continues the session's live
   * run — each result answers its parked `mcp_args` call in place — while any
   * other request opens a fresh run replaying prior messages as the run's
   * `conversation_history`.
   */
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sessionKey: string = options.sessionId ?? ''
    const existing = this.runs.get(sessionKey)
    if (existing !== undefined && (existing.done || Date.now() - existing.touchedAt > RUN_EXPIRY_MS)) {
      existing.stream.close()
      this.runs.delete(sessionKey)
    }
    const live = this.runs.get(sessionKey)

    const trailing = options.messages.at(-1)
    const results = trailing?.role === 'user'
      ? trailing.content.filter((block): block is Extract<ContentBlock, { type: 'tool-result' }> => block.type === 'tool-result')
      : []
    if (live !== undefined && results.length > 0) {
      for (const result of results) {
        const call = live.pending.get(result.toolCallId)
        if (call === undefined) continue
        live.pending.delete(result.toolCallId)
        live.stream.write(frame(encodeMcpResult(call.execId, {
          text: result.content.map(block => (block.type === 'text' ? block.text : '[non-text tool result content]')).join('\n'),
          isError: result.isError === true,
        })))
      }
      yield* this.drain(live, options.signal)
      return
    }

    if (live !== undefined) {
      live.stream.close()
      this.runs.delete(sessionKey)
    }
    const run = await this.openRun(options)
    this.runs.set(sessionKey, run)
    yield* this.drain(run, options.signal)
  }

  /** Open a fresh run for one harness request and start its background reader. */
  private async openRun(options: GenerateOptions): Promise<ActiveRun> {
    const token = await this.resolveKey()
    const trailing = options.messages.at(-1)
    const trailingText = trailing?.role === 'user'
      ? trailing.content
        .filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text')
        .map(block => block.text).join('\n')
      : ''
    const historyMessages = trailingText === '' ? options.messages : options.messages.slice(0, -1)
    const flattened = this.flatten(historyMessages)
    const userText = flattened === ''
      ? (trailingText === '' ? '(Tool results are in the conversation above. Continue the turn.)' : trailingText)
      : `${flattened}\n\n[user]\n${trailingText === '' ? '(Tool results are in the conversation above. Continue the turn.)' : trailingText}`

    const tools: AgentToolDefinition[] = (options.tools ?? []).map((tool: ToolSchema) => ({
      name: tool.name,
      description: tool.description,
      inputSchemaJson: JSON.stringify(tool.parameters ?? { type: 'object', properties: {} }),
    }))
    const displayName = this.readCatalog().find(row => row.id === options.model)?.name ?? options.model

    const requestOptions: Parameters<CursorHttp2Transport['openStream']>[0] = {
      path: RUN_PATH,
      headers: {
        ...this.headers(token),
        'content-type': 'application/connect+proto',
        'accept': 'application/connect+proto',
        'connect-protocol-version': '1',
      },
    }
    if (options.signal !== undefined) requestOptions.signal = options.signal
    const stream = this.transport.openStream(requestOptions)
    const run: ActiveRun = {
      stream, queue: [], notify: undefined, pending: new Map(), done: false, touchedAt: Date.now(),
    }
    const response = await stream.response
    if (response.status !== 200) {
      const detail = await collectBody(response.body)
      throw new LlmError(
        `Cursor HTTP ${response.status}${detail.length === 0 ? '' : `: ${new TextDecoder().decode(detail)}`}`,
        'PROVIDER_ERROR',
      )
    }
    stream.write(frame(encodeRunRequest({
      conversationId: crypto.randomUUID(),
      userMessageId: crypto.randomUUID(),
      userText,
      modelId: options.model,
      modelDisplayName: displayName,
      customSystemPrompt: options.system,
      tools,
    })))
    void this.readFrames(run, response.body, options.signal)
    return run
  }

  /**
   * Flatten prior turns into tagged text replayed inside the current user
   * message. The agent protocol keeps per-turn state in client-uploaded blobs
   * (`ConversationStateStructure.turns` + `UploadConversationBlobs`); the
   * harness instead replays the transcript the way the SDK transport does —
   * the model reads it as the conversation so far.
   */
  private flatten(messages: GenerateOptions['messages']): string {
    const toolNames = new Map<string, string>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      for (const block of message.content) {
        if (block.type === 'tool-call') toolNames.set(block.id, block.name)
      }
    }
    const lines: string[] = []
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'text') {
          lines.push(message.role === 'assistant' ? `[assistant]\n${block.text}` : `[user]\n${block.text}`)
        } else if (block.type === 'tool-call') {
          lines.push(`[assistant called tool ${block.name} with arguments]\n${block.arguments}`)
        } else if (block.type === 'tool-result') {
          const name = toolNames.get(block.toolCallId) ?? 'unknown'
          const text = block.content.map(item => (item.type === 'text' ? item.text : '[non-text tool result content]')).join('\n')
          lines.push(`[tool result ${name}${block.isError === true ? ' (error)' : ''}]\n${text}`)
        } else if (block.type === 'image') {
          throw new LlmError('Cursor native transport does not support image attachments', 'PROVIDER_ERROR')
        }
      }
    }
    if (lines.length === 0) return ''
    return `The conversation so far:\n\n${lines.join('\n\n')}`
  }

  /**
   * Background reader: split Connect frames off the response body, answer exec
   * RPCs the adapter owns (request context), and park everything else in the
   * run's queue for the current `stream()` call to drain. Heartbeats keep the
   * stream alive but do not reset the stall watchdog; only frames carrying
   * turn progress do.
   */
  private async readFrames(run: ActiveRun, body: AsyncIterable<Uint8Array>, signal: AbortSignal | undefined): Promise<void> {
    let buffered: Uint8Array = new Uint8Array(0)
    let stallTimer: ReturnType<typeof setTimeout> | undefined
    const resetStall = () => {
      if (stallTimer !== undefined) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => {
        this.fail(run, new LlmError(
          `Cursor run produced no turn events for ${this.config.runStallTimeoutMs ?? DEFAULT_RUN_STALL_TIMEOUT_MS}ms`,
          'TIMEOUT',
        ))
      }, this.config.runStallTimeoutMs ?? DEFAULT_RUN_STALL_TIMEOUT_MS)
      stallTimer.unref?.()
    }
    resetStall()
    try {
      for await (const chunk of body) {
        buffered = concat(buffered, chunk)
        const packets = parseFrames(buffered)
        let consumed = 0
        for (const packet of packets) consumed += packet.size
        buffered = buffered.slice(consumed)
        for (const packet of packets) {
          if (packet.flags === 2) {
            if (stallTimer !== undefined) clearTimeout(stallTimer)
            try {
              decodeTrailer(packet.payload)
              this.finishRun(run)
            } catch (error) {
              this.fail(run, error)
            }
            return
          }
          if (packet.flags !== 0) continue
          const before = run.queue.length
          this.handleFrame(run, packet.payload)
          if (run.queue.length !== before) resetStall()
          if (run.done) {
            if (stallTimer !== undefined) clearTimeout(stallTimer)
            return
          }
        }
      }
      if (stallTimer !== undefined) clearTimeout(stallTimer)
      if (!run.done) this.fail(run, new LlmError('Cursor run stream ended before the turn completed', 'PROVIDER_ERROR'))
    } catch (error) {
      if (stallTimer !== undefined) clearTimeout(stallTimer)
      if (!run.done) {
        this.fail(run, signal?.aborted === true ? new LlmError('request aborted', 'ABORTED') : error)
      }
    }
  }

  /** Dispatch one decoded server data frame. */
  private handleFrame(run: ActiveRun, payload: Uint8Array): void {
    const decoded = decodeServerFrame(payload)
    if (decoded.kind === 'exec') {
      const request = decoded.request
      if (request.kind === 'request-context') {
        run.stream.write(frame(encodeRequestContextResult(request.execId, {
          osVersion: `${platform()} ${release()}`,
          shell: platform() === 'win32' ? 'pwsh' : 'sh',
          timeZone: this.config.timezone,
        })))
        return
      }
      const call: PendingMcpCall = { execId: request.execId, callId: request.callId, name: request.name, argsJson: request.argsJson }
      run.pending.set(call.callId, call)
      const index = 2 + run.pending.size
      this.push(run, { type: 'block-start', index, blockType: 'tool-call' })
      this.push(run, { type: 'tool-call-delta', index, id: CallId(call.callId), name: call.name, argumentsDelta: call.argsJson })
      this.push(run, { type: 'block-end', index, block: { type: 'tool-call', id: CallId(call.callId), name: call.name, arguments: call.argsJson } })
      this.push(run, { type: 'finish', reason: { kind: 'tool-calls' } })
      return
    }
    if (decoded.kind !== 'interaction') return
    const update = decoded.update
    switch (update.kind) {
      case 'text':
        if (!update.isServerNotice && update.text !== '') this.push(run, { type: 'text-delta', index: 1, text: update.text })
        return
      case 'thinking':
        if (update.text !== '') this.push(run, { type: 'reasoning-delta', index: 0, text: update.text })
        return
      case 'turn-ended':
        this.push(run, {
          type: 'usage',
          usage: { inputTokens: update.inputTokens ?? 0, outputTokens: update.outputTokens ?? 0 },
        })
        this.push(run, { type: 'finish', reason: { kind: 'stop' } })
        this.finishRun(run)
        return
      case 'heartbeat':
        return
    }
  }

  /** Mark a run completed and half-close its stream; queued events remain drainable. */
  private finishRun(run: ActiveRun): void {
    run.done = true
    try {
      run.stream.end(frame(new TextEncoder().encode('{}'), 2))
    } catch {
      // The server may already have closed the stream; the turn is over either way.
    }
  }

  /** Fail a run: park the error for the draining call and tear the stream down. */
  private fail(run: ActiveRun, error: unknown): void {
    run.done = true
    run.stream.close()
    this.push(run, { type: 'run-error', error })
  }

  private push(run: ActiveRun, event: RunEvent): void {
    run.queue.push(event)
    const notify = run.notify
    run.notify = undefined
    notify?.()
  }

  /**
   * Drain one run's queue until a terminal `finish` chunk. Reasoning and text
   * deltas are wrapped in their block boundaries lazily; the run stays alive
   * after a `tool-calls` finish so the next `stream()` call answers the
   * parked MCP calls.
   */
  private async *drain(run: ActiveRun, signal: AbortSignal | undefined): AsyncIterable<StreamChunk> {
    let openedBlock: { index: number; blockType: 'text' | 'reasoning'; text: string } | undefined
    function* closeOpenBlock(): Generator<StreamChunk> {
      if (openedBlock === undefined) return
      const block = openedBlock
      openedBlock = undefined
      yield {
        type: 'block-end',
        index: block.index,
        block: block.blockType === 'text' ? { type: 'text', text: block.text } : { type: 'reasoning', text: block.text },
      }
    }
    for (;;) {
      while (run.queue.length > 0) {
        const event = run.queue.shift()!
        run.touchedAt = Date.now()
        if (event.type === 'run-error') {
          yield* closeOpenBlock()
          throw (event as { error: unknown }).error
        }
        const chunk = event as StreamChunk
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          const blockType = chunk.type === 'text-delta' ? 'text' : 'reasoning'
          const index = chunk.type === 'text-delta' ? 1 : 0
          if (openedBlock !== undefined && openedBlock.blockType !== blockType) yield* closeOpenBlock()
          if (openedBlock === undefined) {
            openedBlock = { index, blockType, text: '' }
            yield { type: 'block-start', index, blockType }
          }
          openedBlock.text += chunk.text
          yield chunk
          continue
        }
        if (chunk.type === 'block-start') {
          yield* closeOpenBlock()
          yield chunk
          continue
        }
        if (chunk.type === 'finish') {
          yield* closeOpenBlock()
          yield chunk
          return
        }
        yield chunk
      }
      if (run.done) return
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          run.notify = undefined
          run.stream.close()
          reject(new LlmError('request aborted', 'ABORTED'))
        }
        run.notify = () => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        if (signal?.aborted === true) { onAbort(); return }
        signal?.addEventListener('abort', onAbort, { once: true })
        // Re-check after subscribing: a push may have landed between the queue
        // drain above and the waiter registration.
        if (run.queue.length > 0 || run.done) run.notify()
      })
    }
  }
}
