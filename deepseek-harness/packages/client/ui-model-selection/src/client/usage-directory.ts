/**
 * Current-session model directory as a root-scoped observable. The sidebar
 * chip is not session-scoped, so it cannot receive `useDirectory` from a
 * provide kit; this source rebinds whenever `list.current` moves.
 */

import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelDirectoryState } from './directory.ts'
import type { ModelDirectoryResolver } from './service.ts'

const EMPTY_DIRECTORY: ModelDirectoryState = {
  current: null,
  routable: null,
  currentMetering: null,
  groups: [],
  failures: [],
  status: 'idle',
  error: null,
}

/**
 * Observable of the staged session's model directory snapshot.
 * @param sessions - list + current selection.
 * @param models - per-session directory owner.
 * @returns a stable source the slot renderer binds to `useDirectory`.
 */
export function currentDirectorySource(
  sessions: ISessions,
  models: ModelDirectoryResolver,
): HostObservable<ModelDirectoryState> {
  const directoryOf = (id: SessionId | undefined) => {
    if (id === undefined) return undefined
    try {
      return models.directoryFor(id)
    } catch {
      return undefined
    }
  }

  return {
    getSnapshot: () =>
      directoryOf(sessions.list.getSnapshot().current)?.store.getSnapshot() ?? EMPTY_DIRECTORY,
    subscribe: (listener) => {
      let unsubDir = (): void => {}
      const rebind = (): void => {
        unsubDir()
        const directory = directoryOf(sessions.list.getSnapshot().current)
        unsubDir = directory === undefined ? () => {} : directory.store.subscribe(listener)
      }
      rebind()
      const unsubList = sessions.list.subscribe(() => {
        rebind()
        listener()
      })
      return () => {
        unsubList()
        unsubDir()
      }
    },
  }
}
