/** General Settings row for the OpenHarness desktop task-complete sound. */
import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, IconPlayOutline16, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  TASK_COMPLETE_SOUNDS, type TaskCompleteSound,
} from '../../desktop-sound-settings.ts'
import { postDesktopPreviewSound } from '../desktop-complete.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.module.css'

/** Registration-side preference face. */
export interface TaskCompleteSoundRowInjected {
  hooks: {
    /** Persisted catalog id bound as useTaskCompleteSound. */
    taskCompleteSound: SnapshotStore<TaskCompleteSound>
  }
  /** Change the completion sound. */
  setTaskCompleteSound: (sound: TaskCompleteSound) => void
}

/** Full Settings-row props. */
export type TaskCompleteSoundRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<TaskCompleteSoundRowInjected>

const LABEL_KEY: Record<TaskCompleteSound, ConversationKey> = {
  'notify-email': 'settings.sound.notifyEmail',
  notify: 'settings.sound.notify',
  'notify-messaging': 'settings.sound.notifyMessaging',
  'notify-calendar': 'settings.sound.notifyCalendar',
  ding: 'settings.sound.ding',
  chimes: 'settings.sound.chimes',
  chord: 'settings.sound.chord',
  tada: 'settings.sound.tada',
  nudge: 'settings.sound.nudge',
  default: 'settings.sound.default',
  print: 'settings.sound.print',
  generic: 'settings.sound.generic',
  silent: 'settings.sound.silent',
}

/**
 * True when the page is embedded in the OpenHarness Wails shell.
 * Browser tabs skip this preference — they have no Media wav playback.
 */
function desktopShell(): boolean {
  return typeof window !== 'undefined' && window.parent !== window
}

/**
 * Render the desktop-only completion-sound selector with a preview control.
 * @param props - composed Settings slot props.
 * @returns the preference row, or null outside the desktop shell.
 */
export function TaskCompleteSoundRow({
  useTaskCompleteSound, setTaskCompleteSound, t,
}: TaskCompleteSoundRowProps) {
  const sound = useTaskCompleteSound(value => value)
  const [open, setOpen] = useState(false)
  if (!desktopShell()) return null

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.sound.title')}</div>
        <div className={css.desc}>{t('settings.sound.description')}</div>
      </div>
      <div className={css.actions}>
        <button
          type="button"
          className={css.preview}
          aria-label={t('settings.sound.preview')}
          disabled={sound === 'silent'}
          onClick={() => { postDesktopPreviewSound(sound) }}
        >
          <IconPlayOutline16 className={css.previewIcon} />
        </button>
        <Menu
          open={open}
          onClose={() => { setOpen(false) }}
          items={TASK_COMPLETE_SOUNDS.map(id => ({ id, label: t(LABEL_KEY[id]) }))}
          selectedId={sound}
          onSelect={(id) => {
            setOpen(false)
            setTaskCompleteSound(id as TaskCompleteSound)
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
              {t(LABEL_KEY[sound])}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          )}
        />
      </div>
    </div>
  )
}
