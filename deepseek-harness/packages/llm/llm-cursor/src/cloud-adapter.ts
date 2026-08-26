import { Agent, Cursor } from '@cursor/sdk'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, StreamChunk, ToolSchema, TokenUsage } from '@deepseek-ai/dsh-llm'

type InteractionUpdate = { type: string; text?: string; usage?: TokenUsage }
type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void }
type QueueItem = { chunk?: StreamChunk; done?: boolean; error?: unknown }
type CustomTool = {
  description: string
  inputSchema: Record<string, unknown>
  execute: (args: Record<string, unknown>, context: { toolCallId?: string }) => Promise<unknown>
}
type Session = {
  agent?: Awaited<ReturnType<typeof Agent.create>>
  run?: { wait: () => Promise<{ status?: string; error?: { message?: string }; usage?: TokenUsage }>; cancel?: () => void }
  pendingCalls: Map<string, Pending>
  lastToolsSignature?: string
  queue: QueueItem[]
  waiters: Array<{ resolve: (item: QueueItem) => void; reject: (error: unknown) => void }>
  done: boolean
  error?: unknown
  lastActivity: number
}

const SESSION_TTL = 30 * 60 * 1000
const BUILTIN_TOOLS = ['shell', 'read', 'edit', 'grep', 'glob', 'ls', 'task', 'webSearch', 'delete', 'readLints', 'webFetch', 'semSearch', 'updateTodos', 'readTodos', 'askQuestion', 'await', 'generateImage', 'applyAgentDiff']

function textOf(message: GenerateOptions['messages'][number]): string {
  return message.content.map((block) => {
    if ('text' in block) return block.text
    if (block.type === 'tool-call') return block.arguments
    if (block.type === 'tool-result') return block.content.map(x => 'text' in x ? x.text : '').join('')
    return ''
  }).join('')
}

/** Serializes a conversation for the stateless cloud transport. */
export function serializeCloudPrompt(options: GenerateOptions): string {
  const parts: string[] = []
  if (options.system !== undefined) parts.push(`[system]\n${options.system}`)
  for (const message of options.messages) parts.push(`[${message.role}]\n${textOf(message)}`)
  return parts.join('\n\n')
}

function toolName(name: string): string { return name.replace(/[^a-zA-Z0-9_-]/g, '') || 'tool' }
function toolSignature(tools: ToolSchema[]): string { return JSON.stringify(tools) }
function sessionKey(options: GenerateOptions): string { return String(options.sessionId ?? crypto.randomUUID()) }
function resultFor(message: GenerateOptions['messages'][number]): Array<{ id: string; value: unknown }> {
  const out: Array<{ id: string; value: unknown }> = []
  for (const block of message.content) {
    if (block.type === 'tool-result') out.push({ id: String(block.toolCallId), value: block.content.map(x => 'text' in x ? x.text : '').join('') })
  }
  return out
}

/** Cursor Agent SDK adapter, including the persistent local custom-tool bridge. */
export class CursorCloudAdapter extends LlmAdapter {
  private readonly sessions = new Map<string, Session>()

  constructor(private readonly resolveKey: () => Promise<string>, private readonly models: () => Record<string, string>) { super() }

  override providerInfo(provider: string) { return { id: provider, name: 'Cursor' } }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    if (provider !== 'cursor') return []
    try {
      const key = await this.resolveKey()
      const models = await Cursor.models.list({ apiKey: key })
      return models.map(model => ({ provider: 'cursor', id: model.id, name: model.displayName }))
    } catch (error) {
      console.warn('Cursor SDK listModels failed; using configured catalog', error)
      return Object.entries(this.models()).map(([id, name]) => ({ provider: 'cursor', id, name }))
    }
  }

  /** Cancels and closes every retained local agent. */
  dispose(): void {
    for (const session of this.sessions.values()) this.closeSession(session)
    this.sessions.clear()
  }

  private closeSession(session: Session): void {
    session.run?.cancel?.()
    for (const pending of session.pendingCalls.values()) pending.reject(new LlmError('Cursor tool bridge disposed', 'ABORTED'))
    session.pendingCalls.clear()
    const error = new LlmError('Cursor tool bridge disposed', 'ABORTED')
    for (const waiter of session.waiters) waiter.reject(error)
    session.waiters.length = 0
    session.agent?.close()
  }

  private cleanup(): void {
    const cutoff = Date.now() - SESSION_TTL
    for (const [key, session] of this.sessions) {
      if (session.lastActivity < cutoff) { this.closeSession(session); this.sessions.delete(key) }
    }
  }

  private enqueue(session: Session, item: QueueItem): void {
    const waiter = session.waiters.shift()
    if (waiter) waiter.resolve(item); else session.queue.push(item)
  }

  private async next(session: Session, signal?: AbortSignal): Promise<QueueItem> {
    const item = session.queue.shift()
    if (item) return item
    return new Promise((resolve, reject) => {
      const waiter = { resolve: (value: QueueItem) => { signal?.removeEventListener('abort', onAbort); resolve(value) }, reject }
      const onAbort = () => {
        signal?.removeEventListener('abort', onAbort)
        const index = session.waiters.indexOf(waiter)
        if (index >= 0) session.waiters.splice(index, 1)
        this.closeSession(session)
        reject(new LlmError('request aborted', 'ABORTED'))
      }
      if (signal?.aborted) { onAbort(); return }
      signal?.addEventListener('abort', onAbort, { once: true })
      session.waiters.push(waiter)
    })
  }

  private async start(session: Session, options: GenerateOptions, tools: ToolSchema[], key: string): Promise<void> {
    const customTools: Record<string, CustomTool> = {}
    for (const schema of tools) {
      const name = toolName(schema.name)
      customTools[name] = {
        description: schema.description,
        inputSchema: schema.parameters,
        execute: async (args, context) => {
          const id = context.toolCallId ?? crypto.randomUUID()
          const index = session.queue.length
          this.enqueue(session, { chunk: { type: 'block-start', index, blockType: 'tool-call' } })
          this.enqueue(session, { chunk: { type: 'tool-call-delta', index, id: id as never, name, argumentsDelta: JSON.stringify(args) } })
          this.enqueue(session, { chunk: { type: 'block-end', index, block: { type: 'tool-call', id: id as never, name, arguments: JSON.stringify(args) } } })
          return new Promise((resolve, reject) => {
            session.pendingCalls.set(id, { resolve, reject })
          })
        },
      }
    }
    try {
      const agent = session.agent ?? await Agent.create({ apiKey: key, model: { id: options.model }, tools: ['mcp'], disallowedTools: BUILTIN_TOOLS, local: { cwd: process.cwd(), customTools: customTools as never } })
      session.agent = agent
      const run = await agent.send(serializeCloudPrompt(options), {
        local: { customTools: customTools as never },
        onDelta: ({ update }) => {
          const value = update as unknown as InteractionUpdate
          if (value.type === 'text-delta' || value.type === 'thinking-delta') this.enqueue(session, { chunk: { type: value.type === 'text-delta' ? 'text-delta' : 'reasoning-delta', index: 0, text: value.text ?? '' } })
          if (value.type === 'turn-ended' && value.usage !== undefined) this.enqueue(session, { chunk: { type: 'usage', usage: value.usage } })
        },
      })
      session.run = run
      const result = await run.wait()
      session.done = true
      this.enqueue(session, {
        done: true,
        ...(result.error ? { error: new Error(result.error.message || 'Cursor run failed') } : {}),
      })
    } catch (error) {
      session.done = true
      session.error = error
      this.enqueue(session, { done: true, error })
    }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
    if ((options.tools !== undefined && options.tools.length === 0) || options.temperature !== undefined || options.stop !== undefined) throw new LlmError('Cursor Cloud Agent SDK does not support empty tools, temperature, or stop', 'UNSUPPORTED')
    this.cleanup()
    if (options.tools === undefined) {
      const key = await this.resolveKey()
      let agent: Awaited<ReturnType<typeof Agent.create>> | undefined
      try {
        agent = await Agent.create({ apiKey: key, model: { id: options.model }, cloud: { repos: [] } })
        const updates: InteractionUpdate[] = []
        const run = await agent.send(serializeCloudPrompt(options), {
          onDelta: ({ update }) => { updates.push(update as InteractionUpdate) },
        })
        const result = await run.wait()
        let index = -1; let active: 'text' | 'reasoning' | undefined; let assembled = ''
        const close = function* (): Generator<StreamChunk> { if (active !== undefined) { yield { type: 'block-end', index, block: { type: active, text: assembled } }; active = undefined; assembled = '' } }
        for (const update of updates) {
          if (update.type !== 'text-delta' && update.type !== 'thinking-delta') { if (update.type === 'turn-ended' && update.usage) yield { type: 'usage', usage: update.usage }; continue }
          const kind = update.type === 'text-delta' ? 'text' : 'reasoning'
          if (active !== kind) { yield* close(); active = kind; assembled = ''; index++; yield { type: 'block-start', index, blockType: kind } }
          const text = update.text ?? ''; assembled += text; yield kind === 'text' ? { type: 'text-delta', index, text } : { type: 'reasoning-delta', index, text }
        }
        yield* close()
        if (result.error || result.status === 'error' || result.status === 'cancelled') throw new LlmError(result.error?.message ?? `Cursor run ${result.status}`, 'PROVIDER_ERROR')
        yield { type: 'finish', reason: { kind: 'stop' } }
      } catch (error) {
        if (error instanceof LlmError) throw error
        if (options.signal?.aborted) throw new LlmError('request aborted', 'ABORTED')
        throw new LlmError(error instanceof Error ? error.message : 'Cursor request failed', 'PROVIDER_ERROR', { cause: error })
      } finally { agent?.close() }
      return
    }
    const key = await this.resolveKey(); const id = sessionKey(options)
    let session = this.sessions.get(id)
    if (!session) {
      session = { pendingCalls: new Map(), queue: [], waiters: [], done: false, lastActivity: Date.now() }
      this.sessions.set(id, session)
    }
    session.lastActivity = Date.now()
    const results = options.messages.flatMap(resultFor)
    for (const result of results) session.pendingCalls.get(result.id)?.resolve(result.value)
    const signature = toolSignature(options.tools)
    if (!session.run || session.done) {
      session.done = false
      session.error = undefined
      void this.start(session, options, options.tools, key)
    }
    session.lastToolsSignature = signature
    while (true) {
      if (options.signal?.aborted) { this.closeSession(session); throw new LlmError('request aborted', 'ABORTED') }
      const item = await this.next(session, options.signal)
      if (item.chunk) { yield item.chunk; if (item.chunk.type === 'block-end' && item.chunk.block.type === 'tool-call') { yield { type: 'finish', reason: { kind: 'tool-calls' } }; return } }
      if (item.error) throw item.error instanceof Error ? item.error : new Error('Cursor run failed')
      if (item.done) { yield { type: 'finish', reason: { kind: 'stop' } }; return }
    }
  }
}
