import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_TASK_COMPLETE_SOUND, Config, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'


describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    const compactionDefaults = { compactionAuto: true, compactionThresholdPercent: undefined }
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR, taskCompleteSound: DEFAULT_TASK_COMPLETE_SOUND, ...compactionDefaults,
    })
    await configuration.update({ busyEnter: 'steer' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({
      busyEnter: 'steer', taskCompleteSound: DEFAULT_TASK_COMPLETE_SOUND, ...compactionDefaults,
    })
    await expect(configuration.update({ busyEnter: 'invalid' })).rejects.toThrow()
    await configuration.update({ busyEnter: 'steer', taskCompleteSound: 'chimes' })
    expect(plainConfig(configuration.fiber.effectiveConfig)).toEqual({
      busyEnter: 'steer', taskCompleteSound: 'chimes', ...compactionDefaults,
    })
    await fiber.dispose()
  })

  it('serves the edited automatic-compaction preference to preset-scoped engines', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    expect(ctx.get('compactionUserSettings')?.read()).toEqual({ auto: true })
    await configuration.update({ compactionAuto: false, compactionThresholdPercent: 50 })
    expect(ctx.get('compactionUserSettings')?.read()).toEqual({ auto: false, thresholdPercent: 50 })
    await expect(configuration.update({ compactionThresholdPercent: 60 })).rejects.toThrow()
    await configuration.fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
