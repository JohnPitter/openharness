/**
 * Model selection plugin, node half: owns the durable J-space toggle (this
 * entry's `jspaceEnabled` config field, which the composer writes through the
 * settings namespace of the same entry id) and the system-prompt section it
 * gates. The browser half ships via exports["./client"].
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-skill'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import {
  JSPACE_DEFAULT_ENABLED, JSPACE_ENABLED_FIELD, JSPACE_SKILL_NAME, jspaceProtocolForAssembly,
} from './jspace-settings.ts'

export {
  JSPACE_DEFAULT_ENABLED, JSPACE_ENABLED_FIELD, JSPACE_PROTOCOL,
  JSPACE_SETTINGS_NAMESPACE, JSPACE_SKILL_NAME, jspaceProtocolText,
} from './jspace-settings.ts'

/** Wait for the prompt registry; settings is optional until the file provider mounts. */
export const inject = ['systemPrompt']

/** Prompt-section name: sits just after the deployment/preset persona. */
export const JSPACE_SECTION = 'jspace:protocol'

/** Live entry config: the J-space toggle the composer writes. */
export interface Config {
  /** Whether the construction protocol is injected and `j-space` stays model-visible. */
  jspaceEnabled: Volatile<boolean>
}

export const Config = z.object({
  [JSPACE_ENABLED_FIELD]: z.boolean().default(JSPACE_DEFAULT_ENABLED).volatile(),
})

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
export function apply(ctx: Context, config: Config): void {
  // The composer menu owns this field; no generic settings form.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  const readEnabled = (_ctx?: Context): boolean => config.jspaceEnabled?.get() ?? JSPACE_DEFAULT_ENABLED
  ctx.effect(() => ctx.systemPrompt.section({
    name: JSPACE_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
    text: (context) => jspaceProtocolForAssembly(
      readEnabled(),
      composedPresetOf(context),
      delegationDepthOf(context),
    ),
  }), 'jspace.section()')
  // The Loader scopes volatile notifications to this entry's own fiber, so the
  // listener lives on `ctx` and drives whichever gate the skills scope mounted.
  let resync: (() => void) | undefined
  ctx.on('loader/volatile-update', () => { resync?.() })
  ctx.inject(['skills'], (gateCtx) => {
    let hide: (() => void) | undefined
    const sync = (): void => {
      hide?.()
      hide = undefined
      if (!readEnabled(gateCtx)) hide = gateCtx.skills.hideFromModel(JSPACE_SKILL_NAME)
    }
    sync()
    resync = sync
    gateCtx.effect(() => () => {
      hide?.()
      if (resync === sync) resync = undefined
    }, 'jspace.hideFromModel()')
  })
}
