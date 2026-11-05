/**
 * Workflow-mode worker model: persisted as the worker fields of the
 * `agent-default-model` Host entry (`workerProvider`, `workerModel`,
 * `workerReasoningEffort`), independent of the session's planner selection.
 */
import type { ModelSelection } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Host entry (settings namespace) owned by `@deepseek-ai/dsh-agent-default-model`. */
export const WORKFLOW_WORKER_MODEL_NS = 'agent-default-model'

/** Snapshot the worker picker renders from. */
export interface WorkerModelState {
  current: ModelSelection | null
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error'
  error: string | null
}

/** The slice of one shared configuration form this store reads and writes. */
export interface WorkerModelForm {
  getSnapshot: () => { status: 'loading' | 'ready' | 'unavailable'; value: unknown }
  subscribe: (listener: () => void) => () => void
  mutate: (ops: readonly SettingsPathOpView[]) => Promise<boolean>
}

/** Mirror the worker fields of the shared form and write a complete worker selection. */
export class WorkerModelStore {
  readonly store: SnapshotStore<WorkerModelState> = createSnapshotStore<WorkerModelState>({
    current: null, status: 'idle', error: null,
  })

  private readonly unsubscribe: () => void

  constructor(private readonly form: WorkerModelForm) {
    this.unsubscribe = form.subscribe(() => { this.sync() })
    this.sync()
  }

  /** The shared form loads itself; this only republishes its current value. */
  load(): Promise<void> {
    this.sync()
    return Promise.resolve()
  }

  /**
   * Save one complete worker selection.
   * @param selection - provider, model, and optional effort.
   * @returns whether the Host accepted the write.
   */
  async select(selection: ModelSelection): Promise<boolean> {
    this.store.update((s) => { s.status = 'selecting'; s.error = null })
    const ops: SettingsPathOpView[] = [
      { op: 'set', path: ['workerProvider'], value: selection.provider },
      { op: 'set', path: ['workerModel'], value: selection.model },
      selection.reasoningEffort === undefined
        ? { op: 'unset', path: ['workerReasoningEffort'] }
        : { op: 'set', path: ['workerReasoningEffort'], value: String(selection.reasoningEffort) },
    ]
    let accepted: boolean
    try { accepted = await this.form.mutate(ops) }
    catch (error: unknown) {
      this.store.update((s) => { s.status = 'error'; s.error = error instanceof Error ? error.message : String(error) })
      throw error
    }
    if (!accepted) {
      this.store.update((s) => { s.status = 'error'; s.error = 'settings refused the worker model' })
      return false
    }
    this.store.update((s) => { s.current = selection; s.status = 'ready'; s.error = null })
    return true
  }

  dispose(): void {
    this.unsubscribe()
  }

  private sync(): void {
    const snapshot = this.form.getSnapshot()
    if (snapshot.status !== 'ready') {
      this.store.update((s) => { if (s.status !== 'selecting') s.status = snapshot.status === 'loading' ? 'loading' : 'idle' })
      return
    }
    const current = selectionOf(snapshot.value)
    this.store.update((s) => {
      s.current = current
      if (s.status !== 'selecting') s.status = 'ready'
      s.error = null
    })
  }
}

function selectionOf(value: unknown): ModelSelection | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as { workerProvider?: unknown; workerModel?: unknown; workerReasoningEffort?: unknown }
  if (typeof record.workerProvider !== 'string' || record.workerProvider === '') return null
  if (typeof record.workerModel !== 'string' || record.workerModel === '') return null
  return {
    provider: record.workerProvider,
    model: record.workerModel,
    ...typeof record.workerReasoningEffort === 'string' && record.workerReasoningEffort !== ''
      ? { reasoningEffort: record.workerReasoningEffort as NonNullable<ModelSelection['reasoningEffort']> }
      : {},
  }
}
