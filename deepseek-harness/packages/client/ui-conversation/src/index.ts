/** Host registration for browser conversation preferences. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { BusyEnterBehavior, TaskCompleteSound } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD, TASK_COMPLETE_SOUND_FIELD } from './submission-settings.ts'

import { ConversationSettingsFields } from './submission-settings.ts'

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
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
  [TASK_COMPLETE_SOUND_FIELD]: ConversationSettingsFields[TASK_COMPLETE_SOUND_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
