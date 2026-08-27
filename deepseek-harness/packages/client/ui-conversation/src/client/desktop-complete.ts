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
 * Diff running bits against the previous observation. First sight of a
 * session only records the bit — sessions already idle at bind do not chime.
 * @param prev - last observed running bit per session.
 * @param byId - current list rows.
 * @param sound - live preference id stamped onto each completion.
 * @returns the next running map and every root that just went idle.
 */
export function rootTaskCompletions(
  prev: ReadonlyMap<SessionId, boolean>,
  byId: SessionListState['byId'],
  sound: TaskCompleteSound = DEFAULT_TASK_COMPLETE_SOUND,
): { next: Map<SessionId, boolean>; completed: DesktopTaskComplete[] } {
  const next = new Map<SessionId, boolean>()
  const completed: DesktopTaskComplete[] = []
  for (const [sessionId, row] of Object.entries(byId) as [SessionId, SessionSummary][]) {
    next.set(sessionId, row.running)
    if (!isRootTaskSession(row)) continue
    if (prev.get(sessionId) === true && !row.running) {
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
