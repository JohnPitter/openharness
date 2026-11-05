import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished } from 'vitest'
import SkillRegistry, { isModelInvocable } from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import {
  apply, Config, inject, JSPACE_PROTOCOL, JSPACE_SECTION, JSPACE_SKILL_NAME,
} from '../src/index.ts'

const plugin = { name: 'ui-model-selection', inject: [...inject], Config, apply }

describe('ui-model-selection host J-space', () => {
  it('injects the protocol until the live toggle is off', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt).await()
    const live = await liveConfig(ctx, plugin)
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(JSPACE_PROTOCOL)

    await live.update({ jspaceEnabled: false })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('J-Space')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain(JSPACE_SECTION)
  })

  it('keeps the protocol on by default', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(plugin).await()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(JSPACE_PROTOCOL)
  })

  it('hides j-space from model invocation while the toggle is off', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(SkillRegistry).await()
    ctx.skills.register({
      name: JSPACE_SKILL_NAME,
      description: 'Construction protocol',
      source: 'runtime',
      content: 'J-space body.',
    })
    const live = await liveConfig(ctx, plugin)
    const jspace = async () => (await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)
    expect((await jspace())?.invocation.modelInvocable).toBe(true)

    await live.update({ jspaceEnabled: false })
    const hidden = await jspace()
    expect(hidden).toBeDefined()
    expect(isModelInvocable(hidden!)).toBe(false)
    expect((await ctx.skills.get(JSPACE_SKILL_NAME))?.content).toBe('J-space body.')

    await live.update({ jspaceEnabled: true })
    expect((await jspace())?.invocation.modelInvocable).toBe(true)

    await live.update({ jspaceEnabled: false })
    expect(isModelInvocable((await jspace())!)).toBe(false)
    await live.fiber.dispose()
    expect((await jspace())?.invocation.modelInvocable).toBe(true)
  })

  it('omits the protocol on a Workflow planner and keeps it on a worker', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(plugin).await()
    const planner = {
      ctx: { get: (name: string) => name === 'agentPresets' ? { composedPreset: () => 'workflow' } : undefined },
      session: { header: { delegationDepth: 0 } },
      options: {},
    }
    const worker = {
      ctx: { get: (name: string) => name === 'agentPresets' ? { composedPreset: () => 'workflow' } : undefined },
      session: { header: { delegationDepth: 1 } },
      options: { subagentDepth: 1 },
    }
    expect(renderPrompt(await ctx.systemPrompt.assemble({ agent: planner } as never))).not.toContain('J-Space')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ agent: worker } as never))).toContain(JSPACE_PROTOCOL)
  })
})
