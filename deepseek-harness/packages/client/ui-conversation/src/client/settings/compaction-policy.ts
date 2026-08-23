/**
 * Live automatic-compaction preference used by the General Settings rows.
 * Host writes go through the bound scope; absent compositions stay process-local.
 */
import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  COMPACTION_AUTO_FIELD, COMPACTION_THRESHOLD_FIELD,
  DEFAULT_COMPACTION_AUTO, DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  type CompactionThresholdPercent, type CompactionUserSettings,
} from '../../compaction-settings.ts'

export {
  DEFAULT_COMPACTION_AUTO, DEFAULT_COMPACTION_THRESHOLD_PERCENT,
} from '../../compaction-settings.ts'

/** Busy-Enter analogue: two snapshot stores over one namespace section. */
export class CompactionSettingsPolicy {
  /** Reactive automatic-compaction switch for the Settings row. */
  readonly auto: SnapshotStore<boolean> = createSnapshotStore(DEFAULT_COMPACTION_AUTO)
  /** Reactive threshold percent for the Settings row. */
  readonly thresholdPercent: SnapshotStore<CompactionThresholdPercent> = createSnapshotStore(
    DEFAULT_COMPACTION_THRESHOLD_PERCENT,
  )
  private readonly host: SettingsScope<CompactionUserSettings> | undefined

  /**
   * @param host - durable preference scope owned by the providing plugin;
   * absent compositions stay process-local. The adoption subscription shares
   * the scope's plugin lifetime — a disposed scope never publishes again, so
   * the policy needs no release hook.
   */
  constructor(host?: SettingsScope<CompactionUserSettings>) {
    this.host = host
    if (host !== undefined) {
      host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /**
   * Change whether automatic pressure and overflow recovery run.
   * @param auto - live switch; false leaves `/compact` available.
   */
  setAuto(auto: boolean): void {
    if (this.auto.getSnapshot() === auto) return
    this.auto.set(auto)
    void this.host?.set(COMPACTION_AUTO_FIELD, auto)
  }

  /**
   * Change the context-window fraction that qualifies pressure compaction.
   * @param percent - one of 25, 50, 75, or 100.
   */
  setThresholdPercent(percent: CompactionThresholdPercent): void {
    if (this.thresholdPercent.getSnapshot() === percent) return
    this.thresholdPercent.set(percent)
    void this.host?.set(COMPACTION_THRESHOLD_FIELD, percent)
  }

  /**
   * Adopt the scope's accepted durable section without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: SettingsScope<CompactionUserSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    if (this.auto.getSnapshot() !== section.auto) this.auto.set(section.auto)
    if (this.thresholdPercent.getSnapshot() !== section.thresholdPercent) {
      this.thresholdPercent.set(section.thresholdPercent)
    }
  }
}
