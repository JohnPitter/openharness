/**
 * Live user overlay for automatic compaction. The `compaction-basic` settings
 * namespace is registered when a settings provider exists; pressure and
 * overflow listeners read it at event time so a General-row change applies
 * without remounting the engine. Absent settings keep the plugin Config.
 *
 * @module @deepseek-ai/dsh-compaction-basic/user-settings
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'

/** Settings namespace owned by this backend; the General rows bind the same id. */
export const COMPACTION_SETTINGS_NAMESPACE = 'compaction-basic'

/** Discrete context-window fractions the General row offers. */
export const COMPACTION_THRESHOLD_PERCENTS = [25, 50, 75, 100] as const

/** One allowed General-row compaction threshold. */
export type CompactionThresholdPercent = typeof COMPACTION_THRESHOLD_PERCENTS[number]

/**
 * Default threshold in the settings document. Closest allowed discrete value
 * to the plugin Config `thresholdRatio` default of `0.8`.
 */
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT: CompactionThresholdPercent = 75

/** Default automatic-compaction switch in the settings document. */
export const DEFAULT_COMPACTION_AUTO = true

/** Durable compaction section shared by the Host schema and the browser scope. */
export interface CompactionUserSettings {
  /** When false, skip step-boundary pressure and overflow-recovery listeners. */
  auto: boolean
  /** Compact when estimated tokens reach this percent of the routed context window. */
  thresholdPercent: CompactionThresholdPercent
}

const thresholdPercentSchema: z<CompactionThresholdPercent> = z.union([
  z.const(25), z.const(50), z.const(75), z.const(100),
])

/** Durable compaction schema; also the wire envelope the browser scope validates against. */
export const CompactionUserSettingsSchema: z<CompactionUserSettings> = z.object({
  auto: z.boolean().default(DEFAULT_COMPACTION_AUTO),
  thresholdPercent: thresholdPercentSchema.default(DEFAULT_COMPACTION_THRESHOLD_PERCENT),
})

/** Register the section once per process; later standing mounts no-op. */
export function registerCompactionUserSettings(ctx: Context): void {
  const tryRegister = (settingsCtx: Context): void => {
    // Preset fibers isolate compaction and do not inject `settings`. The
    // property proxy would throw `without inject`; `get` reads the host store.
    const settings = settingsCtx.get('settings')
    if (settings === undefined) return
    const ns = settingsNamespace(COMPACTION_SETTINGS_NAMESPACE)
    if (settings.describe().some(row => row.ns === ns)) return
    settings.register(ns, CompactionUserSettingsSchema)
  }
  if (ctx.get('settings') !== undefined) {
    tryRegister(ctx)
    return
  }
  ctx.inject(['settings'], tryRegister)
}

/**
 * Read the live overlay when the namespace is registered and valid.
 * @param ctx - engine context that may inherit a host settings service.
 * @returns the resolved section, or `undefined` when settings are absent or unregistered.
 */
export function readCompactionUserSettings(ctx: Context): CompactionUserSettings | undefined {
  const settings = ctx.get('settings')
  if (settings === undefined) return undefined
  return asCompactionUserSettings(settings.get(settingsNamespace(COMPACTION_SETTINGS_NAMESPACE)))
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
  return overlay === undefined ? pluginAuto : overlay.auto
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
  return overlay === undefined ? pluginRatio : overlay.thresholdPercent / 100
}

/** Admit a resolved settings value into the overlay type, or drop it. */
export function asCompactionUserSettings(value: unknown): CompactionUserSettings | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { auto, thresholdPercent } = value as Record<string, unknown>
  if (typeof auto !== 'boolean') return undefined
  if (
    thresholdPercent !== 25 && thresholdPercent !== 50
    && thresholdPercent !== 75 && thresholdPercent !== 100
  ) return undefined
  return { auto, thresholdPercent }
}
