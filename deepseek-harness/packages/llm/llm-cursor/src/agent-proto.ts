/**
 * Reflection access to the sparse `agent.v1` schema in `proto/agent.proto`.
 *
 * The AgentService `Run` RPC is the live Cursor chat path: the deprecated
 * `aiserver.v1.ChatService` stream endpoints are rejected server-side, so the
 * native adapter speaks the agent protocol the cursor-agent client uses —
 * one BiDi Connect stream per turn, with the server issuing exec RPCs
 * (`request_context_args`, `mcp_args`) the client must answer mid-stream.
 *
 * @module @deepseek-ai/dsh-llm-cursor/agent-proto
 */

import protobuf from 'protobufjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const protoPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'proto', 'agent.proto')
const source = readFileSync(protoPath, 'utf8')
const root = protobuf.parse(source, { keepCase: false }).root

const clientMessageType = root.lookupType('agent.v1.AgentClientMessage')
const serverMessageType = root.lookupType('agent.v1.AgentServerMessage')
const modelsRequestType = root.lookupType('agent.v1.GetUsableModelsRequest')
const modelsResponseType = root.lookupType('agent.v1.GetUsableModelsResponse')

/** One model row from `GetUsableModels`, the fields the picker catalog needs. */
export interface AgentUsableModel {
  modelId?: string | undefined
  displayName?: string | undefined
  displayModelId?: string | undefined
  aliases?: string[] | undefined
  maxMode?: boolean | undefined
}

/** Encode one `GetUsableModelsRequest`; the empty request lists every usable model. */
export function encodeUsableModelsRequest(): Uint8Array {
  return modelsRequestType.encode(modelsRequestType.fromObject({})).finish()
}

/**
 * Decode a unary `GetUsableModelsResponse` body.
 * @param body - raw `application/proto` response bytes.
 * @returns usable model rows in backend order.
 */
export function decodeUsableModelsResponse(body: Uint8Array): AgentUsableModel[] {
  const decoded = modelsResponseType.toObject(modelsResponseType.decode(body), { defaults: false })
  const models = (decoded as { models?: AgentUsableModel[] }).models
  return models ?? []
}

/** JSON-shaped tool definition accepted by {@link AgentRunRequestInput}. */
export interface AgentToolDefinition {
  name: string
  description: string
  inputSchemaJson: string
}

/** Fields of the opening `run_request` frame of a turn. */
export interface AgentRunRequestInput {
  conversationId: string
  userMessageId: string
  userText: string
  modelId: string
  modelDisplayName: string
  customSystemPrompt?: string | undefined
  tools: AgentToolDefinition[]
}

/** Encode the first frame of a run: the user action for the current turn. */
export function encodeRunRequest(input: AgentRunRequestInput): Uint8Array {
  const runRequest: Record<string, unknown> = {
    conversationState: {},
    action: {
      userMessageAction: {
        userMessage: { text: input.userText, messageId: input.userMessageId },
      },
    },
    modelDetails: { modelId: input.modelId, displayName: input.modelDisplayName },
    requestedModel: { modelId: input.modelId, builtInModel: true },
    conversationId: input.conversationId,
    ...(input.customSystemPrompt === undefined ? {} : { systemPromptSpec: { append: input.customSystemPrompt } }),
    ...(input.tools.length === 0
      ? {}
      : {
          mcpTools: {
            mcpTools: input.tools.map(tool => ({
              name: tool.name,
              description: tool.description,
              providerIdentifier: 'openharness',
              toolName: tool.name,
              inputSchemaJson: tool.inputSchemaJson,
            })),
          },
        }),
  }
  return clientMessageType.encode(clientMessageType.fromObject({ runRequest })).finish()
}

/**
 * Convert a decoded `google.protobuf.Value` tree (protobufjs camelCase keys)
 * back into plain JSON. MCP tool arguments arrive in this shape.
 */
function valueToJson(value: Record<string, unknown>): unknown {
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('numberValue' in value) return Number(value.numberValue)
  if ('boolValue' in value) return value.boolValue
  if ('structValue' in value) {
    const fields = (value.structValue as { fields?: Record<string, Record<string, unknown>> }).fields ?? {}
    const out: Record<string, unknown> = {}
    for (const [key, fieldValue] of Object.entries(fields)) out[key] = valueToJson(fieldValue)
    return out
  }
  if ('listValue' in value) {
    const values = (value.listValue as { values?: Record<string, unknown>[] }).values ?? []
    return values.map(valueToJson)
  }
  return null
}

/** One decoded exec request the client must answer to keep the turn alive. */
export type AgentExecRequest =
  | { kind: 'request-context'; execId: number }
  | { kind: 'mcp-call'; execId: number; callId: string; name: string; argsJson: string }

/** Decoded turn update inside an `interaction_update` frame. */
export type AgentInteractionUpdate =
  | { kind: 'text'; text: string; isServerNotice: boolean }
  | { kind: 'thinking'; text: string }
  | { kind: 'heartbeat' }
  | {
    kind: 'turn-ended'
    inputTokens?: number | undefined
    outputTokens?: number | undefined
    cacheWriteTokens?: number | undefined
    cacheReadTokens?: number | undefined
  }

/** One decoded server frame of the run stream. */
export type AgentServerFrame =
  | { kind: 'interaction'; update: AgentInteractionUpdate }
  | { kind: 'exec'; request: AgentExecRequest }
  | { kind: 'other' }

/**
 * Decode one server data frame.
 * @param payload - the framed `AgentServerMessage` bytes.
 * @returns the frame's actionable content, or `other` for frames the adapter ignores.
 */
export function decodeServerFrame(payload: Uint8Array): AgentServerFrame {
  const decoded = serverMessageType.toObject(serverMessageType.decode(payload), {
    defaults: false,
    longs: Number,
  }) as {
    interactionUpdate?: {
      textDelta?: { text?: string; isServerNotice?: boolean }
      thinkingDelta?: { text?: string }
      heartbeat?: unknown
      turnEnded?: {
        inputTokens?: number
        outputTokens?: number
        cacheWriteTokens?: number
        cacheReadTokens?: number
      }
    }
    execServerMessage?: {
      id?: number
      requestContextArgs?: unknown
      mcpArgs?: {
        name?: string
        args?: Record<string, Record<string, unknown>>
        toolCallId?: string
      }
    }
  }
  const exec = decoded.execServerMessage
  if (exec !== undefined) {
    const execId = exec.id ?? 0
    if (exec.requestContextArgs !== undefined) return { kind: 'exec', request: { kind: 'request-context', execId } }
    if (exec.mcpArgs !== undefined) {
      const args: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(exec.mcpArgs.args ?? {})) args[key] = valueToJson(value)
      return {
        kind: 'exec',
        request: {
          kind: 'mcp-call',
          execId,
          callId: exec.mcpArgs.toolCallId ?? '',
          name: exec.mcpArgs.name ?? '',
          argsJson: JSON.stringify(args),
        },
      }
    }
    return { kind: 'other' }
  }
  const update = decoded.interactionUpdate
  if (update === undefined) return { kind: 'other' }
  if (update.textDelta !== undefined) {
    return {
      kind: 'interaction',
      update: { kind: 'text', text: update.textDelta.text ?? '', isServerNotice: update.textDelta.isServerNotice === true },
    }
  }
  if (update.thinkingDelta !== undefined) {
    return { kind: 'interaction', update: { kind: 'thinking', text: update.thinkingDelta.text ?? '' } }
  }
  if (update.turnEnded !== undefined) {
    return {
      kind: 'interaction',
      update: {
        kind: 'turn-ended',
        inputTokens: update.turnEnded.inputTokens,
        outputTokens: update.turnEnded.outputTokens,
        cacheWriteTokens: update.turnEnded.cacheWriteTokens,
        cacheReadTokens: update.turnEnded.cacheReadTokens,
      },
    }
  }
  return { kind: 'interaction', update: { kind: 'heartbeat' } }
}

/** Encode the answer to a `request_context_args` exec request: a minimal, tool-less context. */
export function encodeRequestContextResult(execId: number, env: { osVersion: string; shell: string; timeZone: string }): Uint8Array {
  return clientMessageType.encode(clientMessageType.fromObject({
    execClientMessage: {
      id: execId,
      requestContextResult: {
        success: {
          requestContext: {
            env: { osVersion: env.osVersion, workspacePaths: [], shell: env.shell, timeZone: env.timeZone },
            webSearchEnabled: false,
          },
        },
      },
    },
  })).finish()
}

/** Encode one MCP tool result answering an `mcp_args` exec request. */
export function encodeMcpResult(execId: number, result: { text: string; isError: boolean }): Uint8Array {
  return clientMessageType.encode(clientMessageType.fromObject({
    execClientMessage: {
      id: execId,
      mcpResult: result.isError
        ? { error: { error: result.text } }
        : { success: { content: [{ text: { text: result.text } }], isError: false } },
    },
  })).finish()
}

/**
 * Encode one `AgentServerMessage` — test-fixture support (the way
 * `trailerFrame` fixtures Connect trailers); production only decodes these.
 */
export function encodeServerFrame(value: { [k: string]: unknown }): Uint8Array {
  return serverMessageType.encode(serverMessageType.fromObject(value)).finish()
}

/** Decode one client frame — test-fixture support for asserting what the adapter wrote. */
export function decodeClientFrame(payload: Uint8Array): unknown {
  return clientMessageType.toObject(clientMessageType.decode(payload), { defaults: false })
}

/** Encode one `GetUsableModelsResponse` — test-fixture support for the catalog listing. */
export function encodeUsableModelsResponse(models: AgentUsableModel[]): Uint8Array {
  return modelsResponseType.encode(modelsResponseType.fromObject({ models })).finish()
}
