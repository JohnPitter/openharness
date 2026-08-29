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
})
