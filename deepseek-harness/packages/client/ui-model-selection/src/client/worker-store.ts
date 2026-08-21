/**
 * Workflow-mode worker model: persisted in the `workflow-worker-model`
 * settings section, independent of the session's orchestrator selection.
 */
import type { IApiClient, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace owned by `@deepseek-ai/dsh-agent-default-model`. */
export const WORKFLOW_WORKER_MODEL_NS = 'workflow-worker-model'

/** Snapshot the worker picker renders from. */
export interface WorkerModelState {
  current: ModelSelection | null
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  error: string | null
}

/**
 * Load and save the Workflow worker model through settings RPCs.
 */
export class WorkerModelStore {
  readonly store: SnapshotStore<WorkerModelState> = createSnapshotStore<WorkerModelState>({
    current: null, status: 'idle', error: null,
  })

  private generation = 0
  private disposed = false

  constructor(private readonly settings: Pick<IApiClient['settings'], 'describe' | 'replace'>) {}

  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    const { result } = await this.settings.describe({})
    if (this.disposed || generation !== this.generation) return
    if (!result.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
      return
    }
    const view = result.value.namespaces.find(namespace => namespace.ns === WORKFLOW_WORKER_MODEL_NS)
    const value = view?.value
    const current = selectionOf(value)
    this.store.update((s) => {
      s.current = current
      s.status = 'ready'
      s.error = null
    })
  }

  async select(selection: ModelSelection): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'selecting'; s.error = null })
    const { result } = await this.settings.replace({
      ns: WORKFLOW_WORKER_MODEL_NS,
      section: {
        provider: selection.provider,
        model: selection.model,
        ...selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort },
      },
    })
    if (this.disposed || generation !== this.generation) {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      return
    }
    if (!result.ok) {
      this.store.update((s) => { s.status = 'error'; s.error = `${result.error.code}: ${result.error.message}` })
      throw new Error(`settings.replace failed: ${result.error.code}: ${result.error.message}`)
    }
    this.store.update((s) => {
      s.current = selection
      s.status = 'ready'
      s.error = null
    })
  }

  dispose(): void {
    this.disposed = true
  }
}

function selectionOf(value: unknown): ModelSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
  if (typeof record.provider !== 'string' || record.provider === '') return null
  if (typeof record.model !== 'string' || record.model === '') return null
  return {
    provider: record.provider,
    model: record.model,
    ...typeof record.reasoningEffort === 'string' && record.reasoningEffort !== ''
      ? { reasoningEffort: record.reasoningEffort }
      : {},
  }
}
