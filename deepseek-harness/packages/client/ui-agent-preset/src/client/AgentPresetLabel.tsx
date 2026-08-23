/**
 * The session header's agent-preset control.
 *
 * A live session can switch composition; the host refuses only while a turn
 * is in flight. Child sessions join the parent's mount and stay a name, not
 * a picker. The new-session chip ({@link AgentPresetSeat}) still stages the
 * next blank session.
 */

import { useEffect, useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconAgentPresetOutline16, IconChevronDownOutline14, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header control. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
  /** Recompose this session from the picked preset. */
  select: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the control, or null when the session records no preset.
 */
export function AgentPresetLabel({
  sessionId, useSessions, useAgentPresets, load, select, t,
}: AgentPresetLabelProps) {
  const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
  const running = useSessions(state => state.byId[sessionId]?.running === true)
  const subagent = useSessions(state => state.byId[sessionId]?.origin === 'subagent')
  const options = useAgentPresets(state => state.options)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (preset !== undefined) void load()
  }, [preset, load])

  if (preset === undefined) return null

  const option = options.find(entry => entry.id === preset)
  const text = option === undefined ? undefined : presetDisplayText(option, t)
  const label = text?.name ?? preset
  const hint = error ?? (running ? t('headerBusy') : t('headerHint'))

  if (subagent) {
    return (
      <span className={css.label} title={text?.description ?? t('headerHint')}>
        <IconAgentPresetOutline16 size={14} className={css.icon} />
        {label}
      </span>
    )
  }

  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map((entry) => {
        const copy = presetDisplayText(entry, t)
        return {
          id: entry.id,
          label: (
            <span className={css.item}>
              <span className={css.itemName}>{copy.name}</span>
              <span className={css.itemDesc}>{copy.description ?? t('noDescription')}</span>
            </span>
          ),
        }
      })}
      selectedId={preset}
      onSelect={(id) => {
        setOpen(false)
        if (id === preset) return
        setBusy(true)
        setError(null)
        void select(id).then(
          () => { setBusy(false) },
          (cause: unknown) => {
            setBusy(false)
            setError(cause instanceof Error ? cause.message : String(cause))
          },
        )
      }}
      align="start"
      portal
      anchor={(
        <button
          type="button"
          className={css.trigger}
          aria-haspopup="menu"
          aria-expanded={open}
          title={hint}
          disabled={busy || running || options.length === 0}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconAgentPresetOutline16 size={14} className={css.icon} />
          {label}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      )}
    />
  )
}
