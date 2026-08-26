import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
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

  const protocol = chunks.slice(0, finishIndex).map(chunk => chunk.type)
  expect(protocol[0]).toBe('block-start')
  expect(protocol.at(-1)).toBe('block-end')
  expect(protocol.filter(type => type === 'text-delta').length).toBeGreaterThan(0)
  expect(protocol.indexOf('text-delta')).toBeGreaterThan(protocol.indexOf('block-start'))
  expect(protocol.lastIndexOf('text-delta')).toBeLessThan(protocol.indexOf('block-end'))

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
})
