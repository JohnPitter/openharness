import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskCompleteSoundPolicy } from '../src/client/settings/sound-policy.ts'
import { DEFAULT_TASK_COMPLETE_SOUND } from '../src/desktop-sound-settings.ts'
import type { ConversationSettings } from '../src/submission-settings.ts'

describe('TaskCompleteSoundPolicy', () => {
  it('defaults to notify-email without a host', () => {
    const policy = new TaskCompleteSoundPolicy()
    expect(policy.sound.getSnapshot()).toBe(DEFAULT_TASK_COMPLETE_SOUND)
  })

  it('persists a catalog id and adopts host updates', () => {
    const host = stubSettingsScope<ConversationSettings>()
    const policy = new TaskCompleteSoundPolicy(host.scope)
    policy.setSound('ding')
    expect(policy.sound.getSnapshot()).toBe('ding')
    expect(host.set).toHaveBeenCalledWith('taskCompleteSound', 'ding')

    host.publish({
      status: 'ready',
      value: { busyEnter: 'queue', taskCompleteSound: 'tada' },
      revision: 2,
      writable: true,
    })
    expect(policy.sound.getSnapshot()).toBe('tada')
  })
})
