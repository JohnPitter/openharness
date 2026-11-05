/** J-space preference stored in the Host user-settings document. */

/**
 * Settings namespace (Host entry id) of this plugin's node half, which owns
 * the composer J-space toggle in shipped bundles.
 */
export const JSPACE_SETTINGS_NAMESPACE = 'ui-model-selection'

/** Config field carrying whether the construction protocol is on. */
export const JSPACE_ENABLED_FIELD = 'jspaceEnabled'

/** Bundled skill the composer toggle hides from model invocation. */
export const JSPACE_SKILL_NAME = 'j-space'

/** Default: on, matching the previous hardcoded persona. */
export const JSPACE_DEFAULT_ENABLED = true

/** The J-space slice of this entry's settings section as the browser reads it. */
export interface JspaceSettings {
  /**
   * When true, the system prompt injects the construction protocol.
   * When false, that section is empty and `j-space` is hidden from the model catalog and `skill` tool.
   */
  jspaceEnabled?: boolean
}

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

/**
 * Resolve the J-space system-prompt body for one assembly.
 * A Workflow planner (depth 0) never receives the protocol: it cannot Read
 * skill modules, and the text would instruct a wasted `skill` load.
 * Workers and every other preset follow the toggle.
 * @param enabled - whether J-space is on.
 * @param composedPreset - the assembling agent's preset id, when known.
 * @param delegationDepth - the assembling agent's delegation depth.
 * @returns protocol prose, or empty to omit the section.
 */
export function jspaceProtocolForAssembly(
  enabled: boolean,
  composedPreset: string | undefined,
  delegationDepth: number,
): string {
  if (composedPreset === 'workflow' && delegationDepth === 0) return ''
  return jspaceProtocolText(enabled)
}
