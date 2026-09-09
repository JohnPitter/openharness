import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { DONE } from '../src/sse.ts'
import { translate } from '../src/translate.ts'

async function* feed(...payloads: (string | object)[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

/** The live first-chunk signature: role + null content + EMPTY reasoning. */
const firstChunk = { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] }

describe('translate: defensive tool-call branches', () => {
  it('handles deltas that never carry id or name (empty-string fallbacks)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      // Hypothetical lenient wire: argument fragments with no id/name at all.
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: '', name: '', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })
})

describe('translate: tool-call identity across deltas', () => {
  it('keeps the established identity when continuation deltas re-send it empty', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_x', type: 'function', function: { name: 'get_weather', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: '', type: 'function', function: { name: '', arguments: '{"city"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: '', type: 'function', function: { name: '', arguments: ': "Paris"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toEqual([{
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_00_x', name: 'get_weather', arguments: '{"city": "Paris"}' },
    }])
  })

  it('keeps the established identity when continuation deltas re-send it null', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Glob', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: null, function: { name: null, arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toEqual([{
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_1', name: 'Glob', arguments: '{}' },
    }])
  })

  it('re-sending the same non-empty identity does not duplicate it', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Glob', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'Glob', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toEqual([{
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_1', name: 'Glob', arguments: '{}' },
    }])
  })

  it('maintains each parallel call identity separately under empty continuation deltas', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      {
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'a', type: 'function', function: { name: 'one', arguments: '' } },
              { index: 1, id: 'b', type: 'function', function: { name: 'two', arguments: '' } },
            ],
          },
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [
              { index: 1, id: '', function: { name: '', arguments: '{"b":1}' } },
              { index: 0, id: '', function: { name: '', arguments: '{"a":1}' } },
            ],
          },
        }],
      },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-end')).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'a', name: 'one', arguments: '{"a":1}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'b', name: 'two', arguments: '{"b":1}' } },
    ])
  })
})
