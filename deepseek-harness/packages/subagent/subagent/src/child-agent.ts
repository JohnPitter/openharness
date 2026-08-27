/**
 * Shared in-process child composition: the delegation-depth budget, the
 * durable session metadata, the resolved child `AgentOptions`, the delegated
 * policy seed, and the scoped setup a child agent needs. Both the one-shot
 * provider driver and the continuation manager compose children this way, so
 * depth accounting, lineage stamping, and delegation policy have one home.
 *
 * @module @deepseek-ai/dsh-subagent/child-agent
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRestriction } from '@deepseek-ai/dsh-tools'
// Type-only: make `ctx.get('sandboxPolicy')` / `ctx.get('approval')` resolve
// to the policy services when composed — delegation consumes both
// opportunistically (the documented `ctx.get` pattern), never as a hard dep —
// and merge the `sandbox/mode` / `approval/policy` session-event payloads.
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
// Type-only: make `ctx.get('agentPresets')` resolve to the preset roster when
// composed — a child inherits its parent's composition opportunistically (the
// documented `ctx.get` pattern), never as a hard dep. A rosterless deployment
// keeps its model-facing rows on the host plane, where the child already sees
// them through the tool registry's global layer.
import type {} from '@deepseek-ai/dsh-agent-presets'
import { delegationDepthOf } from './depth.ts'

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
 * Resolve the child's `AgentOptions`: the parent's provider/model/maxTokens
 * route unless the request overrides it, stamped with the child's own
 * delegation depth.
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
  const parentProvider = parent.options.provider
  const parentModel = parent.options.model
  const parentMaxTokens = parent.options.maxTokens
  const worker = workflowWorkerRoute(parent)
  if (worker === undefined
    && requested?.provider === undefined
    && workflowPlannerRequestMetered(parent)) {
    throw new WorkflowWorkerRequiredError()
  }
  return {
    ...parentProvider !== undefined ? { provider: parentProvider } : {},
    ...parentModel !== undefined ? { model: parentModel } : {},
    ...parentMaxTokens !== undefined ? { maxTokens: parentMaxTokens } : {},
    ...worker !== undefined ? { provider: worker.provider, model: worker.model } : {},
    ...requested,
    subagentDepth: childDepth,
  }
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
function workflowPlannerRequestMetered(parent: Agent): boolean {
  if (parent.ctx.get('agentPresets')?.composedPreset(parent.ctx) !== 'workflow') return false
  const provider = parent.options.provider
  if (provider === undefined || provider === '') return false
  return parent.ctx.get('llm')?.providerMetering(provider) === 'requests'
}

/**
 * Build the child session's durable creation metadata: the parent's workspace,
 * its direct lineage, coarse product origin, the recursion budget that must
 * survive persistence, the seed boundary that separates inherited parent
 * history from child work, and the composition the child runs under.
 *
 * The preset is read from the parent's LIVE scope chain rather than from its
 * header, because a parent that switched preset while blank runs on the newer
 * composition and its header still names the older one. Recording it is what
 * makes a child's history reconstructable: without it a cold read of the child
 * resolves the deployment default and rebuilds turns under a tool set the
 * child never had.
 * @param parent - the delegating parent agent.
 * @param childDepth - the resolved delegation depth to persist.
 * @param lineageSeedLength - how many leading events came from the parent's log.
 * @returns the `meta` for `ctx.agents.create()`.
 */
export function childSessionMeta(
  parent: Agent,
  childDepth: number,
  lineageSeedLength: number,
): NonNullable<CreateAgentOptions['meta']> {
  const parentHeader = parent.session.header
  const agentPreset = parent.ctx.get('agentPresets')?.composedPreset(parent.ctx)
  return {
    ...parentHeader.cwd !== undefined ? { cwd: parentHeader.cwd } : {},
    ...agentPreset === undefined ? {} : { agentPreset },
    parentSession: parentHeader.id,
    // Navigation classification only; the descriptor remains the authority
    // for mode and continuation capability.
    origin: 'subagent',
    // Durable: the recursion budget must survive persistence and resume.
    delegationDepth: childDepth,
    ...lineageSeedLength > 0 ? { seedLength: lineageSeedLength } : {},
  }
}

/** The scoped composition a child agent's creation window applies. */
export interface ChildComposition {
  /** Per-child persona shadowing the deployment persona. */
  readonly persona?: string | undefined
  /** Per-child tool scoping. */
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
 * Compose one child inside its creation window: join its parent's preset,
 * register the fixed delegation-scope statement, then apply the child's own
 * shadowing persona section and tool restriction, all owned by the child's
 * scope and therefore invisible to its parent and siblings. Creation and cold
 * resume both pass through here.
 *
 * The join comes first and the child's own registrations second, which is the
 * order the layering already implies — the nearest scope wins a name, and a
 * per-child restriction intersects with everything its chain admits — but
 * stating it here keeps the two steps from being read as independent.
 *
 * The join and the per-child registrations live in ONE call because a child
 * composed without the join is exactly the defect this function exists to
 * prevent: with every model-facing row on the agent plane, a child that joins
 * no preset sees an empty tool registry and none of its parent's prompt
 * sections. Taking the parent as a parameter is what makes that omission
 * unrepresentable at the call sites.
 * @param childCtx - the child agent's scoped creation context.
 * @param parent - the delegating parent whose composition the child joins.
 * @param composition - the per-child persona and tool filter to install.
 */
export function applyChildComposition(
  childCtx: Context,
  parent: Agent,
  composition: ChildComposition,
): void {
  childCtx.get('agentPresets')?.composeFrom(childCtx, parent.ctx)
  // Order 120: after the sandbox:policy (110) and approval:policy (115) sentences.
  childCtx.systemPrompt.context({ name: 'subagent:delegation', order: 120, text: SUBAGENT_DELEGATION_CONTEXT })
  const persona = composition.persona ?? workflowWorkerPersona(parent)
  if (persona !== undefined) {
    childCtx.systemPrompt.section({ name: 'deployment:persona', order: 0, text: persona })
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
    + 'one-line title and the recorded fact — do not open a new turn only to write the milestone.'

/** Tools a workflow orchestrator must not see or call; workers keep them through the standing mount. */
export const WORKFLOW_ORCHESTRATOR_WORK_TOOLS = [
  'bash',
  'pwsh',
  'read',
  'write',
  'edit',
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
 * Capture the policy to seed into one delegation. Call synchronously before
 * the child start's first await: a later parent switch belongs to the
 * parent's future, not to this child. Only the parent session's explicit
 * sandbox override is captured — never deployment defaults or one-shot
 * grants — and the approval policy is pinned to `'never'` regardless of the
 * parent's own policy.
 * @param parent - the delegating parent agent.
 * @returns the sandbox override (or `undefined` without one) and the approval pin.
 */
export function captureDelegatedPolicyOverrides(parent: Agent): DelegatedPolicyOverrides {
  return {
    sandboxMode: parent.ctx.get('sandboxPolicy')?.overrideOf(parent.session),
    approvalPolicy: parent.ctx.get('approval') === undefined ? undefined : 'never',
  }
}

/**
 * Append the captured delegation policy onto the child's own log as
 * `source: 'delegation'` events inside the unpublished creation window, so the
 * child's effective policy is reconstructable from its log alone. Appends land
 * after any fork seed, so fresh policy wins stale seed state; later child
 * switches still win over these events.
 * @param childSession - the unpublished child's session.
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
