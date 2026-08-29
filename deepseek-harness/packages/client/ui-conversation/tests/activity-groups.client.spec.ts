import { describe, expect, it } from 'vitest'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { groupActivityNodes } from '../src/client/chat/activity-groups.ts'

function node(key: string, kind: ChatNode['kind'], data: unknown): ChatNode {
  return { key, kind, data } as unknown as ChatNode
}

function tool(key: string, name: string): ChatNode {
  return node(key, 'tool-call', {
    root: { kind: 'tool-result', callId: key, call: { name }, content: [], subCalls: [] },
  })
}

function reasoning(key: string, status: 'running' | 'settled' = 'settled'): ChatNode {
  return node(key, 'assistant-step', { status, blocks: [{ kind: 'reasoning', text: 'thinking…' }] })
}

function reasoningWithToolCall(key: string): ChatNode {
  return node(key, 'assistant-step', {
    status: 'settled',
    blocks: [{ kind: 'reasoning', text: 'thinking…' }, { kind: 'tool-call', name: 'read' }],
  })
}

const anchors: readonly [string, ChatNode][] = [
  ['user message', node('user', 'user', {})],
  ['assistant text', node('assistant', 'assistant-step', {
    status: 'settled', blocks: [{ kind: 'text', text: 'done' }],
  })],
  ['compaction card', node('compaction', 'compaction', {})],
  ['milestone', node('milestone', 'milestone', {})],
  ['turn tail', node('tail', 'turn-tail', {})],
  ['context injection', node('context', 'context', {})],
]

describe('groupActivityNodes', () => {
  it('maps every activity category and reports exact counts', () => {
    const items = groupActivityNodes([
      tool('read', 'read'),
      tool('edit', 'edit'),
      tool('grep', 'grep'),
      tool('command', 'pwsh'),
      tool('web', 'web_fetch'),
      tool('subagent', 'subagent'),
      tool('other', 'custom_tool'),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'activity-group',
      counts: { explored: 1, edits: 1, searches: 1, commands: 1, web: 1, subagents: 1, other: 1 },
      running: false,
    })
  })

  it('retains a singleton activity node ungrouped', () => {
    const activity = tool('only', 'read')
    expect(groupActivityNodes([activity])).toEqual([activity])
  })

  it.each(anchors)('splits activity runs at a %s anchor', (_label, anchor) => {
    const items = groupActivityNodes([
      tool('before-1', 'read'), tool('before-2', 'edit'),
      anchor,
      tool('after-1', 'grep'), tool('after-2', 'bash'),
    ])

    expect(items.map(item => item.kind)).toEqual(['activity-group', anchor.kind, 'activity-group'])
    expect(items[1]).toBe(anchor)
    expect(items[0]).toMatchObject({ nodes: [{ key: 'before-1' }, { key: 'before-2' }] })
    expect(items[2]).toMatchObject({ nodes: [{ key: 'after-1' }, { key: 'after-2' }] })
  })

  it('returns an empty list for an empty node list', () => {
    expect(groupActivityNodes([])).toEqual([])
  })

  it('retains an all-anchor list unchanged', () => {
    const input = anchors.map(([, anchor]) => anchor)
    const output = groupActivityNodes(input)
    expect(output).toEqual(input)
    output.forEach((item, index) => { expect(item).toBe(input[index]) })
  })

  it('does not split one run at a reasoning-only step (regression: Think interleaved with tool calls)', () => {
    // Reproduces the reported transcript: 2 commands, a Think summary, 4 more commands —
    // must condense into ONE summary row, not two.
    const items = groupActivityNodes([
      tool('c1', 'pwsh'), tool('c2', 'pwsh'),
      reasoning('think-1'),
      tool('c3', 'pwsh'), tool('c4', 'pwsh'), tool('c5', 'pwsh'), tool('c6', 'pwsh'),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'activity-group', counts: { commands: 6 } })
    expect((items[0] as { nodes: readonly ChatNode[] }).nodes.map(n => n.key))
      .toEqual(['c1', 'c2', 'think-1', 'c3', 'c4', 'c5', 'c6'])
  })

  it('keeps a reasoning-only step in expansion order without counting it in any category', () => {
    const items = groupActivityNodes([tool('a', 'read'), reasoning('think'), tool('b', 'read')])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ counts: { explored: 2, other: 0 } })
  })

  it('marks the group running when an in-progress reasoning step is the only running node', () => {
    const items = groupActivityNodes([tool('a', 'read'), reasoning('think', 'running')])
    expect(items[0]).toMatchObject({ running: true })
  })

  it('counts a reasoning step that also carries an inline tool-call block as "other"', () => {
    const items = groupActivityNodes([tool('a', 'read'), reasoningWithToolCall('mixed'), tool('b', 'read')])
    expect(items[0]).toMatchObject({ counts: { explored: 2, other: 1 } })
  })

  it('renders an all-transparent run as individual nodes instead of an empty-header group', () => {
    const first = reasoning('think-1')
    const second = reasoning('think-2')
    const items = groupActivityNodes([first, second])
    expect(items).toEqual([first, second])
  })
})
