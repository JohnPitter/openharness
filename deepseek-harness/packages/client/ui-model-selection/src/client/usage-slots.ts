/**
 * Injected face of the sidebar usage-status chip.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountUsageView, UsagePanelView } from '@deepseek-ai/dsh-api-session-controller/types'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import type { WorkerModelState } from './worker-store.ts'

export interface UsageStatusChipInjected {
  /** Staged session's shared model directory. */
  directory: HostObservable<ModelDirectoryState> | SnapshotStore<ModelDirectoryState>
  /** Load the staged session's advisory catalog (errors land on the store). */
  ensureDirectory: (sessionId: SessionId) => void
  /** Open Settings on the Models section. */
  openModels: () => void
  /** Open Settings on the Limits section (all provider quotas). */
  openQuotas: () => void
  /** Account-level quota for the staged provider, using its stored key. */
  loadAccountUsage: (provider: string, signal?: AbortSignal) => Promise<AccountUsageView>
  /**
   * Workflow-mode worker chip, present only while a worker store is mounted.
   * The panel adds a compact worker route + quota block only while the
   * staged session's preset is 'workflow' and a worker model is selected.
   */
  workerDirectory?: HostObservable<WorkerModelState> | SnapshotStore<WorkerModelState>
}

/** Injected face of the composer account-quota inner ring. */
export interface QuotaRingInjected {
  /** Current-session shared model directory, the provider source. */
  directory: HostObservable<ModelDirectoryState> | SnapshotStore<ModelDirectoryState>
  /** Account-level quota for the staged provider, using its stored key. */
  loadAccountUsage: (provider: string, signal?: AbortSignal) => Promise<AccountUsageView>
}

/** One registered provider route the Limits page probes. */
export interface UsageProviderEntry {
  provider: string
  displayName: string
}

/** A read that either answered or carries the message to show in its place. */
export type UsageRead<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Host reads behind the usage surfaces (`usage.accountUsage`, `usage.panel`,
 * `llm.listProviders`), adapted once by the plugin body so the components
 * never touch the Remote carrier.
 */
export interface UsageApi {
  /** Registered provider routes, in registry order. */
  listProviders: () => Promise<UsageRead<readonly UsageProviderEntry[]>>
  /** Account-level quota for one route; a failed probe rides `error`. */
  accountUsage: (provider: string, signal?: AbortSignal) => Promise<AccountUsageView>
  /** Host-local request and token history. */
  panel: () => Promise<UsageRead<UsagePanelView>>
}
