/** General Settings rows for automatic compaction and its context-window threshold. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  COMPACTION_THRESHOLD_PERCENTS, type CompactionThresholdPercent,
} from '../../compaction-settings.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face shared by both compaction rows. */
export interface CompactionSettingsInjected {
  hooks: {
    /** Persisted automatic-compaction switch bound as useCompactionAuto. */
    compactionAuto: SnapshotStore<boolean>
    /** Persisted threshold percent bound as useCompactionThreshold. */
    compactionThreshold: SnapshotStore<CompactionThresholdPercent>
  }
  /** Change whether automatic pressure and overflow recovery run. */
  setCompactionAuto: (auto: boolean) => void
  /** Change the context-window fraction that qualifies pressure compaction. */
  setCompactionThreshold: (percent: CompactionThresholdPercent) => void
}

/** Full Settings-row props for both compaction controls. */
export type CompactionSettingsRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<CompactionSettingsInjected>

const AUTO_OPTIONS: readonly { id: 'on' | 'off'; label: ConversationKey }[] = [
  { id: 'on', label: 'settings.compaction.auto.on' },
  { id: 'off', label: 'settings.compaction.auto.off' },
]

/**
 * Render the automatic-compaction switch.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function CompactionAutoRow({
  useCompactionAuto, setCompactionAuto, t,
}: CompactionSettingsRowProps) {
  const auto = useCompactionAuto(value => value)
  const [open, setOpen] = useState(false)
  const selectedId = auto ? 'on' : 'off'
  const selectedLabel = auto ? 'settings.compaction.auto.on' : 'settings.compaction.auto.off'

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.compaction.auto.title')}</div>
        <div className={css.desc}>{t('settings.compaction.auto.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={AUTO_OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={selectedId}
        onSelect={(id) => {
          setOpen(false)
          setCompactionAuto(id === 'on')
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {t(selectedLabel)}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}

/**
 * Render the discrete context-window threshold selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function CompactionThresholdRow({
  useCompactionAuto, useCompactionThreshold, setCompactionThreshold, t,
}: CompactionSettingsRowProps) {
  const auto = useCompactionAuto(value => value)
  const percent = useCompactionThreshold(value => value)
  const [open, setOpen] = useState(false)

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.compaction.threshold.title')}</div>
        <div className={css.desc}>{t('settings.compaction.threshold.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={() => { setOpen(false) }}
        items={COMPACTION_THRESHOLD_PERCENTS.map(value => ({
          id: String(value),
          label: `${value}%`,
        }))}
        selectedId={String(percent)}
        onSelect={(id) => {
          setOpen(false)
          /* v8 ignore next -- Menu items are the closed percent union. */
          if (id !== '25' && id !== '50' && id !== '75' && id !== '100') return
          setCompactionThreshold(Number(id) as CompactionThresholdPercent)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={!auto}
            onClick={() => { setOpen(value => !value) }}
          >
            {`${percent}%`}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
