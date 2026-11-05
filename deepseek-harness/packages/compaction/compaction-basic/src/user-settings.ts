/**
 * Live user overlay for automatic compaction. `auto` and `thresholdPercent`
 * are volatile Config fields, so the host settings forms edit them on the
 * `compaction-basic` profile entry and the pressure and overflow listeners
 * read them at event time without remounting the engine. An unset
 * `thresholdPercent` keeps the routed `thresholdRatio`.
 *
 * @module @deepseek-ai/dsh-compaction-basic/user-settings
 */

import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Profile entry id the General rows bind; the settings forms key edits by it. */
export const COMPACTION_SETTINGS_NAMESPACE = 'compaction-basic'

/** Discrete context-window fractions the General row offers. */
export const COMPACTION_THRESHOLD_PERCENTS = [25, 50, 75, 100] as const

/** One allowed General-row compaction threshold. */
export type CompactionThresholdPercent = typeof COMPACTION_THRESHOLD_PERCENTS[number]

/**
 * Default threshold the General row shows while the field is unset. Closest
 * allowed discrete value to the plugin Config `thresholdRatio` default of `0.8`.
 */
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT: CompactionThresholdPercent = 75

/** Default automatic-compaction switch. */
export const DEFAULT_COMPACTION_AUTO = true

/** Resolved live overlay; an absent field defers to the load-time policy. */
export interface CompactionUserSettings {
  /** When false, skip step-boundary pressure, model-switch, and overflow-recovery listeners. */
  auto?: boolean
  /** Compact when estimated tokens reach this percent of the routed context window. */
  thresholdPercent?: CompactionThresholdPercent
}

/** Volatile threshold-percent field schema shared by the plugin Config. */
export const thresholdPercentSchema: z<CompactionThresholdPercent> = z.union([
  z.const(25), z.const(50), z.const(75), z.const(100),
])

/** Schema of the user-editable section, as the General rows validate it. */
export const CompactionUserSettingsSchema: z<CompactionUserSettings> = z.object({
  auto: z.boolean(),
  thresholdPercent: thresholdPercentSchema,
})

/** A Config field that is either a plain load-time value or a live volatile reference. */
export type LiveField<T> = T | Volatile<T | undefined> | undefined

/**
 * Whether a raw Config field is a live volatile reference.
 * @param value - raw field value.
 * @returns true for a reference exposing `get()`.
 */
export function isVolatileField(value: unknown): value is Volatile<unknown> {
  return typeof value === 'object' && value !== null && 'get' in value
    && typeof (value as { get?: unknown }).get === 'function'
}

/** Read one possibly volatile Config field at call time. */
function readField(value: unknown): unknown {
  return isVolatileField(value) ? value.get() : value
}

/**
 * Snapshot the live overlay from the engine's raw Config fields.
 * @param auto - raw `auto` field (volatile under the Loader, plain in direct construction).
 * @param thresholdPercent - raw `thresholdPercent` field.
 * @returns the currently valid overlay fields; invalid values are dropped.
 */
export function readCompactionUserSettings(
  auto: LiveField<boolean>,
  thresholdPercent: LiveField<CompactionThresholdPercent>,
): CompactionUserSettings {
  return asCompactionUserSettings({ auto: readField(auto), thresholdPercent: readField(thresholdPercent) })
}

/**
 * Whether automatic listeners should run for this check.
 * @param pluginAuto - load-time `BasicCompactionConfig.auto` after resolve.
 * @param overlay - live settings section, if any.
 * @returns overlay `auto` when present, otherwise the plugin value.
 */
export function overlayAutomaticEnabled(
  pluginAuto: boolean,
  overlay: CompactionUserSettings | undefined,
): boolean {
  return overlay?.auto ?? pluginAuto
}

/**
 * Pressure threshold as a ratio, after the live settings overlay.
 * @param pluginRatio - routed policy `thresholdRatio` after Config resolve.
 * @param overlay - live settings section, if any.
 * @returns overlay percent / 100 when present, otherwise the plugin ratio.
 */
export function overlayThresholdRatio(
  pluginRatio: number,
  overlay: CompactionUserSettings | undefined,
): number {
  return overlay?.thresholdPercent === undefined ? pluginRatio : overlay.thresholdPercent / 100
}

/** Admit resolved settings values into the overlay type, dropping invalid fields. */
export function asCompactionUserSettings(value: unknown): CompactionUserSettings {
  if (typeof value !== 'object' || value === null) return {}
  const { auto, thresholdPercent } = value as Record<string, unknown>
  return {
    ...typeof auto === 'boolean' ? { auto } : {},
    ...thresholdPercent === 25 || thresholdPercent === 50 || thresholdPercent === 75 || thresholdPercent === 100
      ? { thresholdPercent }
      : {},
  }
}
