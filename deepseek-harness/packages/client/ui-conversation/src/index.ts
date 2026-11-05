/** Host registration for browser conversation preferences. */
import type {} from '@deepseek-ai/dsh-settings'
import type { CompactionUserSettingsSource } from '@deepseek-ai/dsh-compaction-basic'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { BusyEnterBehavior, TaskCompleteSound } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD, TASK_COMPLETE_SOUND_FIELD } from './submission-settings.ts'

import { ConversationSettingsFields } from './submission-settings.ts'
import {
  COMPACTION_AUTO_FIELD, COMPACTION_THRESHOLD_FIELD, COMPACTION_THRESHOLD_PERCENTS, DEFAULT_COMPACTION_AUTO,
  type CompactionThresholdPercent,
} from './compaction-settings.ts'

export {
  BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, DEFAULT_TASK_COMPLETE_SOUND, TASK_COMPLETE_SOUND_FIELD,
  TASK_COMPLETE_SOUNDS, type BusyEnterBehavior, type ConversationSettings,
  type TaskCompleteSound,
} from './submission-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Enter key behavior while a turn is running. */
  busyEnter: Volatile<BusyEnterBehavior>
  /** OpenHarness desktop completion wav while a root task finishes. */
  taskCompleteSound: Volatile<TaskCompleteSound>
  /** Automatic compaction switch shared by every preset's compaction-basic; unset means on. */
  compactionAuto?: Volatile<boolean | undefined>
  /** Pressure-compaction threshold percent; unset keeps each engine's `thresholdRatio`. */
  compactionThresholdPercent?: Volatile<CompactionThresholdPercent | undefined>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
  [TASK_COMPLETE_SOUND_FIELD]: ConversationSettingsFields[TASK_COMPLETE_SOUND_FIELD].volatile(),
  [COMPACTION_AUTO_FIELD]: z.boolean().default(DEFAULT_COMPACTION_AUTO).volatile(),
  [COMPACTION_THRESHOLD_FIELD]: z.union(COMPACTION_THRESHOLD_PERCENTS.map(percent => z.const(percent))).volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 * @param config Live preferences; the compaction fields back `compactionUserSettings`.
 */
export function apply(ctx: Context, config?: Partial<Config>): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const source: CompactionUserSettingsSource = {
    read: () => {
      const auto = config?.compactionAuto?.get()
      const thresholdPercent = config?.compactionThresholdPercent?.get()
      return {
        ...auto === undefined ? {} : { auto },
        ...thresholdPercent === undefined ? {} : { thresholdPercent },
      }
    },
  }
  ctx.provide('compactionUserSettings', source)
}
