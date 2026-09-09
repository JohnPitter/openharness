import { afterEach, describe, expect, it, vi } from 'vitest'
import { platform } from 'node:os'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { checksum, rejectedWhenAborted } from '../src/adapter.ts'
import { CursorAgentAdapter } from '../src/agent-adapter.ts'
import type { CursorAgentTransportConfig } from '../src/agent-adapter.ts'
import type {
  CursorHttp2Transport, Http2RequestOptions, Http2Response, InteractiveHttp2Stream,
} from '../src/transport.ts'
import { frame, parseFrames, trailerFrame } from '../src/protobuf.ts'
import {
  decodeClientFrame, encodeServerFrame, encodeUsableModelsResponse,
} from '../src/agent-proto.ts'

const base = { provider: 'cursor', model: 'composer-2.5', messages: [] as never[] }

const config: CursorAgentTransportConfig = {
  baseURL: 'https://api2.cursor.sh',
  clientVersion: '3.19.13',
  clientCommit: 'commit-sha',
  timezone: 'UTC',
  machineId: 'machine',
  ghostMode: false,
}

afterEach(() => { vi.useRealTimers() })

/** Test-driven BiDi response body: frames arrive only when the test pushes them. */
class ScriptDriver {
  private queue: Uint8Array[] = []
  private waiters: Array<() => void> = []
  closed = false

  push(bytes: Uint8Array): void {
    this.queue.push(bytes)
    const waiters = this.waiters.splice(0)
    for (const wake of waiters) wake()
  }

  close(): void {
    this.closed = true
    const waiters = this.waiters.splice(0)
    for (const wake of waiters) wake()
  }

  async *body(): AsyncIterable<Uint8Array> {
    for (;;) {
      while (this.queue.length > 0) yield this.queue.shift()!
      if (this.closed) return
      await new Promise<void>(resolve => this.waiters.push(resolve))
      if (this.closed && this.queue.length === 0) return
    }
  }
}

interface FakeRun {
  stream: InteractiveHttp2Stream
  driver: ScriptDriver
  written: Uint8Array[]
  options: Omit<Http2RequestOptions, 'body'>
}

/** A fake transport: `request()` scripted for unary calls, `openStream()` producing test-driven runs. */
function fakeTransport(handler?: (options: Http2RequestOptions) => Http2Response | Promise<Http2Response>) {
  const state = { closed: false, runs: [] as FakeRun[], requests: [] as Http2RequestOptions[] }
  const transport: CursorHttp2Transport & typeof state = {
    get closed() { return state.closed },
    get runs() { return state.runs },
    get requests() { return state.requests },
    async request(options) {
      state.requests.push(options)
      if (handler === undefined) throw new LlmError('no scripted unary response', 'PROVIDER_ERROR')
      return handler(options)
    },
    openStream(options) {
      const driver = new ScriptDriver()
      const written: Uint8Array[] = []
      const stream: InteractiveHttp2Stream = {
        response: Promise.resolve({ status: 200, headers: {}, body: driver.body() }),
        write(chunk) { written.push(chunk) },
        end(chunk) { if (chunk !== undefined) written.push(chunk); driver.close() },
        close() { driver.close() },
      }
      const run: FakeRun = { stream, driver, written, options }
      state.runs.push(run)
      return stream
    },
    close() { state.closed = true },
  }
  return transport
}

function adapterOf(transport: CursorHttp2Transport, catalog: Array<{ id: string; name?: string }> = []) {
  return new CursorAgentAdapter(async () => 'jwt', () => catalog, config, transport)
}

/** Decoded client messages the adapter wrote into a run, in write order (data frames only). */
function clientMessages(run: FakeRun): unknown[] {
  return run.written.flatMap(bytes => parseFrames(bytes)
    .filter(packet => packet.flags === 0)
    .map(packet => decodeClientFrame(packet.payload)))
}

function dataFrame(value: unknown): Uint8Array {
  return frame(encodeServerFrame(value))
}

function textDelta(text: string): Uint8Array {
  return dataFrame({ interactionUpdate: { textDelta: { text } } })
}

const turnEnded = (inputTokens = 10, outputTokens = 3): Uint8Array =>
  dataFrame({ interactionUpdate: { turnEnded: { inputTokens, outputTokens } } })

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

describe('CursorAgentAdapter run protocol', () => {
  it('streams thinking, text, and usage until the turn ends', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as never],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    const run = transport.runs[0]!
    run.driver.push(dataFrame({ interactionUpdate: { thinkingDelta: { text: 'hm' } } }))
    run.driver.push(textDelta('he'))
    run.driver.push(textDelta('llo'))
    run.driver.push(turnEnded(11, 4))
    const chunks = await runPromise
    expect(chunks).toContainEqual({ type: 'reasoning-delta', index: 0, text: 'hm' })
    expect(chunks).toContainEqual({ type: 'text-delta', index: 1, text: 'llo' })
    expect(chunks).toContainEqual({ type: 'usage', usage: { inputTokens: 11, outputTokens: 4 } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
    const messages = clientMessages(run) as Array<{ runRequest?: { action?: { userMessageAction?: { userMessage?: { text?: string } } } } }>
    expect(messages[0]?.runRequest?.action?.userMessageAction?.userMessage?.text).toBe('hi')
  })

  it('sends the official client headers and run request fields', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      system: 'be brief',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as never],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    const run = transport.runs[0]!
    run.driver.push(turnEnded())
    await runPromise
    const headers = run.options.headers
    expect(headers.authorization).toBe('Bearer jwt')
    expect(headers['content-type']).toBe('application/connect+proto')
    expect(headers['x-cursor-client-version']).toBe('3.19.13')
    expect(headers['x-cursor-client-commit']).toBe('commit-sha')
    expect(headers['x-cursor-client-type']).toBe('ide')
    expect(headers['x-cursor-client-layout']).toBe('editor')
    expect(headers['x-cursor-client-device-type']).toBe('desktop')
    expect(headers['x-cursor-client-os']).toBe(platform())
    expect(headers['x-cursor-client-arch']).toBe(process.arch)
    expect(headers['x-new-onboarding-completed']).toBe('false')
    expect(headers['x-amzn-trace-id']).toBe(`Root=${headers['x-request-id']}`)
    const messages = clientMessages(run) as Array<{
      runRequest?: {
        modelDetails?: { modelId?: string }
        requestedModel?: { modelId?: string; builtInModel?: boolean }
        systemPromptSpec?: { append?: string }
      }
    }>
    expect(messages[0]?.runRequest?.modelDetails?.modelId).toBe('composer-2.5')
    expect(messages[0]?.runRequest?.requestedModel).toEqual({ modelId: 'composer-2.5', builtInModel: true })
    expect(messages[0]?.runRequest?.systemPromptSpec?.append).toBe('be brief')
  })

  it('answers request-context exec requests with a minimal tool-less context', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as never],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    const run = transport.runs[0]!
    run.driver.push(dataFrame({ execServerMessage: { id: 7, requestContextArgs: {} } }))
    await vi.waitFor(() => { expect(run.written.length).toBeGreaterThan(1) })
    run.driver.push(turnEnded())
    await runPromise
    const messages = clientMessages(run) as Array<{
      execClientMessage?: { id?: number; requestContextResult?: { success?: { requestContext?: { env?: { shell?: string } } } } }
    }>
    expect(messages[1]?.execClientMessage?.id).toBe(7)
    expect(messages[1]?.execClientMessage?.requestContextResult?.success?.requestContext?.env?.shell).toBeTypeOf('string')
  })

  it('declares harness tools, surfaces mcp calls, and continues with their results', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const firstTurn = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'weather?' }] } as never],
      tools: [{ name: 'get_weather', description: 'Get weather.', parameters: { type: 'object', properties: { city: { type: 'string' } } } }],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    const run = transport.runs[0]!
    run.driver.push(dataFrame({
      execServerMessage: {
        id: 3,
        mcpArgs: { name: 'get_weather', args: { city: { stringValue: 'Lisbon' } }, toolCallId: 'call_1' },
      },
    }))
    const first = await firstTurn
    expect(first).toContainEqual({ type: 'tool-call-delta', index: 3, id: 'call_1', name: 'get_weather', argumentsDelta: '{"city":"Lisbon"}' })
    expect(first.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    const openMessages = clientMessages(run) as Array<{
      runRequest?: { mcpTools?: { mcpTools?: Array<{ name?: string; inputSchemaJson?: string }> } }
    }>
    expect(openMessages[0]?.runRequest?.mcpTools?.mcpTools?.[0]?.name).toBe('get_weather')
    expect(openMessages[0]?.runRequest?.mcpTools?.mcpTools?.[0]?.inputSchemaJson).toContain('"city"')

    const secondTurn = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] } as never,
        { role: 'assistant', content: [{ type: 'tool-call', id: 'call_1', name: 'get_weather', arguments: '{"city":"Lisbon"}' }] } as never,
        { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call_1', content: [{ type: 'text', text: '22C sunny' }] }] } as never,
      ],
    }))
    await vi.waitFor(() => {
      const messages = clientMessages(run) as Array<{ execClientMessage?: { mcpResult?: unknown } }>
      expect(messages.some(message => message.execClientMessage?.mcpResult !== undefined)).toBe(true)
    })
    const written = clientMessages(run) as Array<{
      execClientMessage?: { id?: number; mcpResult?: { success?: { content?: Array<{ text?: { text?: string } }> } } }
    }>
    const result = written.find(message => message.execClientMessage?.mcpResult !== undefined)
    expect(result?.execClientMessage?.id).toBe(3)
    expect(result?.execClientMessage?.mcpResult?.success?.content?.[0]?.text?.text).toBe('22C sunny')
    run.driver.push(textDelta('done'))
    run.driver.push(turnEnded(20, 2))
    const second = await secondTurn
    expect(second).toContainEqual({ type: 'text-delta', index: 1, text: 'done' })
    expect(second).toContainEqual({ type: 'usage', usage: { inputTokens: 20, outputTokens: 2 } })
    expect(second.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('flattens prior turns into the next run’s user message', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's2' as never,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'one' }] } as never,
        { role: 'assistant', content: [{ type: 'text', text: 'two' }] } as never,
        { role: 'user', content: [{ type: 'text', text: 'three' }] } as never,
      ],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    const run = transport.runs[0]!
    run.driver.push(turnEnded())
    await runPromise
    const messages = clientMessages(run) as Array<{ runRequest?: { action?: { userMessageAction?: { userMessage?: { text?: string } } } } }>
    const text = messages[0]?.runRequest?.action?.userMessageAction?.userMessage?.text ?? ''
    expect(text).toContain('[user]\none')
    expect(text).toContain('[assistant]\ntwo')
    expect(text.endsWith('[user]\nthree')).toBe(true)
  })

  it('fails the turn with the trailer error', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as never],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    transport.runs[0]!.driver.push(trailerFrame({ code: 'resource_exhausted', message: 'quota exceeded' }))
    await expect(runPromise).rejects.toMatchObject({ code: 'RATE_LIMIT' })
  })

  it('aborts the turn when the signal fires mid-run', async () => {
    const transport = fakeTransport()
    const adapter = adapterOf(transport)
    const controller = new AbortController()
    const runPromise = collect(adapter.stream({
      ...base,
      sessionId: 's1' as never,
      signal: controller.signal,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] } as never],
    }))
    await vi.waitFor(() => { expect(transport.runs.length).toBe(1) })
    controller.abort()
    await expect(runPromise).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('rejects a pre-aborted signal', async () => {
    await expect(rejectedWhenAborted(AbortSignal.abort())).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('uses the official checksum vector', () => {
    // C=1700000 -> raw [0,0,0,25,240,160] -> obfuscated [165,166,168,180,72,237] -> paaotEjt
    expect(checksum('machine', 'mac', 1700000000000)).toBe('paaotEjtmachine/mac')
  })

  it('declares request metering', () => {
    const adapter = adapterOf(fakeTransport())
    expect(adapter.providerInfo('cursor')).toMatchObject({ id: 'cursor', name: 'Cursor', metering: 'requests' })
  })
})

describe('CursorAgentAdapter listModels', () => {
  it('lists usable models from the unary application/proto RPC', async () => {
    const transport = fakeTransport(options => {
      expect(options.path).toBe('/aiserver.v1.AiService/GetUsableModels')
      expect(options.headers['content-type']).toBe('application/proto')
      return { status: 200, headers: {}, body: (async function* () { yield encodeUsableModelsResponse([
        { modelId: 'a', displayName: 'Model A' }, { modelId: 'b' },
      ]) })() }
    })
    const adapter = adapterOf(transport)
    await expect(adapter.listModels('cursor')).resolves.toEqual([
      { provider: 'cursor', id: 'a', name: 'Model A' },
      { provider: 'cursor', id: 'b', name: 'b' },
    ])
  })

  it('falls back to the configured catalog when the listing fails', async () => {
    const transport = fakeTransport(() => { throw new LlmError('boom', 'PROVIDER_ERROR') })
    const adapter = adapterOf(transport, [{ id: 'composer-2.5', name: 'Composer 2.5' }])
    await expect(adapter.listModels('cursor')).resolves.toEqual([
      { provider: 'cursor', id: 'composer-2.5', name: 'Composer 2.5' },
    ])
  })
})
