/** J-space preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the composer J-space toggle. */
export const JSPACE_SETTINGS_NAMESPACE = 'ui-jspace'

/** Field carrying whether the construction protocol is on. */
export const JSPACE_ENABLED_FIELD = 'enabled'

/** Default: on, matching the previous hardcoded persona. */
export const JSPACE_DEFAULT_ENABLED = true

/** Durable J-space section shared by the Host schema and the browser scope. */
export interface JspaceSettings {
  /** When true, the system prompt tells the agent to load and follow j-space. */
  enabled: boolean
}

/** Durable schema; also the wire envelope the browser scope validates against. */
export const JspaceSettingsSchema: z<JspaceSettings> = z.object({
  [JSPACE_ENABLED_FIELD]: z.boolean().default(JSPACE_DEFAULT_ENABLED),
})

/**
 * Prompt fragment injected after the persona while J-space is on.
 * Empty string drops the section at render.
 */
export const JSPACE_PROTOCOL = [
  'J-Space is the construction protocol. For implementation, multi-file edits, debugging, planning, or any work you cannot check in one glance: load the `j-space` skill first, classify the task as fast/full/loop, and operate that pass.',
  'Load only the modules the pass needs. Keep verification at the gate\'s floor. One-glance answers may skip it.',
  'When you spawn workers, instruct them to load `j-space` and follow that pass.',
].join(' ')

/**
 * Resolve the system-prompt body for the current toggle.
 * @param enabled - whether J-space is on.
 * @returns protocol prose, or empty to omit the section.
 */
export function jspaceProtocolText(enabled: boolean): string {
  return enabled ? JSPACE_PROTOCOL : ''
}
