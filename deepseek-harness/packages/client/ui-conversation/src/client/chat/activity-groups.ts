import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

export type ActivityCategory =
  | 'context' | 'explored' | 'edits' | 'searches' | 'commands' | 'web' | 'subagents' | 'other'

export interface ActivityCounts {
  readonly context: number
  readonly explored: number
  readonly edits: number
  readonly searches: number
  readonly commands: number
  readonly web: number
  readonly subagents: number
  readonly other: number
}

export interface ActivityGroup {
  readonly kind: 'activity-group'
  readonly key: string
  readonly nodes: readonly ChatNode[]
  readonly counts: ActivityCounts
  readonly running: boolean
  /** Sum of `counts`; zero means every node in the run was transparent
   *  (e.g. reasoning-only), so the group carries no header to show. */
  readonly total: number
}

export type GroupedChatItem = ChatNode | ActivityGroup

function emptyCounts(): Record<ActivityCategory, number> {
  return { context: 0, explored: 0, edits: 0, searches: 0, commands: 0, web: 0, subagents: 0, other: 0 }
}

function toolCategory(name: string): ActivityCategory {
  if (/subagent|delegate|agent/i.test(name)) return 'subagents'
  if (name === 'web_fetch') return 'web'
  if (name === 'read' || name.includes('cordis') && name.includes('inspect')) return 'explored'
  if (name === 'write' || name === 'edit') return 'edits'
  if (name === 'grep' || name === 'glob' || name === 'web_search') return 'searches'
  if (name === 'bash' || name === 'pwsh' || name === 'run_code') return 'commands'
  return 'other'
}

/**
 * Classifies a node for activity grouping.
 *
 * `category: null` marks a *transparent* activity node: it stays inside the
 * run (so it does not split one turn's work into several summary rows) and
 * renders in its original position when the group expands, but contributes
 * no count to the header. A reasoning-only Assistant step (no `text`, no
 * `tool-call` block) is the motivating case — Think summaries interleaved
 * between tool calls must not break the run into separate collapsed rows.
 */
function activityOf(node: ChatNode): { category: ActivityCategory | null; running: boolean } | null {
  if (node.kind === 'tool-call') {
    const root = node.data.root
    const name = isRunningTool(root) ? root.name : (root.call?.name ?? '')
    return { category: toolCategory(name), running: isRunningTool(root) }
  }
  if (node.kind === 'command') {
    return { category: 'commands', running: node.data.outcome === null }
  }
  if (node.kind === 'context') {
    // Logged, already-resolved content (system prompt, skill catalog, a
    // recalled session) — never running, but groupable like any other
    // activity so consecutive injections condense into one row instead of
    // each showing its own collapsed ContextInjectionRow.
    return { category: 'context', running: false }
  }
  if (node.kind === 'assistant-step') {
    const blocks = node.data.blocks
    // A visible text block is the assistant's final reply for the step: it
    // anchors like a normal message and must break the run.
    if (blocks.length === 0 || blocks.some(block => block.kind === 'text')) return null
    const hasToolCall = blocks.some(block => block.kind === 'tool-call')
    return { category: hasToolCall ? 'other' : null, running: node.data.status === 'running' }
  }
  return null
}

function makeGroup(nodes: readonly ChatNode[]): ActivityGroup {
  const counts = emptyCounts()
  let running = false
  let total = 0
  for (const node of nodes) {
    const activity = activityOf(node)
    if (activity === null) continue
    if (activity.category !== null) {
      counts[activity.category] += 1
      total += 1
    }
    running ||= activity.running
  }
  return {
    kind: 'activity-group',
    key: `activity:${nodes[0]?.key ?? ''}`,
    nodes,
    counts: { ...counts },
    running,
    total,
  }
}

/**
 * Group consecutive root activity rows, retaining anchors and singleton rows.
 *
 * A run that reduces to zero category counts (every node in it was
 * transparent, e.g. back-to-back reasoning-only steps with no tool call
 * between them) renders its nodes individually instead of a header-less
 * summary row.
 */
export function groupActivityNodes(nodes: readonly ChatNode[]): readonly GroupedChatItem[] {
  const result: GroupedChatItem[] = []
  let run: ChatNode[] = []
  const flush = (): void => {
    if (run.length >= 2) {
      const group = makeGroup(run)
      if (group.total > 0) result.push(group)
      else result.push(...run)
    } else if (run.length === 1) {
      result.push(run[0] as ChatNode)
    }
    run = []
  }
  for (const node of nodes) {
    if (activityOf(node) === null) { flush(); result.push(node) }
    else run.push(node)
  }
  flush()
  return result
}
