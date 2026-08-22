import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import {
  apply, inject, JSPACE_PROTOCOL, JSPACE_SECTION, JSPACE_SETTINGS_NAMESPACE,
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
})
