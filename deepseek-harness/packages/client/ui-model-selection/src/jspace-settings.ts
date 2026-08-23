/** J-space preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the composer J-space toggle. */
export const JSPACE_SETTINGS_NAMESPACE = 'ui-jspace'

/** Field carrying whether the construction protocol is on. */
export const JSPACE_ENABLED_FIELD = 'enabled'

/** Bundled skill the composer toggle hides from model invocation. */
export const JSPACE_SKILL_NAME = 'j-space'

/** Default: on, matching the previous hardcoded persona. */
export const JSPACE_DEFAULT_ENABLED = true

/** Durable J-space section shared by the Host schema and the browser scope. */
export interface JspaceSettings {
  /**
   * When true, the system prompt injects the construction protocol.
   * When false, that section is empty and `j-space` is hidden from the model catalog and `skill` tool.
   */
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
  'J-Space is the construction protocol. For implementation, multi-file edits, debugging, planning, or any work you cannot check in one glance: classify the task as fast/full/loop and operate that pass.',
  'Load the `j-space` skill at most once if its body is not already in this conversation. After that, Read listed modules from its resource base. Never call the skill tool again for j-space.',
  'When you spawn workers, name the pass in the task prompt; do not tell them to reload j-space.',
].join(' ')

/**
 * Resolve the system-prompt body for the current toggle.
 * @param enabled - whether J-space is on.
 * @returns protocol prose, or empty to omit the section.
 */
export function jspaceProtocolText(enabled: boolean): string {
  return enabled ? JSPACE_PROTOCOL : ''
}
