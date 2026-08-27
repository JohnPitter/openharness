/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import {
  TASK_COMPLETE_SOUND_FIELD, TaskCompleteSoundSchema,
  type TaskCompleteSound,
} from './desktop-sound-settings.ts'

export {
  DEFAULT_TASK_COMPLETE_SOUND, TASK_COMPLETE_SOUND_FIELD, TASK_COMPLETE_SOUNDS,
  type TaskCompleteSound,
} from './desktop-sound-settings.ts'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /** OpenHarness desktop completion wav preference. */
  taskCompleteSound: TaskCompleteSound
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsSchema: z<ConversationSettings> = z.object({
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [TASK_COMPLETE_SOUND_FIELD]: TaskCompleteSoundSchema,
})
