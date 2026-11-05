/**
 * Shared in-process child composition: the delegation-depth budget, the
 * durable session metadata, the resolved child `AgentOptions`, the delegated
 * policy seed, and the scoped setup used by local activations.
 *
 * @module @deepseek-ai/dsh-subagent/child-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
// Type-only: make `ctx.get('sandboxPolicy')`, `ctx.get('approval')`, and
// `ctx.get('permissionPresets')` resolve to their services when composed — delegation consumes them
// opportunistically (the documented `ctx.get` pattern), never as a hard dep —
// and merge the inherited permission session-event payloads.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
// Type-only: make `ctx.get('agentPresets')` resolve to the preset roster when
// composed — a child inherits its parent's composition opportunistically (the
// documented `ctx.get` pattern), never as a hard dep. A rosterless deployment
// keeps its model-facing rows on the host plane, where the child already sees
// them through the tool registry's global layer.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { delegationDepthOf } from './depth.ts'
import { SubagentError } from './error.ts'

/** Thrown when starting a child would exceed the requested depth cap. */
export class SubagentDepthError extends Error {
  constructor(public readonly attemptedDepth: number, public readonly maxDepth: number) {
    super(`subagent depth ${attemptedDepth} exceeds maxDepth ${maxDepth}`)
    this.name = 'SubagentDepthError'
  }
}

/**
 * Workflow child creation refused because the planner is request-metered and
 * no worker model is selected. The child must not inherit that route.
 */
export class WorkflowWorkerRequiredError extends Error {
  constructor() {
    super('Workflow requires an explicit worker model when the planner is request-metered')
    this.name = 'WorkflowWorkerRequiredError'
  }
}

/**
 * Resolve the child's delegation depth from its parent and enforce an optional
 * cap. The persisted parent header is the monotone floor, so a resumed parent
 * cannot delegate as if it were top-level.
 * @param parent - the delegating parent agent.
 * @param maxDepth - optional absolute cap the resolved depth must not exceed.
 * @returns the child's non-negative safe-integer depth.
 * @throws {SubagentDepthError} when the resolved depth exceeds `maxDepth`.
 * @throws {RangeError} when the resolved depth leaves the safe-integer range.
 */
export function resolveChildDepth(parent: Agent, maxDepth: number | undefined): number {
  const childDepth = delegationDepthOf(parent) + 1
  if (!Number.isSafeInteger(childDepth)) {
    throw new RangeError('subagent child depth exceeds the safe-integer range')
  }
  if (maxDepth !== undefined && childDepth > maxDepth) {
    throw new SubagentDepthError(childDepth, maxDepth)
  }
  return childDepth
}

/**
 * Resolve the parent values inherited by a child. The latest request header
 * owns provider, model, and reasoning effort after request-time selection;
 * creation options remain the fallback before the first request and retain
 * the configured output-token limit.
 * @param parent - delegating parent Agent.
 * @returns detached Agent options for child-option merging.
 */
export function parentAgentOptionsForDelegation(parent: Agent): AgentOptions {
  const requestConfig = parent.session.requestHeader()?.config
  if (requestConfig === undefined) return { ...parent.options }
  const {
    provider: _createdProvider,
    model: _createdModel,
    reasoningEffort: _createdReasoningEffort,
    ...createdOptions
  } = parent.options
  return {
    ...createdOptions,
    provider: requestConfig.provider,
    model: requestConfig.model,
    ...requestConfig.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: requestConfig.reasoningEffort },
  }
}

/**
 * Resolve the child's `AgentOptions`: the parent's provider/model,
 * reasoning-effort, and maxTokens values unless the request overrides them,
 * stamped with the child's own delegation depth. Changing the route without
 * naming an effort clears the parent's route-owned effort so the selected
 * model resolves its own default.
 * @param parent - the delegating parent whose route the child inherits.
 * @param requested - per-child overrides, if any.
 * @param childDepth - the resolved delegation depth to stamp.
 * @returns the resolved options for `ctx.agents.create()`.
 * @throws {WorkflowWorkerRequiredError} when a Workflow planner is request-metered and no worker route is selected.
 */
export function resolveChildAgentOptions(
  parent: Agent,
  requested: AgentOptions | undefined,
  childDepth: number,
): AgentOptions {
  const parentOptions = parentAgentOptionsForDelegation(parent)
  const parentProvider = parentOptions.provider
  const parentModel = parentOptions.model
  const parentReasoningEffort = parentOptions.reasoningEffort
  const parentMaxTokens = parentOptions.maxTokens
  const worker = workflowWorkerRoute(parent)
  if (worker === undefined
    && requested?.provider === undefined
    && workflowPlannerRequestMetered(parent, parentProvider)) {
    throw new WorkflowWorkerRequiredError()
  }
  const resolved: AgentOptions = {
    ...parentProvider !== undefined ? { provider: parentProvider } : {},
    ...parentModel !== undefined ? { model: parentModel } : {},
    ...parentReasoningEffort !== undefined ? { reasoningEffort: parentReasoningEffort } : {},
    ...parentMaxTokens !== undefined ? { maxTokens: parentMaxTokens } : {},
    ...worker !== undefined ? { provider: worker.provider, model: worker.model } : {},
    ...requested,
    subagentDepth: childDepth,
  }
  const routeChanged = resolved.provider !== parentProvider || resolved.model !== parentModel
  if (routeChanged && requested?.reasoningEffort === undefined) delete resolved.reasoningEffort
  return resolved
}

/**
 * Workflow-mode worker route, when the parent is on that preset and a worker
 * model is stored. Absent otherwise so every other preset keeps parent inherit.
 */
function workflowWorkerRoute(parent: Agent): { provider: string; model: string } | undefined {
  if (parent.ctx.get('agentPresets')?.composedPreset(parent.ctx) !== 'workflow') return undefined
  const defaults = parent.ctx.get('agentDefaultModel') as
    | { currentWorkerSelection?: () => { provider: string; model: string } | undefined }
    | undefined
  const selected = defaults?.currentWorkerSelection?.()
  if (selected === undefined || selected.provider === '' || selected.model === '') return undefined
  return { provider: selected.provider, model: selected.model }
}

/** Planner billed per request with no worker chip: the child must not inherit that route. */
function workflowPlannerRequestMetered(parent: Agent, provider: string | undefined): boolean {
  if (parent.ctx.get('agentPresets')?.composedPreset(parent.ctx) !== 'workflow') return false
  if (provider === undefined || provider === '') return false
  return parent.ctx.get('llm')?.providerMetering(provider) === 'requests'
}

/**
 * Build the child session's durable creation metadata: the parent's workspace,
 * its direct lineage, coarse product origin, the recursion budget that must
 * survive persistence, the seed boundary that separates inherited parent
 * history from child work, and the composition the child runs under.
 *
 * Omitted selection uses the parent's live composition, including any switch
 * made while the parent was blank.
 * @param parent - the delegating parent agent.
 * @param childDepth - the resolved delegation depth to persist.
 * @param isSeeded - whether this child inherits a parent-log prefix, including an explicitly empty one.
 * @param selectedPreset - independent selection, or omission to inherit the parent.
 * @returns the `meta` for `ctx.agents.create()`.
 */
export function childSessionMeta(
  parent: Agent,
  childDepth: number,
  isSeeded: boolean,
  selectedPreset?: string,
): NonNullable<CreateAgentOptions['meta']> {
  const parentHeader = parent.session.header
  const agentPreset = selectedPreset ?? parent.ctx.get('agentPresets')?.composedPreset(parent.ctx)
  return {
    ...parentHeader.cwd !== undefined ? { cwd: parentHeader.cwd } : {},
    ...agentPreset === undefined ? {} : { agentPreset },
    parentSession: parentHeader.id,
    isSeeded,
    // Navigation classification only; the descriptor remains the authority
    // for mode and continuation capability.
    origin: 'subagent',
    // Durable: the recursion budget must survive persistence and resume.
    delegationDepth: childDepth,
  }
}

/** The scoped composition a child agent's creation window applies. */
export interface ChildComposition {
  /** Independently mounted preset; omission shares the parent's standing generation. */
  readonly agentPreset?: string | undefined
  /** Historical descriptor persona reapplied only during cold resume. */
  readonly persona?: string | undefined
  /** Historical descriptor tool restriction reapplied only during cold resume. */
  readonly toolFilter?: ToolRestriction | undefined
}

/**
 * Model-facing delegation-scope statement for every in-process child. A
 * runtime-context contribution rather than a system-prompt section, so the
 * deployment's system prompt stays uniform across parents and children.
 */
export const SUBAGENT_DELEGATION_CONTEXT
  = 'You are a delegated subagent: your permission scope was fixed when you were started and cannot be '
    + 'widened from inside this session — operations that require approval are rejected automatically. '
    + 'When the task needs access beyond that scope, do not retry the denied operation; state the '
    + 'limitation in your reply so the delegating agent can handle it.'

/**
 * Compose a child before publication and restore historical descriptor overrides.
 * Explicit selection mounts the named preset; omission synchronously joins the
 * parent's current generation. Registrations belong to the child's scope.
 * @param childCtx - the child agent's scoped creation context.
 * @param parent - the delegating parent used when no preset is selected.
 * @param composition - independent preset and any overrides read from a historical descriptor.
 * @returns A promise when mounting an independent preset; otherwise completes synchronously.
 */
export function applyChildComposition(
  childCtx: Context,
  parent: Agent,
  composition: ChildComposition,
): void | Promise<void> {
  if (composition.agentPreset !== undefined) {
    const presets = childCtx.get('agentPresets')
    if (presets === undefined) {
      throw new SubagentError('selecting a child agent preset requires the agent-presets service', 'PRESET_UNAVAILABLE')
    }
    return presets.mount(childCtx, composition.agentPreset).then(() => {
      applyChildOverrides(childCtx, composition)
    })
  }
  childCtx.get('agentPresets')?.composeFrom(childCtx, parent.ctx)
  applyChildOverrides(childCtx, composition, parent)
}

function applyChildOverrides(childCtx: Context, composition: ChildComposition, parent?: Agent): void {
  childCtx.systemPrompt.context({
    name: 'subagent:delegation',
    order: childCtx.systemPrompt.getContextOrder('SUBAGENT_DELEGATION'),
    text: SUBAGENT_DELEGATION_CONTEXT,
  })
  // A Workflow orchestrator's in-process children become workers unless an
  // explicit persona (historical descriptor) or preset already shadows it.
  const persona = composition.persona ?? (parent === undefined ? undefined : workflowWorkerPersona(parent))
  if (persona !== undefined) {
    childCtx.systemPrompt.section({
      name: 'deployment:persona-prefix',
      order: childCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
      text: persona,
    })
  }
  if (composition.toolFilter !== undefined) childCtx.tools.restrict(composition.toolFilter)
}

/**
 * Worker persona for an in-process child of a workflow-mode orchestrator.
 * Shadows the parent's coordinator persona so the child gathers information
 * and applies changes instead of planning. Coding-standard excerpts in the
 * task are required; the child reads named instruction files for the rest.
 */
export const WORKFLOW_WORKER_PERSONA
  = 'You are the worker for this delegated task. Gather information (grep, glob, read, web search) '
    + 'and apply the modifications (edit, write, shell, tests). Do not redesign the overall solution; '
    + 'execute the task you were given and report what you found and what you changed. '
    + 'Honor coding-standard excerpts and named instruction files in the task; read those files when '
    + 'you need the rest. Do not invent a conflicting architecture or skip tests the task named. '
    + 'When a finding, decision, or fix closes, call milestone_write in the same tool step with a '
    + 'one-line title and the recorded fact — do not open a new turn only to write the milestone. '
    + 'When the task prompt includes image attachments, inspect them directly — the planner '
    + 'forwarded the user\'s images because it cannot see them.'

/**
 * Durable image blocks from the latest real user message on a Workflow parent.
 * Spawn children start with an empty log; without this, a text-only planner
 * cannot pass pixels to a vision worker. Non-workflow parents and plugin-sourced
 * user messages yield nothing.
 * @param parent - the delegating Workflow orchestrator.
 * @returns shallow copies of the image blocks, newest user turn only.
 */
export function parentTurnImages(parent: Agent): ImageBlock[] {
  if (parent.ctx.get('agentPresets')?.composedPreset(parent.ctx) !== 'workflow') return []
  // The derived surface is the parent's current history; no historical log scan.
  const messages = parent.session.deriveMessages()
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined || message.role !== 'user') continue
    if (message.source.kind !== 'user') continue
    const images = message.content.filter((block): block is ImageBlock => block.type === 'image')
    if (images.length === 0) continue
    return images.map(block => ({ type: 'image' as const, attachment: block.attachment }))
  }
  return []
}

/**
 * Build the child prompt for a Workflow (or ordinary) spawn: the model text,
 * then any user images the Workflow parent must forward.
 * @param text - the standalone task text from the tool or workflow script.
 * @param parent - the delegating parent agent.
 * @returns content blocks for {@link SubagentStartRequest.prompt}.
 */
export function spawnPromptWithParentImages(text: string, parent: Agent): ContentBlock[] {
  return [{ type: 'text', text }, ...parentTurnImages(parent)]
}

/** Tools a workflow orchestrator must not see or call; workers keep them through the standing mount. */
export const WORKFLOW_ORCHESTRATOR_WORK_TOOLS = [
  'bash',
  'pwsh',
  'read',
  'write',
  'edit',
  'apply_patch',
  'str_replace_editor',
  'lsp',
  'terminal_open',
  'terminal_send',
  'terminal_read',
  'terminal_signal',
  'terminal_close',
  'terminal_list',
  'read_image',
  'glob',
  'grep',
  'web_search',
  'web_fetch',
  'job_output',
  'job_list',
  'job_kill',
  'milestone_write',
  'skill',
  'ralph',
  'subagent_fork',
] as const

/**
 * Hide information-gathering, mutation, skill, Ralph, and fork tools from a
 * root workflow agent.
 * Children join the same standing mount as siblings rather than nesting under
 * this agent's scope, so they keep the full catalog. No-ops when the agent is
 * not a depth-0 workflow session or those tools are not registered.
 * Must not throw: `agent/created` listeners that throw veto publication.
 * @param agent - the agent that just published.
 */
export function restrictWorkflowOrchestrator(agent: Agent): void {
  if (delegationDepthOf(agent) !== 0) return
  if (agent.ctx.get('agentPresets')?.composedPreset(agent.ctx) !== 'workflow') return
  const tools = agent.ctx.get('tools')
  if (tools === undefined) return
  const visible = new Set(tools.schemas(agent).map(schema => schema.name))
  const deny = WORKFLOW_ORCHESTRATOR_WORK_TOOLS.filter(name => visible.has(name))
  if (deny.length === 0) return
  agent.ctx.tools.restrict({ deny })
}

function workflowWorkerPersona(parent: Agent): string | undefined {
  if (parent.ctx.get('agentPresets')?.composedPreset(parent.ctx) !== 'workflow') return undefined
  return WORKFLOW_WORKER_PERSONA
}

/** Policy seeded onto a child session's log at the delegation boundary. */
export interface DelegatedPolicyOverrides {
  /**
   * The parent's current preset identity when it runs in Auto or Full access;
   * the child keeps it under the pinned `never` approval policy.
   */
  readonly permissionPreset: 'auto' | 'danger-full-access' | undefined
  /** The parent session's explicit sandbox-mode override, or `undefined` without one. */
  readonly sandboxMode: SandboxMode | undefined
  /**
   * `'never'` whenever the approval capability is composed, `undefined`
   * otherwise: a delegated child acts only within the sandbox scope fixed at
   * delegation, so its asks are rejected deterministically.
   */
  readonly approvalPolicy: 'never' | undefined
}

/**
 * Capture the permission state to seed into one delegation. Call synchronously before
 * the child start's first await: a later parent switch belongs to the
 * parent's future, not to this child. Auto and Full access identities are
 * inherited only through the in-process DSH path so either can replace a stale
 * same-bundle fork value. Only the parent session's explicit sandbox override
 * is captured — never deployment defaults or one-shot grants — and the approval
 * policy is pinned to `'never'` regardless of the parent's own policy.
 * @param parent - the delegating parent agent.
 * @returns the sandbox override (or `undefined` without one) and the approval pin.
 */
export function captureDelegatedPolicyOverrides(parent: Agent): DelegatedPolicyOverrides {
  const preset = parent.ctx.get('permissionPresets')?.current(parent.session)
  return {
    permissionPreset: preset === 'auto' || preset === 'danger-full-access' ? preset : undefined,
    sandboxMode: parent.ctx.get('sandboxPolicy')?.overrideOf(parent.session),
    approvalPolicy: parent.ctx.get('approval') === undefined ? undefined : 'never',
  }
}

/**
 * Append the captured delegation policy onto the child's own log as
 * `source: 'delegation'` events after Session announcement and before Agent registration, so the
 * child's effective policy is reconstructable from its log alone. Appends land
 * after any fork seed, so fresh policy wins stale seed state; later child
 * switches still win over these events.
 * @param childSession - the child's announced, writable Session.
 * @param overrides - the policy captured at delegation.
 */
export function appendDelegatedPolicyOverrides(
  childSession: Session,
  overrides: DelegatedPolicyOverrides,
): void {
  if (overrides.sandboxMode !== undefined) {
    childSession.append('sandbox/mode', { mode: overrides.sandboxMode, source: 'delegation' })
  }
  if (overrides.approvalPolicy !== undefined) {
    childSession.append('approval/policy', { policy: overrides.approvalPolicy, source: 'delegation' })
  }
  if (overrides.permissionPreset !== undefined) {
    childSession.append('permission/preset', { preset: overrides.permissionPreset })
  }
}

/** Identity and lineage inputs shared by every in-process child creation. */
export interface ChildCreateInputs {
  /** The child's reserved session id. */
  readonly sessionId: SessionId
  /** The delegating parent agent. */
  readonly parent: Agent
  /** The resolved delegation depth. */
  readonly childDepth: number
  /** How many leading seed events came from the parent's log. */
  readonly lineageSeedLength: number
}
