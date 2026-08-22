/**
 * Model selection plugin, browser half — three entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution and the composer's named `conversation.input.model` seat both
 * load the session's provider-grouped advisory directory (`session.models`)
 * and submit through `session.selectModel` via the same directory instance,
 * so the host-reported current selection is the single fact both surfaces echo
 * — a switch made in either entry is what the other shows next. The sidebar
 * usage chip reads that same directory plus token-meter projections and opens
 * Models settings through `ctx.settingsNav`. Failures
 * ride each entry's own retry surface (popup shell error/retry; seat menu
 * inline error) without forking the state. Addressed subagent sessions expose
 * neither selection entry because those Agent-bound RPCs would activate persisted
 * history outside the direct-parent continuation path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ModelSelection, SessionModels } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: sidebar.footer.action slot + settingsNav Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { WorkerModelStore } from './worker-store.ts'
import type { UsageStatusChipInjected } from './usage-slots.ts'
import { UsageStatusChip } from './UsageStatusChip.tsx'
import { UsagesSection } from './UsagesSection.tsx'
import type { UsagesSectionInjected } from './UsagesSection.tsx'
import { currentDirectorySource } from './usage-directory.ts'
import { en, es, pt, zh, type ModelKey } from './locales.ts'
import {
  JSPACE_DEFAULT_ENABLED, JSPACE_ENABLED_FIELD, JSPACE_SETTINGS_NAMESPACE,
  type JspaceSettings,
} from '../jspace-settings.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelSelectInjected } from './slots.ts'
export type { ModelKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The model selection surfaces' copy (/model popup + composer seat). */
    model: ModelKey
  }
}

/** One selectable row's id: an opaque row key (resolved by lookup, never parsed). */
function rowId(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`
}

/** Flatten the directory into popup rows; failure rows are listed for visibility but never selectable. */
function optionsOf(directory: SessionModels, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of directory.groups) {
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        detail: model.description !== undefined ? `${group.name} · ${model.description}` : group.name,
        ...(directory.current.provider === group.id && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.name,
      detail: t('option.loadError', { message: failure.message }),
    })
  }
  return rows
}

/**
 * Resolve a picked row back to its model selection by matching against the loaded
 * groups (the same data the rows were built from — ids stay opaque).
 * @param state - the session's directory snapshot.
 * @param id - the picked row id.
 * @returns the row's model selection, or undefined for failure rows / stale ids.
 */
function selectionOf(state: ModelDirectoryState, id: string): ModelSelection | undefined {
  for (const group of state.groups) {
    for (const model of group.models) {
      if (rowId(group.id, model.id) !== id) continue
      const sameRoute = state.current?.provider === group.id && state.current.model === model.id
      const reasoningEffort = sameRoute
        ? state.current?.reasoningEffort ?? model.reasoning?.defaultEffort
        : model.reasoning?.defaultEffort
      return {
        provider: group.id,
        model: model.id,
        ...reasoningEffort === undefined ? {} : { reasoningEffort },
      }
    }
  }
  return undefined
}

/** Dictionary namespace owned by this plugin. */
const NS = 'model'

/** Required services: the contribution registry, the seat's slot registry, locale, and the service's own faces. */
export const inject = ['commandUi', 'connection', 'locale', 'sessions', 'slots', 'remote', 'settingsNav', 'settingsScope']

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution and the composer model seat
 * over the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, pt, es }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description, the popup option builder) read
  // through the bound translate; the seat component reads the standard seat.
  const t = ctx.locale.bind(NS)

  // The composer-block reason is this plugin's own copy, read at raise time so
  // a locale change reaches the next publish.
  ctx.plugin(ModelDirectoryResolver, { blockReason: () => t('blocked.composer') })

  const jspaceScope = ctx.settingsScope.bind<JspaceSettings>({ namespace: JSPACE_SETTINGS_NAMESPACE })
  const jspaceControl = {
    subscribe: (listener: () => void) => jspaceScope.subscribe(listener),
    getEnabled: () => {
      const snap = jspaceScope.getSnapshot()
      if (snap.status !== 'ready') return JSPACE_DEFAULT_ENABLED
      return snap.value?.enabled ?? JSPACE_DEFAULT_ENABLED
    },
    set: (enabled: boolean) => jspaceScope.set(JSPACE_ENABLED_FIELD, enabled),
  }

  const settings = (ctx.get('connection') as ConnectionHandle | undefined)?.api.settings
  const worker = settings === undefined ? undefined : new WorkerModelStore(settings)
  if (worker !== undefined) {
    ctx.effect(() => () => { worker.dispose() }, 'ui-model-selection: worker store')
    ctx.remote.$on('settings/document-updated', () => { void worker.load().catch(() => undefined) })
  }

  // Entry 1: the /model popupSelect over the shared directory. The command
  // description is registry-held text: it reads t() once at registration and
  // refreshes only on re-registration, not on locale change.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      description: t('command.description'),
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        options: async (session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          return optionsOf(await models.directoryFor(session.sessionId).load(), t)
        },
        onSelect: async (option, session) => {
          if (sessions.subagentAddress(session.sessionId) !== undefined) {
            throw new Error('model selection is unavailable for addressed subagent sessions')
          }
          const directory = models.directoryFor(session.sessionId)
          const selection = selectionOf(directory.store.getSnapshot(), option.id)
          if (selection === undefined) {
            throw new Error('this provider\'s catalog failed to load — pick a model from a loaded group')
          }
          await directory.select(selection)
        },
      },
    }), 'ui-model-selection: /model contribution')
  })

  // Entry 2: the composer's named model seat over the SAME directory.
  ctx.inject(['slots', 'modelDirectories'], (scope: ClientContext) => {
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      locale: NS,
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          select: (selection: ModelSelection) => available
            ? directory.select(selection).then(() => true, () => false)
            : Promise.resolve(false),
          jspace: jspaceControl,
          ...worker === undefined ? {} : {
            worker: {
              directory: worker.store,
              load: () => { worker.load().catch(() => { /* surfaced on the store */ }) },
              select: (selection: ModelSelection) => worker.select(selection).then(() => true, () => false),
            },
          },
        }
      },
    }, ModelSelect))

    const directory = currentDirectorySource(sessions, models)
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'usage-status',
      order: -10,
      locale: NS,
      inject: (): UsageStatusChipInjected => ({
        directory,
        ensureDirectory: (sessionId) => {
          if (sessions.subagentAddress(sessionId) !== undefined) return
          models.directoryFor(sessionId).load().catch(() => { /* surfaced on the store */ })
        },
        openModels: () => { ctx.settingsNav.openSection('models') },
        openUsages: () => { ctx.settingsNav.openSection('usages') },
        loadAccountUsage: async (provider) => {
          const api = (ctx.get('connection') as ConnectionHandle | undefined)?.api.llm
          if (api === undefined) return { supported: false }
          const response = await api.accountUsage({ provider })
          if (!response.result.ok) return { supported: true, error: response.result.error.message }
          return response.result.value
        },
      }),
    }, UsageStatusChip))
  })

  // Settings → Usage: every coding-plan provider's account quotas in one place.
  ctx.slots.inject('settings.section', () => {
    const connection = ctx.get('connection') as ConnectionHandle
    const injected = (): UsagesSectionInjected => ({
      api: connection.api,
    })
    return ctx.slots.register({
      name: 'settings.section',
      id: 'usages',
      order: 12,
      label: () => t('usages.nav'),
      locale: NS,
      inject: injected,
    }, UsagesSection)
  })
}
