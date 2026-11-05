/** Automatic-compaction preference stored in the Host user-settings document. */

/**
 * Host entry carrying the preference: this package's own host row. Presets
 * mount compaction-basic per Agent, so no single compaction-basic entry
 * exists to edit; the host row provides `compactionUserSettings`, which each
 * preset-scoped compaction-basic reads at event time.
 */
export const COMPACTION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the automatic pressure and overflow-recovery switch. */
export const COMPACTION_AUTO_FIELD = 'compactionAuto'

/** Field carrying the discrete context-window fraction that triggers pressure compaction. */
export const COMPACTION_THRESHOLD_FIELD = 'compactionThresholdPercent'

/** Discrete percents the General row offers; compaction-basic admits the same union. */
export const COMPACTION_THRESHOLD_PERCENTS = [25, 50, 75, 100] as const

/** One allowed General-row compaction threshold. */
export type CompactionThresholdPercent = typeof COMPACTION_THRESHOLD_PERCENTS[number]

/** Default matches the Host schema when the namespace is registered. */
export const DEFAULT_COMPACTION_AUTO = true

/** Closest allowed discrete value to the plugin Config `thresholdRatio` default of `0.8`. */
export const DEFAULT_COMPACTION_THRESHOLD_PERCENT: CompactionThresholdPercent = 75

/** The volatile `ui-conversation` Config fields the General rows edit through configForms. */
export interface CompactionUserSettings {
  /** When false, skip step-boundary pressure and overflow-recovery listeners; unset means on. */
  compactionAuto?: boolean
  /**
   * Compact when estimated tokens reach this percent of the routed context
   * window; unset falls back to the plugin's `thresholdRatio` (0.8).
   */
  compactionThresholdPercent?: CompactionThresholdPercent
}
