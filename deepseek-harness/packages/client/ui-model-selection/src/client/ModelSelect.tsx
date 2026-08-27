/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort / J-space row set (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, the effort levels, and the construction-protocol
 * toggle. The trigger (313:14108's ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type FocusEvent,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId, SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ModelSelectInjected } from './slots.ts'
import type { WorkerModelState } from './worker-store.ts'
import { formatTokens } from './usage-format.ts'
import css from './ModelSelect.module.css'

const IDLE_WORKER: WorkerModelState = { current: null, status: 'idle', error: null }

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort' | 'jspace'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

type SeatProps = ModelSelectInjected & { locked: boolean } & PropsLocale<'model'> & {
  sessionId?: SessionId
  useSessions?: SnapshotSelectorHook<SessionListState>
}

type PickerProps = SeatProps & {
  role?: 'orchestrator' | 'worker'
  currentOverride?: ModelSelection | null
  selectOverride?: (selection: ModelSelection) => Promise<boolean>
}

/**
 * Render the composer model seat.
 */
export function ModelSelect(props: SeatProps) {
  const preset = props.useSessions?.(s => (
    props.sessionId === undefined ? undefined : s.byId[props.sessionId]?.agentPreset
  ))
  const workerDirectory = props.worker?.directory
  const workerState = useSyncExternalStore(
    workerDirectory === undefined ? () => () => {} : fn => workerDirectory.subscribe(fn),
    () => workerDirectory?.getSnapshot() ?? IDLE_WORKER,
  )
  useEffect(() => {
    if (preset === 'workflow') props.worker?.load()
  }, [preset, props.worker])

  if (preset === 'workflow') {
    const inherited = props.directory.getSnapshot().current
    const workerCurrent = workerState.current ?? inherited
    return (
      <div className={css.roles}>
        <ModelPicker {...props} role="orchestrator" />
        <ModelPicker
          {...props}
          role="worker"
          currentOverride={workerCurrent}
          selectOverride={props.worker === undefined ? props.select : props.worker.select}
        />
      </div>
    )
  }
  return <ModelPicker {...props} />
}

/**
 * One model/effort dropdown. Workflow mode mounts two of these.
 */
function ModelPicker(
  { locked, available, directory, load, select, t, role, currentOverride, selectOverride, jspace }:
  PickerProps,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const current = currentOverride !== undefined ? currentOverride : state.current
  const selectedIndex = current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === current.provider && c.selection.model === current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effortIds = new Set(reasoning?.efforts.map(level => level.id) ?? [])
  const requestedEffort = current?.reasoningEffort ?? reasoning?.defaultEffort
  const effectiveEffort = requestedEffort !== undefined && effortIds.has(requestedEffort)
    ? requestedEffort
    : reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const jspaceEnabled = useSyncExternalStore(
    jspace === undefined ? () => () => {} : fn => jspace.subscribe(fn),
    () => jspace?.getEnabled() ?? true,
  )
  const busy = state.status === 'selecting'

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (current?.provider === selection.provider && current.model === selection.model) {
      close(true)
      return
    }
    lastActionRef.current = 'select'
    void (selectOverride ?? select)(selection).then(settleSelection)
  }

  const showJspace = jspace !== undefined && role === undefined
  const jspaceLabel = showJspace
    ? (jspaceEnabled ? t('jspace.on') : t('jspace.off'))
    : undefined

  const chooseJspace = (enabled: boolean): void => {
    if (jspace === undefined || jspaceEnabled === enabled) {
      close(true)
      return
    }
    void jspace.set(enabled).then(() => { close(true) })
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (current === null) return
    if (current.reasoningEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: current.provider,
      model: current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void (selectOverride ?? select)(selection).then(settleSelection)
  }

  const roleLabel = role === undefined ? undefined : t(`role.${role}`)
  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const labeledModel = roleLabel === undefined ? modelLabel : `${roleLabel} · ${modelLabel}`
  const triggerLabel = [
    labeledModel,
    ...role === undefined && effortLabel !== undefined ? [effortLabel] : [],
    ...role === undefined && jspaceLabel !== undefined ? [jspaceLabel] : [],
  ].join(' · ')
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : roleLabel === undefined
      ? effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
      : effortLabel === undefined
        ? t('trigger.ariaRole', { role: roleLabel, model: modelLabel })
        : t('trigger.ariaRoleEffort', { role: roleLabel, model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{labeledModel}</span>
        {role === undefined && currentChoice?.model.contextWindow !== undefined && (
          <span className={css.triggerEffort}>{formatTokens(currentChoice.model.contextWindow)}</span>
        )}
        {role === undefined && effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        {role === undefined && jspaceLabel !== undefined && <span className={css.triggerEffort}>{jspaceLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
              {showJspace && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('jspace') }}>
                  <span className={css.cellLabel}>{t('menu.jspace')}</span>
                  <span className={css.cellValue}>{jspaceLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={clsx(css.groups, 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                      <div className={css.groupTitle} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = current?.provider === group.id && current.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            className={clsx(css.option, selected && css.selected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onClick={() => {
                              choose({
                                provider: group.id,
                                model: model.id,
                                ...model.reasoning?.defaultEffort === undefined
                                  ? {}
                                  : { reasoningEffort: model.reasoning.defaultEffort },
                              })
                            }}
                          >
                            <span className={css.optionCopy}>
                              <span className={css.modelName}>{model.name}</span>
                              {model.contextWindow !== undefined && (
                                <span className={css.description}>
                                  {t('menu.contextWindow', { window: formatTokens(model.contextWindow) })}
                                </span>
                              )}
                              {model.description !== undefined && (
                                <span className={css.description}>{model.description}</span>
                              )}
                            </span>
                            <span className={css.check}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'jspace' && jspace !== undefined && (
            <>
              {([true, false] as const).map(enabled => (
                <button
                  ref={itemRef()}
                  type="button"
                  role="menuitemradio"
                  aria-checked={jspaceEnabled === enabled}
                  className={clsx(css.option, jspaceEnabled === enabled && css.selected)}
                  key={enabled ? 'on' : 'off'}
                  onClick={() => { chooseJspace(enabled) }}
                >
                  <span className={css.optionCopy}>
                    <span className={css.modelName}>{enabled ? t('jspace.on') : t('jspace.off')}</span>
                    <span className={css.description}>
                      {enabled ? t('jspace.onDescription') : t('jspace.offDescription')}
                    </span>
                  </span>
                  <span className={css.check}>
                    {jspaceEnabled === enabled ? <IconCheckOutline16 /> : null}
                  </span>
                </button>
              ))}
            </>
          )}
          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
