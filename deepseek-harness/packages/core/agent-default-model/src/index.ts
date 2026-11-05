/**
 * Default model selection for an Agent without a session-specific selection.
 *
 * @module @deepseek-ai/dsh-agent-default-model
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile } from '@deepseek-ai/cordis'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ModelSelection } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-config-editor'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Default model selection for Agents created without an explicit model. */
    agentDefaultModel: AgentDefaultModelConfig
  }
}

/**
 * The settings namespace (composition entry id) shipped bundles mount this
 * plugin under. Settings surfaces write the worker fields through it.
 */
export const AGENT_DEFAULT_MODEL_SETTINGS_NAMESPACE = 'agent-default-model'

/** Preset id whose children use {@link AgentDefaultModelConfig.currentWorkerSelection}. */
export const WORKFLOW_PRESET_ID = 'workflow'

/** Config fields carrying the Workflow-mode worker model, independent of the Agent default. */
export const WORKFLOW_WORKER_MODEL_FIELDS = ['workerProvider', 'workerModel', 'workerReasoningEffort'] as const

/** Default model selection supplied by plugin configuration. */
export interface Config {
  /** Registered provider route. */
  provider: Volatile<string>
  /** Provider-owned model id. */
  model: Volatile<string>
  /** Adapter-owned reasoning effort; omission follows the provider default. */
  reasoningEffort: Volatile<string | undefined>
  /** Workflow worker provider route; omission makes workers inherit the planner's route. */
  workerProvider: Volatile<string | undefined>
  /** Workflow worker model id on {@link workerProvider}. */
  workerModel: Volatile<string | undefined>
  /** Workflow worker reasoning effort; omission follows the provider default. */
  workerReasoningEffort: Volatile<string | undefined>
}

const DEFAULT_FIELDS = ['provider', 'model', 'reasoningEffort'] as const

/** Copy every field of one stored config object except the named ones. */
function omit(current: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key)))
}

/** Project stored settings onto the Agent-facing selection type. */
function selection(settings: { provider: string; model: string; reasoningEffort?: string }): ModelSelection {
  return {
    provider: settings.provider,
    model: settings.model,
    ...settings.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(settings.reasoningEffort) },
  }
}

/**
 * Owns the default model selection independently of any Host or transport.
 * Each operation reads the owning Config references.
 */
export class AgentDefaultModelConfig extends Service {
  private saves: Promise<void> = Promise.resolve()

  static Config = z.object({
    provider: z.string().required().volatile(),
    model: z.string().required().volatile(),
    reasoningEffort: z.string().volatile(),
    workerProvider: z.string().volatile(),
    workerModel: z.string().volatile(),
    workerReasoningEffort: z.string().volatile(),
  })

  constructor(private readonly ownerContext: Context, private config: Config) {
    super(ownerContext, 'agentDefaultModel')

    ownerContext.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ownerContext.fiber)) })
  }

  /**
   * Read the current default model selection.
   * @returns a detached provider, model, and optional reasoning selection.
   */
  currentSelection(): ModelSelection {
    const reasoningEffort = this.config.reasoningEffort.get()
    return selection({
      provider: this.config.provider.get(), model: this.config.model.get(),
      ...reasoningEffort === undefined ? {} : { reasoningEffort },
    })
  }

  /**
   * Save the complete default model selection. A deployment without a configuration
   * editor keeps its composition entry. Saves commit in submission order; a failed
   * save rejects its caller without blocking later saves.
   * @param next - resolved selection accepted by an entry point.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveSelection(next: ModelSelection): Promise<void> {
    const config = {
      provider: next.provider, model: next.model,
      ...next.reasoningEffort === undefined ? {} : { reasoningEffort: String(next.reasoningEffort) },
    }
    // The worker fields share this entry; a default-model save keeps them.
    await this.edit(current => ({ ...omit(current, DEFAULT_FIELDS), ...config }))
  }

  /**
   * Read the worker model for Workflow-mode subagents and construction.
   * @returns a selection when one is stored, otherwise `undefined` (inherit parent).
   */
  currentWorkerSelection(): ModelSelection | undefined {
    const provider = this.config.workerProvider?.get()
    const model = this.config.workerModel?.get()
    if (provider === undefined || provider === '' || model === undefined || model === '') return undefined
    const reasoningEffort = this.config.workerReasoningEffort?.get()
    return selection({ provider, model, ...reasoningEffort === undefined || reasoningEffort === '' ? {} : { reasoningEffort } })
  }

  /**
   * Save the worker model used by Workflow-mode subagents and construction,
   * through the same owning profile entry as {@link saveSelection}.
   * @param next - resolved selection accepted by the Workflow picker.
   * @returns fulfillment after the optional profile write settles.
   */
  async saveWorkerSelection(next: ModelSelection): Promise<void> {
    await this.edit(current => ({
      ...omit(current, WORKFLOW_WORKER_MODEL_FIELDS),
      workerProvider: next.provider,
      workerModel: next.model,
      ...next.reasoningEffort === undefined ? {} : { workerReasoningEffort: String(next.reasoningEffort) },
    }))
  }

  /** Serialize one owning-entry edit behind earlier ones; a deployment without an editor keeps its entry. */
  private async edit(change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
    const entry = this.ownerContext.fiber.entry
    if (entry === undefined) return
    const editor = this.ctx.get('configEditor')
    if (editor === undefined) return
    const saved = this.saves.then(() => editor.edit(entry, current => change(current)))
    this.saves = saved.catch(() => {})
    await saved
  }
}

export default AgentDefaultModelConfig
