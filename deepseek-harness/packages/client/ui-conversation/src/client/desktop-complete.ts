/**
 * OpenHarness desktop hook: when a root session goes running → idle, tell
 * the embedding shell so it can chime and, if the window is in the
 * background, raise a system notification. Subagent rows stay silent —
 * their parent is still the user-facing task.
 */
import type {
  ObservableSnapshot, SessionId, SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  DEFAULT_TASK_COMPLETE_SOUND, type TaskCompleteSound,
} from '../desktop-sound-settings.ts'

/** postMessage type the OpenHarness Wails shell listens for. */
export const DESKTOP_TASK_COMPLETE = 'openharness:task-complete'

/** postMessage type to audition a General-settings sound without finishing a task. */
export const DESKTOP_PREVIEW_SOUND = 'openharness:preview-sound'

/** One root session that just finished a run. */
export interface DesktopTaskComplete {
  /** Session that went idle. */
  sessionId: SessionId
  /** Durable title when the host has projected one, otherwise the list label. */
  title: string
  /** Catalog id from General settings. */
  sound: TaskCompleteSound
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
 * Whether any descendant (a dispatched subagent, or one it dispatched in
 * turn) of this session is currently running. `byId` carries every attached
 * session the host reports, including subagent children, regardless of
 * whether any catalog UI is open — a Workflow planner's own turn can end
 * (running: false) immediately after it dispatches a worker, well before
 * the worker finishes, so the planner's own running bit alone is not
 * enough to tell a real finish from a dispatch-and-idle.
 * @param sessionId - session whose descendants to check.
 * @param byId - current list rows.
 * @returns true when a child, grandchild, or deeper descendant is running.
 */
function hasRunningDescendant(sessionId: SessionId, byId: SessionListState['byId']): boolean {
  for (const row of Object.values(byId)) {
    if (row.parentId !== sessionId) continue
    if (row.running || hasRunningDescendant(row.id, byId)) return true
  }
  return false
}

/**
 * Diff busy bits against the previous observation. First sight of a session
 * only records the bit — sessions already idle at bind do not chime. A
 * root's busy bit is its own running flag OR any running descendant's, so
 * a planner that idles right after dispatching a still-working subagent
 * stays "busy" until that subagent (and any of its own descendants) also
 * finishes. A root that stopped running because it is now blocking on the
 * user (an approval, a plan review, or a question — the sidebar amber-dot
 * state) has not finished its task either; the eventual real idle, once
 * `pendingInteraction` clears and no descendant is running, still fires.
 * @param prev - last observed busy bit per session.
 * @param byId - current list rows.
 * @param sound - live preference id stamped onto each completion.
 * @returns the next busy map and every root that just went idle.
 */
export function rootTaskCompletions(
  prev: ReadonlyMap<SessionId, boolean>,
  byId: SessionListState['byId'],
  sound: TaskCompleteSound = DEFAULT_TASK_COMPLETE_SOUND,
): { next: Map<SessionId, boolean>; completed: DesktopTaskComplete[] } {
  const next = new Map<SessionId, boolean>()
  const completed: DesktopTaskComplete[] = []
  for (const [sessionId, row] of Object.entries(byId) as [SessionId, SessionSummary][]) {
    if (!isRootTaskSession(row)) { next.set(sessionId, row.running); continue }
    const busy = row.running || hasRunningDescendant(sessionId, byId)
    next.set(sessionId, busy)
    if (prev.get(sessionId) === true && !busy && row.pendingInteraction === undefined) {
      completed.push({ sessionId, title: row.title ?? row.displayTitle, sound })
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
  window.parent.postMessage({
    type: DESKTOP_TASK_COMPLETE,
    title: event.title,
    sound: event.sound,
  }, '*')
}

/**
 * Ask the embedding shell to play one catalog entry (General settings preview).
 * @param sound - preference id to audition.
 */
export function postDesktopPreviewSound(sound: TaskCompleteSound): void {
  if (typeof window === 'undefined' || window.parent === window) return
  window.parent.postMessage({ type: DESKTOP_PREVIEW_SOUND, sound }, '*')
}

/**
 * Subscribe to the session list and emit each root running → idle edge.
 * @param list - sessions.list snapshot store.
 * @param post - test-injected sink; production posts to the parent window.
 * @param soundOf - live preference reader; defaults to the catalog default.
 * @returns unsubscribe.
 */
export function watchDesktopTaskComplete(
  list: ObservableSnapshot<SessionListState>,
  post?: (event: DesktopTaskComplete) => void,
  soundOf?: () => TaskCompleteSound,
): () => void {
  const sink = post ?? postDesktopTaskComplete
  const soundReader = soundOf ?? (() => DEFAULT_TASK_COMPLETE_SOUND)
  let prev = new Map<SessionId, boolean>()
  const emit = (): void => {
    const { next, completed } = rootTaskCompletions(prev, list.getSnapshot().byId, soundReader())
    prev = next
    for (const event of completed) sink(event)
  }
  emit()
  return list.subscribe(emit)
}
