// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CompactionSettingsPolicy, DEFAULT_COMPACTION_AUTO, DEFAULT_COMPACTION_THRESHOLD_PERCENT,
} from '../src/client/settings/compaction-policy.ts'
import type { CompactionUserSettings } from '../src/compaction-settings.ts'

describe('CompactionSettingsPolicy', () => {
  it('defaults to automatic compaction at 75%', () => {
    const policy = new CompactionSettingsPolicy()
    expect(policy.auto.getSnapshot()).toBe(DEFAULT_COMPACTION_AUTO)
    expect(policy.thresholdPercent.getSnapshot()).toBe(DEFAULT_COMPACTION_THRESHOLD_PERCENT)
  })

  it('writes an explicit change through the scope after publishing it locally', () => {
    const host = stubConfigForm<CompactionUserSettings>()
    const policy = new CompactionSettingsPolicy(host.scope)
    policy.setAuto(false)
    expect(host.set).toHaveBeenCalledWith('compactionAuto', false)
    policy.setThresholdPercent(50)
    expect(host.set).toHaveBeenCalledWith('compactionThresholdPercent', 50)
    policy.setAuto(false)
    policy.setThresholdPercent(50)
    expect(host.set).toHaveBeenCalledTimes(2)
  })

  it('adopts a Host section without writing it back', () => {
    const host = stubConfigForm<CompactionUserSettings>()
    const policy = new CompactionSettingsPolicy(host.scope)
    host.publish({
      status: 'ready',
      value: { compactionAuto: false, compactionThresholdPercent: 25 },
      revision: 1,
      writable: true,
    })
    expect(policy.auto.getSnapshot()).toBe(false)
    expect(policy.thresholdPercent.getSnapshot()).toBe(25)
    policy.setAuto(false)
    policy.setThresholdPercent(25)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('adopts a section already standing at construction', () => {
    const host = stubConfigForm<CompactionUserSettings>()
    host.publish({
      status: 'ready',
      value: { compactionAuto: false, compactionThresholdPercent: 100 },
      revision: 1,
      writable: true,
    })
    const policy = new CompactionSettingsPolicy(host.scope)
    expect(policy.auto.getSnapshot()).toBe(false)
    expect(policy.thresholdPercent.getSnapshot()).toBe(100)
  })

  it('ignores a Host snapshot that still has no section', () => {
    const host = stubConfigForm<CompactionUserSettings>()
    const changed = vi.fn()
    const policy = new CompactionSettingsPolicy(host.scope)
    policy.auto.subscribe(changed)
    host.publish({ status: 'loading', value: undefined })
    expect(policy.auto.getSnapshot()).toBe(true)
    expect(changed).not.toHaveBeenCalled()
  })
})
