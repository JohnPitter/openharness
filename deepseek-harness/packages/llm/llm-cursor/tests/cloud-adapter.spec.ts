import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'

const sdk = vi.hoisted(() => {
  const send = vi.fn()
  const close = vi.fn()
  const create = vi.fn(async () => ({ send, close }))
  const list = vi.fn()
  return { send, close, create, list }
})
vi.mock('@cursor/sdk', () => ({ Agent: { create: sdk.create }, Cursor: { models: { list: sdk.list } } }))
const { send, close, create, list } = sdk

import { CursorCloudAdapter, serializeCloudPrompt } from '../src/cloud-adapter.ts'

const base: GenerateOptions = { provider: 'cursor', model: 'composer-2.5', messages: [] }
beforeEach(() => { send.mockReset(); close.mockReset(); create.mockClear(); list.mockReset() })
afterEach(() => { vi.useRealTimers() })

const echoTool = { name: 'echo', description: 'Echo', parameters: { type: 'object' } }
type MockTool = { execute: (args: Record<string, unknown>, context: { toolCallId?: string }) => Promise<unknown> }
type MockSendOptions = { local: { customTools: Record<string, MockTool> }; onDelta: (x: { update: unknown }) => void }
const toolResult = (id: string, value: string) => ({ role: 'tool' as const, content: [{ type: 'tool-result' as const, toolCallId: id as never, content: [{ type: 'text' as const, text: value }] }] })

const usage = { inputTokens: 3, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 }

async function collect(options: GenerateOptions) {
  const chunks = []
  for await (const chunk of new CursorCloudAdapter(async () => 'crsr_test', () => []).stream(options)) chunks.push(chunk)
  return chunks
}

describe('CursorCloudAdapter SDK transport', () => {
  it('emits ordered text/thinking blocks and usage before finish', async () => {
    send.mockImplementationOnce(async (_prompt: string, options: { onDelta: (x: { update: unknown }) => void }) => {
      options.onDelta({ update: { type: 'text-delta', text: 'hello' } })
      options.onDelta({ update: { type: 'thinking-delta', text: 'why' } })
      options.onDelta({ update: { type: 'text-delta', text: '!' } })
      options.onDelta({ update: { type: 'turn-ended', usage } })
      return { wait: async () => ({ status: 'completed' }) }
    })
    const chunks = await collect(base)
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello' } },
      { type: 'block-start', index: 1, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 1, text: 'why' },
      { type: 'block-end', index: 1, block: { type: 'reasoning', text: 'why' } },
      { type: 'block-start', index: 2, blockType: 'text' },
      { type: 'text-delta', index: 2, text: '!' },
      { type: 'usage', usage },
      { type: 'block-end', index: 2, block: { type: 'text', text: '!' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    expect(close).toHaveBeenCalledOnce()
  })

  it('maps run.wait failures to PROVIDER_ERROR and closes the agent', async () => {
    send.mockResolvedValueOnce({ wait: vi.fn().mockRejectedValue(new Error('wait failed')) })
    await expect(collect(base)).rejects.toMatchObject({ code: 'PROVIDER_ERROR' })
    expect(close).toHaveBeenCalled()
  })

  it('serializes all conversation turns with role markers', () => {
    const prompt = serializeCloudPrompt({ ...base, system: 'rules', messages: [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
    ] })
    expect(prompt).toContain('[system]')
    expect(prompt).toContain('[user]')
    expect(prompt).toContain('[assistant]')
  })

  it.each(['tools', 'temperature', 'stop'] as const)('rejects %s as UNSUPPORTED', async (field) => {
    const options = { ...base, [field]: field === 'tools' ? [] : field === 'temperature' ? 0.5 : ['END'] }
    await expect(collect(options)).rejects.toMatchObject({ code: 'UNSUPPORTED' })
    expect(create).not.toHaveBeenCalled()
  })

  it('closes the agent when the stream is aborted', async () => {
    const controller = new AbortController()
    let rejectWait: (error: Error) => void = () => {}
    send.mockResolvedValueOnce({ wait: () => new Promise((_resolve, reject) => { rejectWait = reject }) })
    const iterator = new CursorCloudAdapter(async () => 'crsr_test', () => []).stream({ ...base, signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iterator.next()
    await vi.waitFor(() => { expect(send).toHaveBeenCalled() })
    controller.abort()
    rejectWait(new Error('aborted'))
    await iterator.return?.()
    await pending.catch(() => undefined)
    expect(close).toHaveBeenCalled()
  })

  it('preserves LlmError instances', async () => {
    send.mockRejectedValueOnce(new LlmError('bad', 'AUTH'))
    await expect(collect(base)).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('completes an agentic tool cycle across two calls', async () => {
    const adapter = new CursorCloudAdapter(async () => 'crsr_test', () => [])
    let pending!: Promise<unknown>
    let settled = false
    send.mockImplementationOnce(async (_prompt: string, options: MockSendOptions) => {
      pending = options.local.customTools.echo.execute({ msg: 'ping' }, { toolCallId: 'call-1' }).then(() => { settled = true; options.onDelta({ update: { type: 'text-delta', text: 'pong' } }) })
      return { wait: async () => { await pending; return { status: 'completed' } } }
    })
    const first = adapter.stream({ ...base, sessionId: 'agent-1', tools: [echoTool] })[Symbol.asyncIterator]()
    expect((await first.next()).value).toMatchObject({ type: 'block-start', blockType: 'tool-call' })
    expect((await first.next()).value).toMatchObject({ type: 'tool-call-delta', id: 'call-1' })
    expect((await first.next()).value).toMatchObject({ type: 'block-end', block: { type: 'tool-call', name: 'echo' } })
    expect((await first.next()).value).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(settled).toBe(false)
    const second = adapter.stream({ ...base, sessionId: 'agent-1', tools: [echoTool], messages: [toolResult('call-1', 'pong-echo')] })
    const chunks = []
    for await (const chunk of second) chunks.push(chunk)
    expect(settled).toBe(true)
    expect(chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'pong' })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('uses the local bridge rather than combining cloud repos with tools', async () => {
    send.mockResolvedValueOnce({ wait: async () => ({ status: 'completed' }) })
    await expect(collect({ ...base, tools: [echoTool] })).resolves.toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    const createOptions = create.mock.calls[0]?.[0] as { cloud?: unknown; local?: unknown; tools?: string[]; disallowedTools?: unknown[] }
    expect(createOptions.local).toBeDefined()
    expect(createOptions.tools).toEqual(['mcp'])
    expect(createOptions.disallowedTools).toBeInstanceOf(Array)
    expect(createOptions.cloud).toBeUndefined()
  })

  it('expires sessions and cancels and closes their run', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    send.mockResolvedValueOnce({ cancel, wait: () => new Promise(() => {}) })
    const adapter = new CursorCloudAdapter(async () => 'crsr_test', () => [])
    const first = adapter.stream({ ...base, sessionId: 'ttl-1', tools: [echoTool] })[Symbol.asyncIterator]()
    void first.next().catch(() => undefined)
    await vi.waitFor(() => { expect(send).toHaveBeenCalled() })
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1)
    send.mockResolvedValueOnce({ wait: async () => ({ status: 'completed' }) })
    const second = adapter.stream({ ...base, sessionId: 'ttl-2', tools: [echoTool] })[Symbol.asyncIterator]()
    await expect(second.next()).resolves.toMatchObject({ value: { type: 'finish' } })
    expect(cancel).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    await first.return?.()
  })

  it('aborts a waiting tool cycle and rejects its pending call', async () => {
    const controller = new AbortController()
    const adapter = new CursorCloudAdapter(async () => 'crsr_test', () => [])
    let execute!: (args: Record<string, unknown>, context: { toolCallId?: string }) => Promise<unknown>
    const cancel = vi.fn()
    send.mockImplementationOnce(async (_prompt: string, options: MockSendOptions) => {
      execute = options.local.customTools.echo.execute
      return { cancel, wait: () => new Promise(() => {}) }
    })
    const first = adapter.stream({ ...base, sessionId: 'abort-1', tools: [echoTool] })[Symbol.asyncIterator]()
    const initial = first.next()
    await vi.waitFor(() => { expect(send).toHaveBeenCalled() })
    const pending = execute({}, { toolCallId: 'call-abort' })
    await initial
    await first.next()
    await first.next()
    await first.next()
    const stream = adapter.stream({ ...base, sessionId: 'abort-1', tools: [echoTool], signal: controller.signal })[Symbol.asyncIterator]()
    const waiting = stream.next()
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('lists SDK models and falls back to the configured catalog', async () => {
    list.mockResolvedValueOnce([{ id: 'live', displayName: 'Live' }])
    const adapter = new CursorCloudAdapter(async () => 'crsr_test', () => [{ id: 'fallback', name: 'Fallback' }])
    await expect(adapter.listModels('cursor')).resolves.toEqual([
      { provider: 'cursor', id: 'live', name: 'Live' },
    ])
    list.mockRejectedValueOnce(new Error('nope'))
    await expect(adapter.listModels('cursor')).resolves.toEqual([
      { provider: 'cursor', id: 'fallback', name: 'Fallback' },
    ])
    list.mockResolvedValueOnce([])
    await expect(adapter.listModels('cursor')).resolves.toEqual([
      { provider: 'cursor', id: 'fallback', name: 'Fallback' },
    ])
    await expect(adapter.listModels('other')).resolves.toEqual([])
  })

  it('resolves catalog capacities through the SDK adapter', async () => {
    const adapter = new CursorCloudAdapter(async () => 'crsr_test', () => [{
      id: 'composer-2.5',
      name: 'Composer 2.5',
      contextWindow: 200_000,
      maxTokens: 32_768,
    }])
    await expect(adapter.resolveModel('cursor', 'composer-2.5')).resolves.toMatchObject({
      id: 'composer-2.5',
      context: { contextWindow: 200_000 },
      defaultMaxTokens: 32_768,
    })
  })
})
