/** Automatic-compaction preference stored in the Host user-settings document. */

/** Settings namespace owned by compaction-basic; must stay identical there. */
export const COMPACTION_SETTINGS_NAMESPACE = 'compaction-basic'

/** Field carrying the automatic pressure and overflow-recovery switch. */
export const COMPACTION_AUTO_FIELD = 'auto'

/** Field carrying the discrete context-window fraction that triggers pressure compaction. */
export const COMPACTION_THRESHOLD_FIELD = 'thresholdPercent'

/** Discrete percents the General row offers; compaction-basic admits the same union. */
export const COMPACTION_THRESHOLD_PERCENTS = [25, 50, 75, 100] as const

/** One allowed General-row compaction threshold. */
export type CompactionThresholdPercent = typeof COMPACTION_THRESHOLD_PERCENTS[number]

/** Default matches the Host schema when the namespace is registered. */
export const DEFAULT_COMPACTION_AUTO = true

/** Closest allowed discrete value to the plugin Config `thresholdRatio` default of `0.8`. */
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT: CompactionThresholdPercent = 75

/** Durable compaction section mirrored by the browser scope. */
export interface CompactionUserSettings {
  /** When false, skip step-boundary pressure and overflow-recovery listeners. */
  auto: boolean
  /** Compact when estimated tokens reach this percent of the routed context window. */
  thresholdPercent: CompactionThresholdPercent
}
