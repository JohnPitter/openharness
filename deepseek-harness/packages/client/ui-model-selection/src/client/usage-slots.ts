/**
 * Injected face of the sidebar usage-status chip.
 */
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { AccountUsageView, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'

export interface UsageStatusChipInjected {
  /** Staged session's shared model directory. */
  directory: HostObservable<ModelDirectoryState> | SnapshotStore<ModelDirectoryState>
  /** Load the staged session's advisory catalog (errors land on the store). */
  ensureDirectory: (sessionId: SessionId) => void
  /** Open Settings on the Models section. */
  openModels: () => void
  /** Open Settings on the Usage section (all provider quotas). */
  openUsages: () => void
  /** Account-level quota for the staged provider, using its stored key. */
  loadAccountUsage: (provider: string) => Promise<AccountUsageView>
}
