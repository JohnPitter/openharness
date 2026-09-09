import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createAssistantMessage, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { FinishReason, LlmFailure, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmCursor from '@deepseek-ai/dsh-llm-cursor'

const MODEL = 'composer-2.5'
const contexts: Context[] = []

function isFailureReason(reason: FinishReason): reason is FinishReason & { failure: LlmFailure } {
  return reason.kind === 'error' || reason.kind === 'aborted'
}

async function harness(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmCursor)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function user(text: string): Message {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'cursor-e2e' },
  })
}

function assistant(text: string): Message {
  return createAssistantMessage({
    content: [{ type: 'text', text }],
    source: { provider: 'cursor', model: MODEL },
  })
}

async function collect(ctx: Context, messages: Message[]): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({
    provider: 'cursor',
    model: MODEL,
    messages,
    system: 'Be concise.',
    maxTokens: 64,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

function assertTextStream(chunks: StreamChunk[]): void {
  const finishIndex = chunks.findIndex(chunk => chunk.type === 'finish')
  expect(finishIndex).toBeGreaterThan(-1)
  expect(chunks.slice(finishIndex + 1)).toHaveLength(0)
  expect(chunks.filter(chunk => chunk.type === 'finish')).toHaveLength(1)

  const finish = chunks[finishIndex]
  expect(finish?.type).toBe('finish')
  if (finish?.type !== 'finish') return
  const reason: FinishReason = finish.reason
  if (isFailureReason(reason)) {
    throw new Error(`Cursor real API request failed (${reason.failure.code}): ${reason.failure.message}`)
  }

  // Blocks open and close in order (a reasoning block may precede the text
  // block); text deltas land before the final block-end.
  const protocol = chunks.slice(0, finishIndex).map(chunk => chunk.type)
  expect(protocol[0]).toBe('block-start')
  expect(protocol.filter(type => type === 'block-start').length)
    .toBe(protocol.filter(type => type === 'block-end').length)
  expect(protocol.filter(type => type === 'text-delta').length).toBeGreaterThan(0)
  expect(protocol.lastIndexOf('text-delta')).toBeLessThan(protocol.lastIndexOf('block-end'))
  expect(protocol.at(-1)).toBe('block-end')

  const text = chunks
    .filter((chunk): chunk is Extract<StreamChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
    .map(chunk => chunk.text)
    .join('')
  expect(text.toLowerCase()).toContain('pong')
  expect(reason.kind).toBe('stop')
}

describe.skipIf(!process.env.CURSOR_ACCESS_TOKEN)('llm-cursor e2e (real API)', () => {
  it('streams pong in protocol order through the real plugin and adapter', async () => {
    const chunks = await collect(await harness(), [user('Reply with exactly: pong')])
    assertTextStream(chunks)
  }, 120_000)

  it('completes a multi-turn conversation without a protocol error', async () => {
    const chunks = await collect(await harness(), [
      user('Say hello.'),
      assistant('Hello!'),
      user('Now reply with exactly: pong'),
    ])
    assertTextStream(chunks)
  }, 120_000)

  it('completes a tool-call and result cycle over the run protocol', async () => {
    const ctx = await harness()
    const sessionId = `cursor-native-tools-${Date.now()}` as never
    const tools = [{
      name: 'echo',
      description: 'Echo the message back',
      parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    }]
    const prompt = user("Call the echo tool with msg='ping' and then report exactly what it returned.")
    const first: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'cursor', model: MODEL, sessionId, messages: [prompt], tools })) {
      first.push(chunk)
    }
    expect(first.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
    const call = first.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    if (call?.type !== 'block-end' || call.block.type !== 'tool-call') throw new Error('real API did not emit a tool call')
    const second: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({
      provider: 'cursor',
      model: MODEL,
      sessionId,
      messages: [prompt, createToolResultMessage({ callId: call.block.id, content: [{ type: 'text', text: 'pong-echo' }], isError: false })],
      tools,
    })) {
      second.push(chunk)
    }
    expect(second.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    const text = second
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.text)
      .join('')
    expect(text).toContain('pong-echo')
  }, 180_000)
})
