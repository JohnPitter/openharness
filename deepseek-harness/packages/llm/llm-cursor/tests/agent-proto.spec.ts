import { describe, expect, it } from 'vitest'
import {
  decodeClientFrame, decodeServerFrame, decodeUsableModelsResponse, encodeMcpResult,
  encodeRequestContextResult, encodeRunRequest, encodeServerFrame, encodeUsableModelsRequest,
  encodeUsableModelsResponse,
} from '../src/agent-proto.ts'

describe('encodeRunRequest', () => {
  it('encodes the opening run message with tools and system prompt append', () => {
    const bytes = encodeRunRequest({
      conversationId: 'conv',
      userMessageId: 'msg',
      userText: 'hello',
      modelId: 'composer-2.5',
      modelDisplayName: 'Composer 2.5',
      customSystemPrompt: 'be brief',
      tools: [{ name: 'get_weather', description: 'Get weather.', inputSchemaJson: '{"type":"object"}' }],
    })
    const decoded = decodeClientFrame(bytes) as {
      runRequest?: {
        conversationId?: string
        action?: { userMessageAction?: { userMessage?: { text?: string; messageId?: string } } }
        modelDetails?: { modelId?: string; displayName?: string }
        requestedModel?: { modelId?: string; builtInModel?: boolean }
        systemPromptSpec?: { append?: string }
        mcpTools?: { mcpTools?: Array<{ name?: string; providerIdentifier?: string; inputSchemaJson?: string }> }
      }
    }
    expect(decoded.runRequest?.conversationId).toBe('conv')
    expect(decoded.runRequest?.action?.userMessageAction?.userMessage).toEqual({ text: 'hello', messageId: 'msg' })
    expect(decoded.runRequest?.modelDetails).toEqual({ modelId: 'composer-2.5', displayName: 'Composer 2.5' })
    expect(decoded.runRequest?.requestedModel).toEqual({ modelId: 'composer-2.5', builtInModel: true })
    expect(decoded.runRequest?.systemPromptSpec?.append).toBe('be brief')
    expect(decoded.runRequest?.mcpTools?.mcpTools?.[0]).toMatchObject({
      name: 'get_weather', providerIdentifier: 'openharness', inputSchemaJson: '{"type":"object"}',
    })
  })
})

describe('decodeServerFrame', () => {
  it('decodes text, thinking, and turn-ended interaction updates', () => {
    expect(decodeServerFrame(encodeServerFrame({ interactionUpdate: { textDelta: { text: 'hi' } } })))
      .toEqual({ kind: 'interaction', update: { kind: 'text', text: 'hi', isServerNotice: false } })
    expect(decodeServerFrame(encodeServerFrame({ interactionUpdate: { thinkingDelta: { text: 'hm' } } })))
      .toEqual({ kind: 'interaction', update: { kind: 'thinking', text: 'hm' } })
    expect(decodeServerFrame(encodeServerFrame({ interactionUpdate: { turnEnded: { inputTokens: 9, outputTokens: 2 } } })))
      .toEqual({ kind: 'interaction', update: { kind: 'turn-ended', inputTokens: 9, outputTokens: 2 } })
  })

  it('decodes heartbeats as ignorable updates', () => {
    expect(decodeServerFrame(encodeServerFrame({ interactionUpdate: { heartbeat: new Uint8Array(0) } })))
      .toEqual({ kind: 'interaction', update: { kind: 'heartbeat' } })
  })

  it('decodes request-context and mcp exec requests', () => {
    expect(decodeServerFrame(encodeServerFrame({ execServerMessage: { id: 5, requestContextArgs: {} } })))
      .toEqual({ kind: 'exec', request: { kind: 'request-context', execId: 5 } })
    expect(decodeServerFrame(encodeServerFrame({
      execServerMessage: {
        id: 6,
        mcpArgs: {
          name: 'get_weather',
          toolCallId: 'call_1',
          args: {
            city: { stringValue: 'Lisbon' },
            count: { numberValue: 2 },
            flags: { boolValue: true },
            nested: { structValue: { fields: { a: { stringValue: 'b' } } } },
            list: { listValue: { values: [{ numberValue: 1 }] } },
          },
        },
      },
    }))).toEqual({
      kind: 'exec',
      request: {
        kind: 'mcp-call',
        execId: 6,
        callId: 'call_1',
        name: 'get_weather',
        argsJson: '{"city":"Lisbon","count":2,"flags":true,"nested":{"a":"b"},"list":[1]}',
      },
    })
  })
})

describe('exec result encoders', () => {
  it('encodes the request-context answer', () => {
    const decoded = decodeClientFrame(encodeRequestContextResult(5, { osVersion: 'win32', shell: 'pwsh', timeZone: 'UTC' })) as {
      execClientMessage?: { id?: number; requestContextResult?: { success?: { requestContext?: { env?: { shell?: string } } } } }
    }
    expect(decoded.execClientMessage?.id).toBe(5)
    expect(decoded.execClientMessage?.requestContextResult?.success?.requestContext?.env?.shell).toBe('pwsh')
  })

  it('encodes mcp success and error results', () => {
    const success = decodeClientFrame(encodeMcpResult(3, { text: '22C', isError: false })) as {
      execClientMessage?: { id?: number; mcpResult?: { success?: { content?: Array<{ text?: { text?: string } }> } } }
    }
    expect(success.execClientMessage?.id).toBe(3)
    expect(success.execClientMessage?.mcpResult?.success?.content?.[0]?.text?.text).toBe('22C')
    const failure = decodeClientFrame(encodeMcpResult(4, { text: 'denied', isError: true })) as {
      execClientMessage?: { mcpResult?: { error?: { error?: string } } }
    }
    expect(failure.execClientMessage?.mcpResult?.error?.error).toBe('denied')
  })
})

describe('usable models', () => {
  it('round-trips the unary listing', () => {
    const bytes = encodeUsableModelsResponse([
      { modelId: 'a', displayName: 'Model A' }, { modelId: 'b' },
    ])
    expect(decodeUsableModelsResponse(bytes)).toEqual([
      { modelId: 'a', displayName: 'Model A' }, { modelId: 'b' },
    ])
  })

  it('encodes an empty listing request', () => {
    expect(encodeUsableModelsRequest()).toHaveLength(0)
  })
})
