#!/usr/bin/env node
/** Snapshot-only Loader driver for same-session latest-message revision. */

import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { createUserMessage, CallId, createMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'

const NAME = 'revision-snapshot-driver'
const configPath = process.argv[2]
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Awaited<ReturnType<typeof boot>> | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  const sessionId = SessionId('revision-snapshot-session')
  const session = ctx.sessions.create(sessionId)
  session.append('turn/start', { turn: 1 })
  const oldUser = createUserMessage({ content: [{ type: 'text', text: 'old user prompt' }], source: { kind: 'user' } })
  session.append('user/message', oldUser, { surfaceOp: 'append' })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'old' } })
  session.append('assistant/message', {
    turn: 1, step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: 'old assistant tail' }, { type: 'tool-call', id: CallId('old-tool'), name: 'old_tool', arguments: '{}' }],
      source: { kind: 'model', provider: 'mock', model: 'mock' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  let forkCalls = 0
  const originalFork = ctx.sessions.fork
  ctx.sessions.fork = ((...args: Parameters<typeof originalFork>) => {
    forkCalls++
    return originalFork(...args)
  }) as typeof originalFork
  const before = session.deriveMessages().flatMap(message => message.content)
  const replacement = createUserMessage({ content: [{ type: 'text', text: 'replacement prompt' }], source: { kind: 'user' } })
  await ctx.sessions.replaceLatestUserMessage(session, 1, oldUser.id, replacement, 'revision-snapshot-operation')
  const after = session.deriveMessages().flatMap(message => message.content)
  process.stdout.write(`${JSON.stringify({
    sessionId: session.id,
    childSessionIds: ctx.sessions.list().filter(candidate => candidate.header.parentSession === session.id).map(candidate => candidate.id),
    before,
    after,
    forkCalls,
  })}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
