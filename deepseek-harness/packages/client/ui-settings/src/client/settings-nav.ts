/**
 * Cross-plugin door into the settings shell. The shell (ui-settings-general)
 * binds the open handler; features call {@link SettingsNavigation.openSection}
 * instead of reaching into the panel's local state. Collaboration stays a
 * cordis service because client plugins cannot value-import each other.
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    settingsNav: SettingsNavigation
  }
}

/** The `ctx.settingsNav` settings-shell navigation service. */
export class SettingsNavigation extends Service {
  private handler: ((id: string) => void) | undefined

  /**
   * @param ctx - providing plugin context.
   */
  constructor(ctx: Context) {
    super(ctx, 'settingsNav')
  }

  /**
   * Register the shell's open-section callback. Replaces any previous binder;
   * disposal restores a no-op so a remounted shell can bind again.
   * @param handler - open the settings panel on one section id.
   * @returns disposer that unbinds only this handler.
   */
  bind(handler: (id: string) => void): () => void {
    this.handler = handler
    return () => {
      if (this.handler === handler) this.handler = undefined
    }
  }

  /**
   * Open the settings panel on a registered section. No-op before the shell
   * binds, so a first-run click cannot race the occupant mount.
   * @param id - settings.section registration id (e.g. `models`).
   */
  openSection(id: string): void {
    this.handler?.(id)
  }
}
