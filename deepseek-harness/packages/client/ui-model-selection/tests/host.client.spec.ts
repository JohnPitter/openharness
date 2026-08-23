import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SkillRegistry, { isModelInvocable } from '@deepseek-ai/dsh-skill'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  apply, inject, JSPACE_PROTOCOL, JSPACE_SECTION, JSPACE_SETTINGS_NAMESPACE, JSPACE_SKILL_NAME,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-model-selection host J-space', () => {
  it('registers the namespace and injects the protocol until the toggle is off', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt).await()
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const ns = settingsNamespace(JSPACE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({ enabled: true })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(JSPACE_PROTOCOL)

    await ctx.settings.update(ns, { enabled: false })
    expect(ctx.settings.get(ns)).toEqual({ enabled: false })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).not.toContain('J-Space')
    expect((await ctx.systemPrompt.assemble()).sections.map(section => section.name))
      .toContain(JSPACE_SECTION)

    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('keeps the protocol on without a settings provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toContain(JSPACE_PROTOCOL)
  })

  it('hides j-space from model invocation while the toggle is off', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(SkillRegistry).await()
    ctx.skills.register({
      name: JSPACE_SKILL_NAME,
      description: 'Construction protocol',
      source: 'runtime',
      content: 'J-space body.',
    })
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const ns = settingsNamespace(JSPACE_SETTINGS_NAMESPACE)
    expect((await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)?.invocation.modelInvocable)
      .toBe(true)

    await ctx.settings.update(ns, { enabled: false })
    const hidden = (await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)
    expect(hidden).toBeDefined()
    expect(isModelInvocable(hidden!)).toBe(false)
    expect((await ctx.skills.get(JSPACE_SKILL_NAME))?.content).toBe('J-space body.')

    const other = settingsNamespace('ui-other')
    ctx.settings.register(other, z.object({ n: z.number().default(0) }))
    await ctx.settings.update(other, { n: 1 })
    expect(isModelInvocable((await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)!))
      .toBe(false)

    await ctx.settings.update(ns, { enabled: true })
    expect((await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)?.invocation.modelInvocable)
      .toBe(true)

    await ctx.settings.update(ns, { enabled: false })
    expect(isModelInvocable((await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)!))
      .toBe(false)
    await fiber.dispose()
    expect((await ctx.skills.list()).find(skill => skill.name === JSPACE_SKILL_NAME)?.invocation.modelInvocable)
      .toBe(true)
  })
})
