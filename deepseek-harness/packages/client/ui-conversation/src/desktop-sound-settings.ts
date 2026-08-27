/** Task-complete sound preference for the OpenHarness desktop shell. */

import z from '@deepseek-ai/schemastery'

/** Field carrying the Windows Media wav preference id. */
export const TASK_COMPLETE_SOUND_FIELD = 'taskCompleteSound'

/**
 * Preference ids kept in sync with `internal/app/sound_windows.go`.
 * `silent` skips playback; everything else maps to a Media wav basename.
 */
export const TASK_COMPLETE_SOUNDS = [
  'notify-email',
  'notify',
  'notify-messaging',
  'notify-calendar',
  'ding',
  'chimes',
  'chord',
  'tada',
  'nudge',
  'default',
  'print',
  'generic',
  'silent',
] as const

/** One catalog entry persisted in General settings. */
export type TaskCompleteSound = typeof TASK_COMPLETE_SOUNDS[number]

/** Default avoids the bland Windows System Generic notify. */
export const DEFAULT_TASK_COMPLETE_SOUND: TaskCompleteSound = 'notify-email'

/** Zod union over the closed catalog. */
export const TaskCompleteSoundSchema = z
  .union([...TASK_COMPLETE_SOUNDS])
  .default(DEFAULT_TASK_COMPLETE_SOUND)

/**
 * True when `value` is a known catalog id.
 * @param value - candidate from settings or postMessage.
 */
export function isTaskCompleteSound(value: string): value is TaskCompleteSound {
  return (TASK_COMPLETE_SOUNDS as readonly string[]).includes(value)
}
