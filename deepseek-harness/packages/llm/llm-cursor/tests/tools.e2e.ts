import { afterEach, describe, expect, it } from 'vitest'
import { createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { CursorCloudAdapter } from '../src/cloud-adapter.ts'

const model = 'composer-2.5'
const sessionId = `cursor-tools-${Date.now()}`
const tools = [{
  name: 'echo',
  description: 'Echo the message',
  parameters: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
}]
const user = createUserMessage({
  content: [{ type: 'text', text: "Call the echo tool with msg='ping' and then report exactly what it returned." }],
  source: { kind: 'plugin', plugin: 'cursor-tools-e2e' },
})

describe.skipIf(!process.env.CURSOR_API_KEY)('Cursor custom tools e2e (real API)', () => {
  let adapter: CursorCloudAdapter | undefined
  afterEach(() => { adapter?.dispose() })

  it('completes the tool-call and result cycle', async () => {
    adapter = new CursorCloudAdapter(async () => process.env.CURSOR_API_KEY!, () => ({}))
    const first: ReturnType<CursorCloudAdapter['stream']> = adapter.stream({ provider: 'cursor', model, sessionId, messages: [user], tools })
    const firstChunks = []
    for await (const chunk of first) {
      firstChunks.push(chunk)
      console.log('chunk1', JSON.stringify(chunk))
      if (chunk.type === 'finish') break
    }
    const finish = firstChunks.at(-1)
    expect(finish).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
    const call = firstChunks.find(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    expect(call?.type).toBe('block-end')
    if (call?.type !== 'block-end' || call.block.type !== 'tool-call') throw new Error('real API did not emit a tool call')
    const secondChunks = []
    for await (const chunk of adapter.stream({ provider: 'cursor', model, sessionId, messages: [user, createToolResultMessage({ callId: call.block.id, content: [{ type: 'text', text: 'pong-echo' }], isError: false })], tools })) {
      secondChunks.push(chunk)
      console.log('chunk2', JSON.stringify(chunk))
    }
    expect(secondChunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    const text = secondChunks.filter((chunk): chunk is Extract<typeof chunk, { type: 'text-delta' }> => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
    expect(text).toContain('pong-echo')
  }, 180_000)
})
