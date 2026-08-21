/**
 * Serialize harness messages into Kimi for Code chat completions. User text is joined; assistant text
 * becomes `content`, tool calls become `tool_calls`, and tool results become separate tool messages.
 * Assistant reasoning is replayed as `reasoning_content` on every reasoning-carrying turn. Core image blocks are rejected explicitly because this wire route is text-only;
 * unknown declaration-merged block types retain the adapter's documented extension fallback.
 * @module dsh-llm-kimi/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { WireMessage, WireRequest, WireTool } from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'low' | 'high' | 'max' | undefined
}

/** Wire thinking family inferred from the requested model id. */
export type KimiReasoningFamily = 'k3' | 'k2-always' | 'k2-toggle'

/**
 * Classify a Kimi coding-API model id.
 *
 * - `k3` / `k3-256k` / `kimi-k3*`: always thinks; `reasoning_effort` is `low`/`high`/`max`.
 * - `kimi-for-coding*` and K2.7-code: thinking always on; no effort slider.
 * - remaining K2.x ids: `thinking.type` enabled/disabled (`off`/`high`).
 */
export function reasoningFamilyOf(model: string): KimiReasoningFamily {
  const id = model.trim().toLowerCase()
  if (id === 'k3' || id.startsWith('k3-') || id === 'kimi-k3' || id.startsWith('kimi-k3')) {
    return 'k3'
  }
  if (
    id === 'kimi-for-coding'
    || id.startsWith('kimi-for-coding-')
    || id.includes('k2.7')
    || id.includes('k2-7')
  ) {
    return 'k2-always'
  }
  return 'k2-toggle'
}

interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Map a harness effort onto the K3 coding-API `reasoning_effort` values. */
function k3WireEffort(effort: string): 'low' | 'high' | 'max' {
  switch (effort) {
    case 'low':
    case 'minimum':
    case 'light':
    case 'off':
      return 'low'
    case 'high':
    case 'medium':
      return 'high'
    case 'max':
    case 'ultra':
    case 'xhigh':
      return 'max'
    default:
      throw new LlmError(
        `Kimi K3 does not support reasoning effort "${effort}"`,
        'UNSUPPORTED_REASONING_EFFORT',
      )
  }
}

/** Validate the adapter-owned effort before resolving K2 toggle wire fields. */
function k2ToggleEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'high' {
  if (effort === 'off' || effort === 'high') {
    return effort as 'off' | 'high'
  }
  throw new LlmError(
    `Kimi does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair for the requested model family. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  const family = reasoningFamilyOf(options.model)
  if (family === 'k3') {
    // K3 always thinks. Titles still pay for reasoning, so use the cheapest legal effort.
    if (options.purpose === 'session-title') return { reasoningEffort: 'low' }
    const raw = options.reasoningEffort === undefined
      ? defaults.reasoningEffort ?? 'high'
      : String(options.reasoningEffort)
    return { reasoningEffort: k3WireEffort(raw) }
  }
  if (family === 'k2-always') {
    return { thinking: 'enabled' }
  }
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : k2ToggleEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `Kimi deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'high') return { thinking: 'enabled' }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The Kimi chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // CoT passback on every reasoning-carrying turn (same rule as llm-deepseek
    // after the missing-reasoning-content fix): gateways re-encoding the
    // conversation recover that turn's thinking signature from this field.
    ...reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but the chat-completions wire wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the chat-completions request body.
 */
export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) {
    messages.push({ role: 'system', content: options.system })
  }
  messages.push(...serializeMessages(options.messages))

  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  // A short title budget must produce visible text; conversation and
  // compaction calls continue to inherit the adapter's thinking defaults.
  const resolvedThinking = resolveThinking(options, defaults)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
    ...options.sessionId !== undefined ? { prompt_cache_key: String(options.sessionId) } : {},
  }
}
