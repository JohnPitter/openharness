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
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionRuntime } from '@deepseek-ai/dsh-client-runtime/client'
import { ModelDirectory } from './directory.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    modelDirectories: ModelDirectoryResolver
  }
}

/** Live mutable state in one holder (service methods run behind the caller-ctx tracker). */
interface LiveState {
  /** Per-session directories; entries are deleted by their scope disposer. */
  readonly directories: Map<SessionId, ModelDirectory>
}

interface ResolverConfig {
  /** Unroutable-provider copy. */
  readonly blockReason: () => string
  /** Workflow request-metered planner with no worker selected. */
  readonly workerBlockReason: () => string
  /** Current Workflow worker chip, or null when unset. */
  readonly workerSelected: () => { provider: string; model: string } | null
  /** Subscribe to worker-chip changes so the composer block can clear. */
  readonly subscribeWorker?: (listener: () => void) => () => void
}

/** The `ctx.modelDirectories` session model-selection service. */
export class ModelDirectoryResolver extends Service {
  static inject = ['connection', 'sessions', 'remote']

  private readonly live: LiveState = { directories: new Map() }
  private readonly blockReason: () => string
  private readonly workerBlockReason: () => string
  private readonly workerSelected: () => { provider: string; model: string } | null
  private readonly subscribeWorker: ((listener: () => void) => () => void) | undefined

  /**
   * @param ctx - owning root context (the service registers itself as `models`).
   * @param config - localized block copy and the Workflow worker chip.
   */
  constructor(ctx: Context, config: ResolverConfig) {
    super(ctx, 'modelDirectories')
    this.blockReason = config.blockReason
    this.workerBlockReason = config.workerBlockReason
    this.workerSelected = config.workerSelected
    this.subscribeWorker = config.subscribeWorker
    ctx.on('connection/reset', () => {
      for (const directory of this.live.directories.values()) directory.resetConnected()
    })
    // Either source can change the directory: registry topology commits,
    // settings documents that carry provider catalogs or default selection,
    // and credentials — a newly stored key is what makes a route appear in
    // the picker without a settings write.
    const refresh = (): void => {
      for (const directory of this.live.directories.values()) {
        directory.load().catch(() => undefined)
      }
    }
    ctx.remote.$on('llm/adapters-updated', refresh)
    ctx.remote.$on('settings/document-updated', refresh)
    ctx.remote.$on('credentials/reference-updated', refresh)
  }

  /**
   * Resolve the per-session shared directory (lazy; the scope disposer
   * removes and disposes it). Unknown sessions fail loud.
   * @param sessionId - the owning session.
   * @returns the resident directory both entries share.
   */
  directoryFor(sessionId: SessionId): ModelDirectory {
    const { live } = this
    const existing = live.directories.get(sessionId)
    if (existing !== undefined) return existing
    const sessions = this.ctx.get('sessions') as SessionRuntime
    const actx = sessions.scope(sessionId)
    if (actx === undefined) throw new Error(`ui-model-selection: session "${String(sessionId)}" resolved no scope`)
    const connection = this.ctx.get('connection') as ConnectionHandle
    const directory = new ModelDirectory(
      connection.api.sessions,
      sessionId,
      () => sessions.subagentAddress(sessionId) === undefined,
    )
    live.directories.set(sessionId, directory)
    // The composer cannot read this plugin (the dependency runs one way), so
    // the block is pushed: the Host says whether an adapter serves the
    // session's route, and only a definite `false` makes the input inert.
    // `null` — before the first load, or after one failed — must not, or a
    // slow or unreachable Host would lock a working composer.
    const conversation = this.ctx.get('conversation')
    if (conversation !== undefined) {
      const publish = (): void => {
        const snap = directory.store.getSnapshot()
        if (snap.routable === false) {
          conversation.blocks.set(sessionId, { reason: this.blockReason() })
          return
        }
        const preset = sessions.list.getSnapshot().byId[sessionId]?.agentPreset
        if (preset === 'workflow'
          && snap.currentMetering === 'requests'
          && this.workerSelected() === null) {
          conversation.blocks.set(sessionId, { reason: this.workerBlockReason() })
          return
        }
        conversation.blocks.set(sessionId, undefined)
      }
      publish()
      actx.effect(() => {
        const stops = [directory.store.subscribe(publish)]
        if (this.subscribeWorker !== undefined) stops.push(this.subscribeWorker(publish))
        stops.push(sessions.list.subscribe(publish))
        return () => {
          for (const stop of stops) stop()
          conversation.blocks.set(sessionId, undefined)
        }
      }, 'ui-model-selection: composer block')
    }
    actx.effect(() => () => {
      directory.dispose()
      live.directories.delete(sessionId)
    }, 'ui-model-selection: session directory')
    return directory
  }
}
