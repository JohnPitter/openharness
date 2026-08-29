import type { ChatNode } from '../contract/chat-nodes.ts'
import { isRunningTool } from '../contract/chat-nodes.ts'

export type ActivityCategory =
  | 'explored' | 'edits' | 'searches' | 'commands' | 'web' | 'subagents' | 'other'

export interface ActivityCounts {
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
}

export type GroupedChatItem = ChatNode | ActivityGroup

function emptyCounts(): Record<ActivityCategory, number> {
  return { explored: 0, edits: 0, searches: 0, commands: 0, web: 0, subagents: 0, other: 0 }
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

function activityOf(node: ChatNode): { category: ActivityCategory; running: boolean } | null {
  if (node.kind === 'tool-call') {
    const root = node.data.root
    const name = isRunningTool(root) ? root.name : (root.call?.name ?? '')
    return { category: toolCategory(name), running: isRunningTool(root) }
  }
  if (node.kind === 'command') {
    return { category: 'commands', running: node.data.outcome === null }
  }
  if (node.kind === 'assistant-step') {
    const blocks = node.data.blocks
    if (blocks.length === 0 || blocks.some(block => block.kind !== 'tool-call')) return null
    return { category: 'other', running: node.data.status === 'running' }
  }
  return null
}

function makeGroup(nodes: readonly ChatNode[]): ActivityGroup {
  const counts = emptyCounts()
  let running = false
  for (const node of nodes) {
    const activity = activityOf(node)
    if (activity === null) continue
    counts[activity.category] += 1
    running ||= activity.running
  }
  return {
    kind: 'activity-group',
    key: `activity:${nodes[0]?.key ?? ''}`,
    nodes,
    counts: { ...counts },
    running,
  }
}

/** Group consecutive root activity rows, retaining anchors and singleton rows. */
export function groupActivityNodes(nodes: readonly ChatNode[]): readonly GroupedChatItem[] {
  const result: GroupedChatItem[] = []
  let run: ChatNode[] = []
  const flush = (): void => {
    if (run.length >= 2) result.push(makeGroup(run))
    else if (run.length === 1) result.push(run[0] as ChatNode)
    run = []
  }
  for (const node of nodes) {
    if (activityOf(node) === null) { flush(); result.push(node) }
    else run.push(node)
  }
  flush()
  return result
}
