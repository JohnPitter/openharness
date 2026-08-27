/**
 * OpenHarness desktop hook: when a root session goes running → idle, tell
 * the embedding shell so it can chime and, if the window is in the
 * background, raise a system notification. Subagent rows stay silent —
 * their parent is still the user-facing task.
 */
import type {
  ObservableSnapshot, SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'

/** postMessage type the OpenHarness Wails shell listens for. */
export const DESKTOP_TASK_COMPLETE = 'openharness:task-complete'

/** One root session that just finished a run. */
export interface DesktopTaskComplete {
  /** Session that went idle. */
  sessionId: SessionId
  /** Durable title when the host has projected one, otherwise the list label. */
  title: string
}

/**
 * True for a user-facing session. Catalog children and breadcrumb subagent
 * rows belong to a parent that is still the task.
 * @param row - list summary.
 */
export function isRootTaskSession(row: Pick<SessionSummary, 'parentId' | 'origin'>): boolean {
  return row.parentId === undefined && row.origin !== 'subagent'
}

/**
 * Diff running bits against the previous observation. First sight of a
 * session only records the bit — sessions already idle at bind do not chime.
 * @param prev - last observed running bit per session.
 * @param byId - current list rows.
 * @returns the next running map and every root that just went idle.
 */
export function rootTaskCompletions(
  prev: ReadonlyMap<SessionId, boolean>,
  byId: SessionListState['byId'],
): { next: Map<SessionId, boolean>; completed: DesktopTaskComplete[] } {
  const next = new Map<SessionId, boolean>()
  const completed: DesktopTaskComplete[] = []
  for (const [sessionId, row] of Object.entries(byId) as [SessionId, SessionSummary][]) {
    next.set(sessionId, row.running)
    if (!isRootTaskSession(row)) continue
    if (prev.get(sessionId) === true && !row.running) {
      completed.push({ sessionId, title: row.title ?? row.displayTitle })
    }
  }
  return { next, completed }
}

/**
 * Default sink: post to the embedding OpenHarness window. A top-level
 * browser tab is a no-op.
 * @param event - root session that just went idle.
 */
export function postDesktopTaskComplete(event: DesktopTaskComplete): void {
  if (typeof window === 'undefined' || window.parent === window) return
  window.parent.postMessage({ type: DESKTOP_TASK_COMPLETE, title: event.title }, '*')
}

/**
 * Subscribe to the session list and emit each root running → idle edge.
 * @param list - sessions.list snapshot store.
 * @param post - test-injected sink; production posts to the parent window.
 * @returns unsubscribe.
 */
export function watchDesktopTaskComplete(
  list: ObservableSnapshot<SessionListState>,
  post: (event: DesktopTaskComplete) => void = postDesktopTaskComplete,
): () => void {
  let prev = new Map<SessionId, boolean>()
  const emit = (): void => {
    const { next, completed } = rootTaskCompletions(prev, list.getSnapshot().byId)
    prev = next
    for (const event of completed) post(event)
  }
  emit()
  return list.subscribe(emit)
}
