/**
 * ModelDirectoryResolver (`ctx.modelDirectories`): the root owner of per-session
 * {@link ModelDirectory} instances. Both selection entries (the /model popup
 * and the composer model seat) resolve their session's directory through
 * this service, which is what makes the dual entry one shared state.
 *
 * Per-session storage follows the client service pattern (InputTriggerService /
 * CommandUiRuntime): a lazy service-internal map whose entry is deleted by the
 * owning scope's disposer. The host `dsh-scope` ScopedLayers registry does
 * does not belong here: it derives scope from the host carrier mechanism
 * (object-keyed), while client scopes tag contexts with branded SessionId
 * strings, and it models global+shadow named registries — this is a
 * per-session singleton with no global layer to merge.
 */
import type {} from '@deepseek-ai/dsh-client-product-analytics/client'
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionBinding } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { WeakMapWithValues } from '@deepseek-ai/dsh-util-values'
import { ModelCatalogDirectory } from './catalog.ts'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Directories keyed by Client binding, removed by their scope disposer. */
  readonly directories: WeakMapWithValues<SessionBinding, ModelDirectory>
}

/** Composer-block copy and Workflow worker inputs supplied by the plugin body. */
export interface ResolverConfig {
  /** Workflow request-metered planner with no worker selected. */
  readonly workerBlockReason?: () => string
  /** Current Workflow worker selection, or null when unset. */
  readonly workerSelected?: () => { provider: string; model: string } | null
  /** Subscribe to worker-selection changes so the composer block can clear. */
  readonly subscribeWorker?: (listener: () => void) => () => void
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['sessions', 'remote', 'remote.session']

  private readonly live: LiveState = { directories: new WeakMapWithValues() }
  private readonly catalog: ModelCatalogDirectory

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   */
  constructor(ctx: Context, private readonly config: ResolverConfig = {}) {
    super(ctx, 'modelDirectories')
    this.catalog = new ModelCatalogDirectory(ctx)
    void this.catalog.load().catch(() => { /* selectors expose the shared error */ })
    ctx.on('connection/reset', () => {
      this.catalog.resetGeneration()
      for (const directory of this.live.directories.values) directory.resetConnected()
    })
    ctx.remote.$on('llm/adapters-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('llm/models-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('settings/document-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/record-updated', () => { this.catalog.refresh() })
    ctx.remote.$on('credentials/reference-updated', () => { this.catalog.refresh() })
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const sessions = this.ctx.sessions
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const binding = sessions.binding(sessionId)
    if (binding === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no binding`)
    const existing = live.directories.get(binding)
    if (existing !== undefined) return existing
    const directory = new ModelDirectory(
      this.ctx.remote.session,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
      this.catalog,
      binding.session.projections.faceOf('modelSelection'),
      () => binding.session.getSnapshot().blank,
      (name, attributes) => this.ctx.get('productAnalytics')?.track(name, attributes),
    )
    live.directories.set(binding, directory)
    this.publishComposerBlock(sessionId, directory, actx)
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(binding)
    }, 'ui-model-selection: session directory')
    return directory
  }

  /**
   * Push the Workflow composer block for one session (the composer cannot
   * read this plugin; the dependency runs one way). A Workflow session whose
   * planner bills per request blocks until a worker is chosen: delegation
   * would otherwise inherit the planner's request-metered route. Catalog
   * membership alone never blocks — an unavailable selection keeps the
   * composer usable.
   */
  private publishComposerBlock(sessionId: SessionId, directory: ModelDirectory, actx: Context): void {
    const conversation = this.ctx.get('conversation')
    const { workerBlockReason, workerSelected, subscribeWorker } = this.config
    if (conversation === undefined || workerBlockReason === undefined) return
    const sessions = this.ctx.sessions
    const publish = (): void => {
      const snap = directory.store.getSnapshot()
      const preset = sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.agentPreset
      if (preset === 'workflow' && snap.currentMetering === 'requests' && workerSelected?.() === null) {
        conversation.blocks.set(sessionId, { reason: workerBlockReason() })
        return
      }
      conversation.blocks.set(sessionId, undefined)
    }
    publish()
    actx.effect(() => {
      const stops = [directory.store.subscribe(publish), sessions.list.subscribe(publish)]
      if (subscribeWorker !== undefined) stops.push(subscribeWorker(publish))
      return () => {
        for (const stop of stops) stop()
        conversation.blocks.set(sessionId, undefined)
      }
    }, 'ui-model-selection: composer block')
  }
}
