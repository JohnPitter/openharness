/**
 * Model selection plugin, node half: registers the durable J-space toggle and
 * the system-prompt section it gates. The browser half ships via
 * exports["./client"].
 */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import {
  JSPACE_DEFAULT_ENABLED, JSPACE_SETTINGS_NAMESPACE, JSPACE_SKILL_NAME, JspaceSettingsSchema,
  jspaceProtocolForAssembly, type JspaceSettings,
} from './jspace-settings.ts'

export {
  JSPACE_DEFAULT_ENABLED, JSPACE_ENABLED_FIELD, JSPACE_PROTOCOL,
  JSPACE_SETTINGS_NAMESPACE, JSPACE_SKILL_NAME, jspaceProtocolText,
} from './jspace-settings.ts'

const NS = settingsNamespace(JSPACE_SETTINGS_NAMESPACE)

/** Wait for the prompt registry; settings is optional until the file provider mounts. */
export const inject = ['systemPrompt']

/** Prompt-section name: sits just after the deployment/preset persona (order 0). */
export const JSPACE_SECTION = 'jspace:protocol'

/** Read the stored toggle, defaulting on when the namespace is absent. */
function readEnabled(ctx: Context): boolean {
  const settings = ctx.get('settings')
  if (settings === undefined) return JSPACE_DEFAULT_ENABLED
  const section = settings.get(NS) as JspaceSettings | undefined
  if (section === undefined) return JSPACE_DEFAULT_ENABLED
  return section.enabled
}

function composedPresetOf(context: AssembleContext): string | undefined {
  const agent = (context as AssembleContext & {
    agent?: { ctx?: { get: (name: string) => unknown } }
  }).agent
  const ctx = agent?.ctx
  if (ctx === undefined) return undefined
  const presets = ctx.get('agentPresets') as {
    composedPreset?: (inner: typeof ctx) => string | undefined
  } | undefined
  return presets?.composedPreset?.(ctx)
}

function delegationDepthOf(context: AssembleContext): number {
  const agent = (context as AssembleContext & {
    agent?: {
      session?: { header?: { delegationDepth?: number } }
      options?: { subagentDepth?: number }
    }
  }).agent
  return Math.max(agent?.session?.header?.delegationDepth ?? 0, agent?.options?.subagentDepth ?? 0)
}

/**
 * Register the settings namespace and the gated prompt section.
 * @param ctx - Host context carrying systemPrompt (and optionally settings).
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(NS, JspaceSettingsSchema)
  })
  ctx.effect(() => ctx.systemPrompt.section({
    name: JSPACE_SECTION,
    order: 1,
    text: (context) => jspaceProtocolForAssembly(
      readEnabled(ctx),
      composedPresetOf(context),
      delegationDepthOf(context),
    ),
  }), 'jspace.section()')
  ctx.inject(['skills', 'settings'], (gateCtx) => {
    let hide: (() => void) | undefined
    const sync = (): void => {
      hide?.()
      hide = undefined
      if (!readEnabled(gateCtx)) hide = gateCtx.skills.hideFromModel(JSPACE_SKILL_NAME)
    }
    sync()
    gateCtx.on('settings/updated', (ns) => {
      if (ns === NS) sync()
    })
    gateCtx.effect(() => () => { hide?.() }, 'jspace.hideFromModel()')
  })
}
