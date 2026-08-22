import { describe, expect, it } from 'vitest'
import { ReasoningEffortId, createUserMessage, createMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { reasoningFamilyOf, serializeMessages, serializeRequest } from '../src/serialize.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'kimi-for-coding',
    model: 'kimi-for-coding',
    messages: [
      createUserMessage({
        content: [{ type: 'text', text: 'hi' }],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ],
    ...overrides,
  }
}

describe('reasoningFamilyOf', () => {
  it('classifies K3 coding-API ids', () => {
    expect(reasoningFamilyOf('k3-256k')).toBe('k3')
    expect(reasoningFamilyOf('k3')).toBe('k3')
    expect(reasoningFamilyOf('kimi-k3')).toBe('k3')
  })

  it('classifies always-on K2.7 code ids', () => {
    expect(reasoningFamilyOf('kimi-for-coding')).toBe('k2-always')
    expect(reasoningFamilyOf('kimi-for-coding-highspeed')).toBe('k2-always')
  })

  it('treats remaining ids as a thinking toggle', () => {
    expect(reasoningFamilyOf('kimi-k2.6')).toBe('k2-toggle')
  })
})

describe('serializeRequest K3', () => {
  it('emits reasoning_effort low/high/max and never thinking', () => {
    const wire = serializeRequest(
      request({ model: 'k3-256k', reasoningEffort: ReasoningEffortId('max') }),
      { reasoningEffort: 'high' },
    )
    expect(wire.reasoning_effort).toBe('max')
    expect(wire.thinking).toBeUndefined()
  })

  it('defaults omitted K3 effort to high', () => {
    const wire = serializeRequest(request({ model: 'k3-256k' }))
    expect(wire.reasoning_effort).toBe('high')
    expect(wire.thinking).toBeUndefined()
  })

  it('maps leftover off onto K3 low', () => {
    const wire = serializeRequest(
      request({ model: 'k3-256k', reasoningEffort: ReasoningEffortId('off') }),
    )
    expect(wire.reasoning_effort).toBe('low')
  })

  it('uses low effort for session titles', () => {
    const wire = serializeRequest(
      request({
        model: 'k3-256k',
        purpose: 'session-title',
        reasoningEffort: ReasoningEffortId('max'),
      }),
    )
    expect(wire.reasoning_effort).toBe('low')
    expect(wire.thinking).toBeUndefined()
  })

  it('uses low effort for compaction on K3', () => {
    const wire = serializeRequest(
      request({
        model: 'k3-256k',
        purpose: 'compaction',
        reasoningEffort: ReasoningEffortId('max'),
      }),
    )
    expect(wire.reasoning_effort).toBe('low')
  })
})

describe('serializeRequest K2', () => {
  it('maps high/off onto the thinking toggle without reasoning_effort', () => {
    const on = serializeRequest(
      request({ model: 'kimi-k2.6', reasoningEffort: ReasoningEffortId('high') }),
      { thinking: 'enabled' },
    )
    expect(on.thinking).toEqual({ type: 'enabled' })
    expect(on.reasoning_effort).toBeUndefined()

    const off = serializeRequest(
      request({ model: 'kimi-k2.6', reasoningEffort: ReasoningEffortId('off') }),
      { thinking: 'enabled' },
    )
    expect(off.thinking).toEqual({ type: 'disabled' })
    expect(off.reasoning_effort).toBeUndefined()
  })

  it('disables thinking for compaction on K2-toggle models', () => {
    const wire = serializeRequest(
      request({
        model: 'kimi-k2.6',
        purpose: 'compaction',
        reasoningEffort: ReasoningEffortId('high'),
      }),
      { thinking: 'enabled' },
    )
    expect(wire.thinking).toEqual({ type: 'disabled' })
  })

  it('keeps K2.7 code thinking enabled', () => {
    const wire = serializeRequest(
      request({ model: 'kimi-for-coding', reasoningEffort: ReasoningEffortId('off') }),
    )
    expect(wire.thinking).toEqual({ type: 'enabled' })
    expect(wire.reasoning_effort).toBeUndefined()
  })
})

describe('serializeMessages', () => {
  it('passes reasoning_content back on tool-call-free turns', () => {
    const wire = serializeMessages([
      createMessage({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking…' },
          { type: 'text', text: 'answer' },
        ],
        source: { kind: 'plugin', plugin: 'test' },
      }),
    ])
    expect(wire).toEqual([{ role: 'assistant', content: 'answer', reasoning_content: 'thinking…' }])
  })
})
