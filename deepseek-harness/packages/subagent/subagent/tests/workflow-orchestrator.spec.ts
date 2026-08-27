import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  applyChildComposition,
  resolveChildAgentOptions,
  restrictWorkflowOrchestrator,
  WorkflowWorkerRequiredError,
  WORKFLOW_WORKER_PERSONA,
} from '../src/child-agent.ts'

async function mount(preset = 'workflow'): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  ctx.provide('agentPresets', {
    composedPreset: () => preset,
    composeFrom: () => undefined,
  })
  return ctx
}

async function mint(ctx: Context, name: string): Promise<Agent> {
  const agent = {
    id: name as SessionId,
    options: {},
    session: { header: {} },
  } as Agent
  let inner!: ReturnType<typeof createScope>
  await ctx.plugin(Object.assign((scoped: Context) => {
    inner = createScope(scoped, agent)
    Object.assign(agent, { ctx: inner.ctx })
  }, { inject: ['tools', 'systemPrompt'] }))
  return agent
}

function tool(name: string): ToolDefinition {
  return {
    name,
    description: `tool ${name}`,
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value as string }],
    },
    execute: (): Promise<string> => Promise.resolve(name),
  }
}

describe('workflow orchestrator tool restriction', () => {
  it('hides work, skill, ralph, and fork tools from a root workflow agent and leaves a sibling child catalog intact', async () => {
    const ctx = await mount()
    ctx.tools.register(tool('grep'))
    ctx.tools.register(tool('edit'))
    ctx.tools.register(tool('milestone_write'))
    ctx.tools.register(tool('subagent'))
    ctx.tools.register(tool('skill'))
    ctx.tools.register(tool('ralph'))
    ctx.tools.register(tool('subagent_fork'))
    const parent = await mint(ctx, 'parent')
    const child = await mint(ctx, 'child')
    Object.assign(child, { options: { subagentDepth: 1 }, session: { header: { delegationDepth: 1 } } })

    restrictWorkflowOrchestrator(parent)
    restrictWorkflowOrchestrator(child)

    expect(ctx.tools.schemas(parent).map(schema => schema.name).sort()).toEqual(['subagent'])
    expect(ctx.tools.schemas(child).map(schema => schema.name).sort()).toEqual([
      'edit', 'grep', 'milestone_write', 'ralph', 'skill', 'subagent', 'subagent_fork',
    ])
  })

  it('does not restrict a non-workflow agent', async () => {
    const ctx = await mount('standard')
    ctx.tools.register(tool('grep'))
    const agent = await mint(ctx, 'root')
    restrictWorkflowOrchestrator(agent)
    expect(ctx.tools.schemas(agent).map(schema => schema.name)).toEqual(['grep'])
  })

  it('tells the worker to gather information and apply changes', () => {
    expect(WORKFLOW_WORKER_PERSONA).toMatch(/grep/)
    expect(WORKFLOW_WORKER_PERSONA).toMatch(/edit/)
    expect(WORKFLOW_WORKER_PERSONA).toMatch(/coding-standard excerpts/)
    expect(WORKFLOW_WORKER_PERSONA).toMatch(/milestone_write/)
    expect(WORKFLOW_WORKER_PERSONA).not.toMatch(/orchestrator/i)
  })

  it('shadows the orchestrator persona on a workflow child unless the request names one', async () => {
    const ctx = await mount()
    const parent = await mint(ctx, 'parent')
    const child = await mint(ctx, 'child')
    applyChildComposition(child.ctx, parent, {})
    const assembled = await child.ctx.systemPrompt.assemble({ scope: child })
    expect(assembled.sections.some(section => section.text === WORKFLOW_WORKER_PERSONA)).toBe(true)

    const named = await mint(ctx, 'named')
    applyChildComposition(named.ctx, parent, { persona: 'You are the named child.' })
    const namedAssembled = await named.ctx.systemPrompt.assemble({ scope: named })
    expect(namedAssembled.sections.some(section => section.text === 'You are the named child.')).toBe(true)
    expect(namedAssembled.sections.some(section => section.text === WORKFLOW_WORKER_PERSONA)).toBe(false)
  })
})

describe('workflow worker route inherit', () => {
  it('refuses to inherit a request-metered planner when no worker is selected', async () => {
    const ctx = await mount()
    ctx.provide('llm', { providerMetering: (provider: string) => provider === 'zai' ? 'requests' : 'tokens' })
    const parent = await mint(ctx, 'parent')
    Object.assign(parent, { options: { provider: 'zai', model: 'glm-4.5' } })
    expect(() => resolveChildAgentOptions(parent, undefined, 1)).toThrow(WorkflowWorkerRequiredError)
  })

  it('inherits a token-metered planner when the worker chip is empty', async () => {
    const ctx = await mount()
    ctx.provide('llm', { providerMetering: () => 'tokens' })
    const parent = await mint(ctx, 'parent')
    Object.assign(parent, { options: { provider: 'deepseek-official', model: 'deepseek-chat' } })
    expect(resolveChildAgentOptions(parent, undefined, 1)).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
      subagentDepth: 1,
    })
  })

  it('uses the explicit worker even when the planner is request-metered', async () => {
    const ctx = await mount()
    ctx.provide('llm', { providerMetering: () => 'requests' })
    ctx.provide('agentDefaultModel', {
      currentWorkerSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
    })
    const parent = await mint(ctx, 'parent')
    Object.assign(parent, { options: { provider: 'zai', model: 'glm-4.5' } })
    expect(resolveChildAgentOptions(parent, undefined, 1)).toMatchObject({
      provider: 'deepseek-official',
      model: 'deepseek-chat',
    })
  })

  it('keeps a requested child provider even when the planner is request-metered', async () => {
    const ctx = await mount()
    ctx.provide('llm', { providerMetering: () => 'requests' })
    const parent = await mint(ctx, 'parent')
    Object.assign(parent, { options: { provider: 'zai', model: 'glm-4.5' } })
    expect(resolveChildAgentOptions(parent, { provider: 'openai', model: 'gpt-5' }, 1)).toMatchObject({
      provider: 'openai',
      model: 'gpt-5',
    })
  })
})
