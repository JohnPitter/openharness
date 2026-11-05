/**
 * Live task-complete sound preference for General Settings and the desktop
 * completion postMessage. Host writes go through the bound scope; absent
 * compositions stay process-local.
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TASK_COMPLETE_SOUND, TASK_COMPLETE_SOUND_FIELD,
  type TaskCompleteSound,
} from '../../desktop-sound-settings.ts'
import type { ConversationSettings } from '../../submission-settings.ts'

export { DEFAULT_TASK_COMPLETE_SOUND } from '../../desktop-sound-settings.ts'

/** Snapshot store over the conversation settings sound field. */
export class TaskCompleteSoundPolicy {
  /** Reactive sound id for the Settings row and completion post. */
  readonly sound: SnapshotStore<TaskCompleteSound> = createSnapshotStore(DEFAULT_TASK_COMPLETE_SOUND)
  private readonly host: ConfigForm<ConversationSettings> | undefined
  private readonly unsubscribe: (() => void) | undefined

  /**
   * @param host - shared configuration form; absent compositions stay process-local.
   */
  constructor(host?: ConfigForm<ConversationSettings>) {
    this.host = host
    if (host !== undefined) {
      this.unsubscribe = host.subscribe(() => { this.adopt(host) })
      this.adopt(host)
    }
  }

  /** Release the preference subscription. */
  dispose(): void { this.unsubscribe?.() }

  /**
   * Persist and publish a catalog id.
   * @param sound - one of the closed TASK_COMPLETE_SOUNDS entries.
   */
  setSound(sound: TaskCompleteSound): void {
    if (this.sound.getSnapshot() === sound) return
    this.sound.set(sound)
    void this.host?.set(TASK_COMPLETE_SOUND_FIELD, sound)
  }

  /**
   * Adopt the scope's accepted durable section without writing it back.
   * @param host - the constructor-narrowed scope driving this adoption.
   */
  private adopt(host: ConfigForm<ConversationSettings>): void {
    const section = host.getSnapshot().value
    if (section === undefined) return
    if (this.sound.getSnapshot() !== section.taskCompleteSound) {
      this.sound.set(section.taskCompleteSound)
    }
  }
}
