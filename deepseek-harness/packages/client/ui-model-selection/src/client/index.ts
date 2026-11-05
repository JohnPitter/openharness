/**
 * Model selection plugin, browser half — TWO entries over ONE per-session
 * directory owned by ModelDirectoryResolver (`ctx.modelDirectories`). The /model popupSelect
 * contribution and the composer's named `conversation.input.model` seat share
 * one Host-generation `session/modelCatalog` catalog, combine it with the Session's
 * durable model-selection projection, and submit through `session.selectModel`.
 * A switch made in either entry is what the other shows next. The sidebar
 * Remote chip and usage chip sit in the sidebar foot; the usage chip reads the
 * main-view Session's directory plus token-meter projections, and Settings
 * gains the Limits (account quotas) and Status (local history) sections.
 * The composer seat also carries the J-space toggle and, on Workflow
 * sessions, the worker model picker. Failures
 * ride each entry's own retry surface (popup shell error/retry; seat menu
 * inline error) without forking the state. Addressed subagent sessions expose
 * neither entry because those Agent-bound RPCs would activate persisted
 * history outside the direct-parent continuation path.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { CommandUiContract, SelectOption } from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.model seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: sidebar.footer.action slot, settingsNav + configForms Context merges.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconDataOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelDirectoryState } from './directory.ts'
import { ModelDirectoryResolver } from './service.ts'
import type { ModelSelectInjected } from './slots.ts'
import { ModelSelect } from './ModelSelect.tsx'
import { en, ja, es, fr, de, ru, pt, zh, type ModelKey } from './locales.ts'
import { orderModelProviders } from './provider-order.ts'
import { WorkerModelStore } from './worker-store.ts'
import { QuotaRing } from './QuotaRing.tsx'
import type { QuotaRingInjected, UsageApi, UsageStatusChipInjected } from './usage-slots.ts'
import { UsageStatusChip } from './UsageStatusChip.tsx'
import { RemoteChip } from './RemoteChip.tsx'
import { QuotasSection } from './QuotasSection.tsx'
import type { QuotasSectionInjected } from './QuotasSection.tsx'
import { UsagesSection } from './UsagesSection.tsx'
import type { UsagesSectionInjected } from './UsagesSection.tsx'
import { currentDirectorySource } from './usage-directory.ts'
import {
  JSPACE_DEFAULT_ENABLED, JSPACE_ENABLED_FIELD, JSPACE_SETTINGS_NAMESPACE, type JspaceSettings,
} from '../jspace-settings.ts'
import { WORKFLOW_WORKER_MODEL_NS } from './worker-store.ts'

export { ModelDirectory } from './directory.ts'
export type { ModelDirectoryState } from './directory.ts'
export { ModelDirectoryResolver } from './service.ts'
export type { ModelLabelOwner, ModelSelectInjected } from './slots.ts'
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
function optionsOf(directory: ModelDirectoryState, t: TranslateNS<'model'>): SelectOption[] {
  const rows: SelectOption[] = []
  for (const group of orderModelProviders(directory.groups)) {
    const name = group.id === 'deepseek-account' ? t('provider.account') : group.name
    for (const model of group.models) {
      rows.push({
        id: rowId(group.id, model.id),
        label: model.name,
        group: { name: group.id, label: name },
        ...(directory.current !== null
          && directory.current.provider === group.id
          && directory.current.model === model.id
          ? { active: true } : {}),
      })
    }
  }
  for (const failure of directory.failures) {
    rows.push({
      id: `failure/${failure.id}`,
      label: failure.id === 'deepseek-account' ? t('provider.account') : failure.name,
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
export const inject = [
  'commandUi', 'locale', 'sessions', 'slots', 'remote', 'remote.session', 'remote.llm', 'remote.usage',
  'configForms', 'settingsNav',
]

/**
 * Client plugin body: mount ModelDirectoryResolver, register the `model` dictionaries,
 * then register the /model popup contribution and the composer model seat
 * over the service.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-model-selection: dictionaries')

  // Non-slot faces (the command description, the popup option builder) read
  // through the bound translate; the seat component reads the standard seat.
  const t = ctx.locale.bind(NS)

  // Workflow worker model: the worker fields of the agent-default-model entry.
  const worker = new WorkerModelStore(ctx.configForms.get<Record<string, unknown>>(WORKFLOW_WORKER_MODEL_NS))
  ctx.effect(() => () => { worker.dispose() }, 'ui-model-selection: worker store')

  ctx.plugin(ModelDirectoryResolver, {
    workerBlockReason: () => t('blocked.worker'),
    workerSelected: () => worker.store.getSnapshot().current,
    subscribeWorker: (listener: () => void) => worker.store.subscribe(listener),
  })

  // J-space toggle: a live field of this plugin's own Host entry.
  const jspaceForm = ctx.configForms.get<JspaceSettings>(JSPACE_SETTINGS_NAMESPACE)
  const jspaceControl = {
    subscribe: (listener: () => void) => jspaceForm.subscribe(listener),
    getEnabled: () => {
      const snap = jspaceForm.getSnapshot()
      if (snap.status !== 'ready') return JSPACE_DEFAULT_ENABLED
      return snap.value?.jspaceEnabled ?? JSPACE_DEFAULT_ENABLED
    },
    set: (enabled: boolean) => jspaceForm.set(JSPACE_ENABLED_FIELD, enabled),
  }

  // Host reads behind the usage surfaces, adapted once so components never
  // touch the Remote carrier.
  const usageApi: UsageApi = {
    listProviders: async () => {
      const response = await ctx.remote.llm.listProviders()
      return response.ok
        ? { ok: true, value: response.value.map(provider => ({ provider: provider.id, displayName: provider.name })) }
        : { ok: false, error: response.error.message }
    },
    accountUsage: async (provider, signal) => {
      const response = await ctx.remote.usage.accountUsage({ provider }, signal)
      return response.ok ? response.value : { supported: true, error: response.error.message }
    },
    panel: async () => {
      const response = await ctx.remote.usage.panel()
      return response.ok ? { ok: true, value: response.value } : { ok: false, error: response.error.message }
    },
  }

  // Entry 1: the /model popupSelect over the shared directory.
  ctx.inject(['commandUi', 'modelDirectories'], (scope: ClientContext) => {
    const command = scope.get('commandUi') as CommandUiContract
    const models = scope.modelDirectories
    const sessions = scope.sessions
    scope.effect(() => command.register({
      name: 'model',
      label: () => t('command.label'),
      description: () => t('command.description'),
      icon: IconDataOutlineRegular,
      available: session => sessions.subagentAddress(session.sessionId) === undefined,
      ui: {
        kind: 'popupSelect',
        searchMode: 'fuzzy-label',
        searchLabels: () => ({
          placeholder: t('search.placeholder'),
          empty: t('empty.models'),
          noResults: t('search.empty'),
        }),
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
          const result = await directory.select(selection)
          if (!result.ok) {
            if (result.error.code === 'session/writer-held') throw new Error(t('error.sessionInUse'))
            throw result.error
          }
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
      children: {
        'conversation.input.model.label': { kind: 'single', scope: 'session', inline: true },
      },
      inject: (sessionId): ModelSelectInjected => {
        const directory = models.directoryFor(sessionId)
        const available = sessions.subagentAddress(sessionId) === undefined
        return {
          available,
          directory: directory.store,
          load: () => {
            if (available) directory.load().catch(() => { /* surfaced on the store */ })
          },
          resolveText: text => ctx.locale.resolveText(text),
          select: (selection: ModelSelection) => available
            ? directory.select(selection)
            : Promise.resolve(undefined),
          jspace: jspaceControl,
          agentPreset: {
            getSnapshot: () => {
              const value = sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
              return typeof value === 'string' ? value : undefined
            },
            subscribe: listener => sessions.list.subscribe(listener),
          },
          worker: {
            directory: worker.store,
            load: () => { worker.load().catch(() => { /* surfaced on the store */ }) },
            select: (selection: ModelSelection) => worker.select(selection).catch(() => false),
          },
        }
      },
    }, ModelSelect))

    const directory = currentDirectorySource(sessions, models)
    const loadAccountUsage = usageApi.accountUsage
    const openQuotas = (): void => { ctx.settingsNav.openSection('quotas') }
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'lan-remote',
      order: -20,
      locale: NS,
    }, RemoteChip))
    scope.slots.inject('sidebar.footer.action', () => scope.slots.register({
      name: 'sidebar.footer.action',
      id: 'usage-status',
      order: -10,
      locale: NS,
      inject: (): UsageStatusChipInjected => ({
        directory,
        workerDirectory: worker.store,
        ensureDirectory: (sessionId) => {
          if (sessions.subagentAddress(sessionId) !== undefined) return
          models.directoryFor(sessionId).load().catch(() => { /* surfaced on the store */ })
        },
        openModels: () => { ctx.settingsNav.openSection('models') },
        openQuotas,
        loadAccountUsage,
      }),
    }, UsageStatusChip))
    // The composer mirror of the chip's lead quota window, layered inside the
    // context meter beside the send button; ui-conversation owns the seat,
    // this package owns the reading.
    scope.slots.inject('conversation.input.meterCenter', () => scope.slots.register({
      name: 'conversation.input.meterCenter',
      locale: NS,
      inject: (): QuotaRingInjected => ({ directory, loadAccountUsage }),
    }, QuotaRing))
  })

  // Settings → Limits (quotas) then Status (local history). Independent
  // loads: opening one page must not wait on the other.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'quotas',
    order: 12,
    label: () => t('quotas.nav'),
    locale: NS,
    inject: (): QuotasSectionInjected => ({ api: usageApi }),
  }, QuotasSection))
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usages',
    order: 13,
    label: () => t('usages.nav'),
    locale: NS,
    inject: (): UsagesSectionInjected => ({ api: usageApi }),
  }, UsagesSection))
}
