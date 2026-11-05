/**
 * Surface retention selection and the shared log-recorded compaction
 * transaction for automatic open-turn and manual idle-session compaction.
 *
 * @module @deepseek-ai/dsh-compaction-basic/region
 */

import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  CompactionId,
  ManualCompactionError,
  compactCheckpointSource,
  toolPairingBalancedAfter,
  toolPairingBalancedBefore,
} from '@deepseek-ai/dsh-compaction'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import { CONTEXT_WINDOW_EXCEEDED_CODE, createUserMessage, errorChain, isContextWindowExceededError, LlmError } from '@deepseek-ai/dsh-llm'
import type { Message, UserMessage } from '@deepseek-ai/dsh-llm'
import type { TokenMeasurement, TokenMeter } from '@deepseek-ai/dsh-token-meter'
import { SessionSeq, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { frameSummary, MAX_TOKENS_CODE } from './summarizer.ts'
import type { SummarizationInput, SummaryResult } from './summarizer.ts'
interface RegionDependencies {
  readonly meter: TokenMeter
  summarize(input: SummarizationInput, agent: Agent, signal?: AbortSignal): Promise<SummaryResult>
  recover(error: unknown, agent: Agent, sourceEventSeqs: readonly SessionSeq[], signal?: AbortSignal): boolean
}

/** Safety window used when older sessions have no recorded request context. */
export const SUMMARIZER_CONTEXT_WINDOW_FALLBACK = 128_000
/** Explicit reserve for the summarizer system and instruction envelope. */
export const SUMMARIZER_ENVELOPE_RESERVE = 16_384
/**
 * Absolute priced-span ceiling for one summarizer request. Envelope-aware
 * half-window math on a 1M route would otherwise send ~475k tokens and miss
 * the five-minute transaction deadline.
 */
export const SUMMARIZER_SPAN_CEILING = 65_536
/** Stable failure code for a compaction transaction that exceeds its overall deadline. */
export const COMPACTION_TIMEOUT_CODE = 'COMPACTION_TIMEOUT'
/** Five minutes covers the existing adapter idle watchdog without allowing keepalives to extend a transaction forever. */
export const COMPACTION_OPERATION_TIMEOUT_MS = 5 * 60 * 1_000

/**
 * Resolve a fail-closed summarizer span budget from the durable request context.
 * @param session - session whose latest recorded request window is read.
 * @param maxTokens - configured summarizer output limit.
 * @param envelopeReserve - configured envelope reserve; defaults to the built-in constant.
 * @param spanCeiling - configured absolute span ceiling; defaults to the built-in constant.
 * @returns a non-negative integer safe span budget.
 */
export function loggedSummarizerSpanBudget(
  session: Session,
  maxTokens: number,
  envelopeReserve = SUMMARIZER_ENVELOPE_RESERVE,
  spanCeiling = SUMMARIZER_SPAN_CEILING,
): number {
  const recorded = session.requestContext()?.contextWindow as number | null | undefined
  if (recorded === undefined) {
    return summarizerSpanBudget(SUMMARIZER_CONTEXT_WINDOW_FALLBACK, maxTokens, envelopeReserve, spanCeiling)
  }
  if (recorded === null || !Number.isFinite(recorded) || recorded < 0) return 0
  return summarizerSpanBudget(recorded, maxTokens, envelopeReserve, spanCeiling)
}

/** One validated inclusive span of current surface positions. */
interface SurfaceSelection {
  readonly start: SessionSeq
  readonly end: SessionSeq
  readonly startIdx: number
  readonly endIdx: number
  readonly shadowedSeqs: readonly SessionSeq[]
}

/** A selection with its priced snapshot and the replay input built from it. */
interface PreparedCompaction extends SurfaceSelection {
  readonly measurement: TokenMeasurement
  readonly selectedNodes: TokenMeasurement['nodes']
  readonly shadowedTokenCount: number
  /** Route-priced total of the selected span; the shrink comparison's unit. */
  readonly shadowedRouteTokenCount: number
  readonly input: SummarizationInput
}

type SummarizedCompaction = PreparedCompaction & SummaryResult & {
  readonly checkpointMessage: UserMessage
}

interface CompactionTransactionOptions {
  /** `current-turn` derives a numbered owner; `null` writes a standalone bracket. */
  readonly owner: 'current-turn' | null
  /** Surface relationship that must survive asynchronous summarization. */
  readonly stability: 'whole-surface' | 'selected-span'
  /** Optional durability checkpoint after a successfully closed bracket. */
  readonly flush?: () => Promise<void>
  /** Manual command that initiated this transaction, when present. */
  readonly sourceCommandId?: CommandId
  /** Initial safe span budget; overflow and output-cap retries halve this value. */
  readonly maxSpanTokens?: number
}

interface CompactionEntryState {
  readonly openTurn: number | null
  readonly unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  readonly latestEndSeedSeq: SessionSeq | undefined
}

/**
 * Rejects a summary whose replacement boundaries are no longer the ones it was
 * built from, distinguished from summarizer and shrink failures so a manual
 * caller can report the two causes differently.
 */
class SurfaceChangedError extends Error {}

/** Whether the summary may still replace the span it was built from. */
type StabilityCheck = (
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
) => void

/** Failure captured after `compaction/start` has committed. */
interface TransactionFailure {
  readonly error: unknown
  readonly stage: 'summary' | 'commit'
}

/**
 * The `system/message` holding surface node 0, or `undefined` when another
 * message-producing event starts the surface.
 * @param session - session supplying the log behind the current surface.
 * @param headSeq - seq at surface node 0 of a non-empty surface.
 * @returns the system head event, or `undefined` without one.
 */
function systemHead(session: Session, headSeq: SessionSeq): SessionEvent<'system/message'> | undefined {
  // Surface nodes are current log seqs, so the event exists.
  // Existing Session history read; migration deferred.
  // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
  const head = session.eventAt(headSeq)!
  return head.type === 'system/message' ? head : undefined
}

/**
 * Maximum priced span for a summarizer request. The half-window bound tolerates
 * a recorded/model context mismatch; output and envelope reserves keep a
 * 262K-recorded conversation inside a 128K summarizer route. The output
 * reserve is clamped to a quarter of the window so a large default output cap
 * still leaves a usable span. A positive
 * envelope-aware result is then capped at `spanCeiling` so a 1M window does not
 * send a half-million-token request.
 * @param contextWindow - positive adapter-owned model capacity.
 * @param maxTokens - configured summarizer output limit.
 * @param envelopeReserve - explicit budget for system/instruction overhead;
 * defaults to the built-in `SUMMARIZER_ENVELOPE_RESERVE` constant, overridable
 * through `BasicCompactionConfig.summarizerEnvelopeReserve`.
 * @param spanCeiling - absolute latency-safe span ceiling; defaults to the
 * built-in `SUMMARIZER_SPAN_CEILING` constant, overridable through
 * `BasicCompactionConfig.summarizerSpanCeiling`.
 * @returns a non-negative integer safe for selection. When the budget is zero,
 * selection must produce no range, so callers make no summarizer request. The
 * half-window arithmetic invariant applies only when this value is greater than zero
 * and below the ceiling.
 */
export function summarizerSpanBudget(
  contextWindow: number,
  maxTokens: number,
  envelopeReserve = SUMMARIZER_ENVELOPE_RESERVE,
  spanCeiling = SUMMARIZER_SPAN_CEILING,
): number {
  const halfWindow = Math.floor(contextWindow / 2)
  if (!Number.isFinite(halfWindow) || !Number.isFinite(maxTokens) || !Number.isFinite(envelopeReserve)
    || !Number.isFinite(spanCeiling)) return 0
  // The output reservation counts against at most half of the half-window:
  // the default output cap follows `headroomTokens` (65536), which would
  // otherwise leave a 128K route no span at all.
  const outputReserve = Math.min(Math.max(0, maxTokens), Math.floor(halfWindow / 2))
  const envelopeAware = Math.max(0, halfWindow - outputReserve - Math.max(0, envelopeReserve))
  return envelopeAware === 0 ? 0 : Math.min(Math.max(0, spanCeiling), envelopeAware)
}

/**
 * Pressure span cap for a routed window. Production windows keep the
 * envelope-aware budget. A zero envelope-aware result leaves pressure
 * uncapped so a small advertised capacity can still reduce below threshold.
 * @param contextWindow - positive adapter-owned model capacity.
 * @param maxTokens - configured summarizer output limit.
 * @param envelopeReserve - configured envelope reserve; defaults to the built-in constant.
 * @param spanCeiling - configured absolute span ceiling; defaults to the built-in constant.
 * @returns a positive span cap, or `undefined` when the envelope-aware budget is zero.
 */
export function pressureSummarizerSpanBudget(
  contextWindow: number,
  maxTokens: number,
  envelopeReserve = SUMMARIZER_ENVELOPE_RESERVE,
  spanCeiling = SUMMARIZER_SPAN_CEILING,
): number | undefined {
  const safe = summarizerSpanBudget(contextWindow, maxTokens, envelopeReserve, spanCeiling)
  return safe > 0 ? safe : undefined
}

/**
 * Resolve the next range starting at the first non-system surface node while
 * retaining a priced recent tail and never splitting an assistant
 * tool-call/result pair. A `system/message` at surface node 0 is never inside
 * the range; without one the range starts at node 0.
 * @param session - session supplying authoritative current surface positions.
 * @param measurement - unified pressure and surface measurement from the conversation meter.
 * @param retainTokens - minimum recent tail budget retained verbatim.
 * @param maxSpanTokens - optional cap on the priced compact span so the summarizer request fits the window.
 * @returns the inclusive positional seq range to compact, or `null`.
 */
export function selectCompactableRange(
  session: Session,
  measurement: TokenMeasurement,
  retainTokens: number,
  maxSpanTokens?: number,
): { start: SessionSeq; end: SessionSeq } | null {
  const pricedNodes = measurement.nodes
  if (pricedNodes.length === 0) return null
  if (maxSpanTokens !== undefined && maxSpanTokens <= 0) return null

  const surfaceNodes = session.surface.nodes
  if (surfaceNodes.length !== pricedNodes.length
    || surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
    throw new Error('compaction: token-meter surface does not match the current session surface')
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const firstIdx = systemHead(session, surfaceNodes[0]!) === undefined ? 0 : 1

  let accumulated = 0
  let keepFromIdx = pricedNodes.length
  for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    accumulated += pricedNodes[index]!.tokens
    keepFromIdx = index
    if (accumulated >= retainTokens) break
  }
  if (keepFromIdx <= firstIdx) return null
  keepFromIdx = snapKeepFromToPairing(session, surfaceNodes, keepFromIdx, firstIdx)
  if (keepFromIdx <= firstIdx) return null

  if (maxSpanTokens !== undefined) {
    let spanTokens = 0
    for (let index = firstIdx; index < keepFromIdx; index += 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      spanTokens += pricedNodes[index]!.tokens
    }
    while (keepFromIdx > firstIdx + 1 && spanTokens > maxSpanTokens) {
      keepFromIdx -= 1
      // oxlint-disable-next-line typescript/no-non-null-assertion
      spanTokens -= pricedNodes[keepFromIdx]!.tokens
    }
    keepFromIdx = snapKeepFromToPairing(session, surfaceNodes, keepFromIdx, firstIdx)
    if (keepFromIdx <= firstIdx) return null

    // Pair snapping can move a boundary; validate the final balanced unit as
    // well, and refuse an indivisible first unit rather than sending a doomed call.
    let balancedSpanTokens = 0
    for (let index = firstIdx; index < keepFromIdx; index += 1) {
      // oxlint-disable-next-line typescript/no-non-null-assertion
      balancedSpanTokens += pricedNodes[index]!.tokens
    }
    if (balancedSpanTokens > maxSpanTokens) return null
  }

  // oxlint-disable-next-line typescript/no-non-null-assertion
  const first = surfaceNodes[firstIdx]!
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const cutoff = surfaceNodes[keepFromIdx - 1]!
  return { start: first, end: cutoff }
}

/** Move `keepFromIdx` left (not past `floorIdx`) until the node at that index is a balanced tool-pair cut. */
function snapKeepFromToPairing(
  session: Session,
  surfaceNodes: readonly SessionSeq[],
  keepFromIdx: number,
  floorIdx: number,
): number {
  let index = keepFromIdx
  while (index > floorIdx) {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    if (toolPairingBalancedBefore(session, surfaceNodes[index]!)) break
    index -= 1
  }
  return index
}

/**
 * Run the single compaction transaction over one selected positional span.
 * Selection and validation are read-only. Idle/log validation and
 * `compaction/start` are synchronously adjacent, so the durable opening marker is
 * the compaction lock before summarization yields. Every later failure makes
 * exactly one `compaction/end` attempt; a failed close deliberately leaves the
 * unmatched start detectable.
 * @param dependencies - conversation meter and dynamically dispatched summarizer hook.
 * @param session - session whose surface is mutated.
 * @param start - inclusive first surface-node seq.
 * @param end - inclusive last surface-node seq.
 * @param agent - agent used by the summarizer.
 * @param options - bracket owner, stability rule, and optional durability checkpoint.
 * @param signal - optional summarization cancellation signal.
 * @returns the successful durable compaction result.
 */
export async function compactSurfaceRegion(
  dependencies: RegionDependencies,
  session: Session,
  start: SessionSeq,
  end: SessionSeq,
  agent: Agent,
  options: CompactionTransactionOptions,
  signal?: AbortSignal,
): Promise<CompactionResult> {
  if (options.owner === null) signal?.throwIfAborted()
  const selection = validateSurfaceRegion(session, start, end)
  const entryState = inspectCompactionEntryState(session)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    'compaction',
  )

  let owner: number | null
  if (options.owner === null) {
    if (entryState.openTurn !== null) {
      throw new ManualCompactionError('busy', 'manual compaction: the session already has an open turn')
    }
    owner = null
  } else {
    if (entryState.openTurn === null) {
      throw new Error('compactRegion: no open turn — automatic compaction events must be enclosed in a turn')
    }
    owner = entryState.openTurn
  }

  const compactionId = CompactionId(randomUUID())
  const lifecycle = {
    compactionId,
    ...options.sourceCommandId === undefined ? {} : { sourceCommandId: options.sourceCommandId },
    turn: owner,
  }
  const startEvent = session.append('compaction/start', lifecycle)
  const deadline = createCompactionDeadline(signal)
  const assertStable: StabilityCheck = options.stability === 'whole-surface'
    ? assertWholeSurfaceUnchanged
    : assertSelectedSpanStable
  let failure: TransactionFailure | undefined
  let flushFailure: unknown
  let result: CompactionResult | undefined
  let closed = false
  let closing = false
  let stage: TransactionFailure['stage'] = 'summary'

  try {
    // The ref tracks the latest preparation, including one rebuilt after a
    // `compaction/summary-error` recovery, so a span retry validates against it.
    const preparedRef = { current: prepareCompaction(dependencies, session, selection) }
    for (let attempt = 0; ; attempt += 1) {
      try {
        const summarized = await deadline.run(summarizeCompaction(
          dependencies,
          preparedRef,
          agent,
          compactionId,
          options.sourceCommandId,
          assertStable,
          deadline.signal,
        ))
        if (options.owner === null) deadline.signal.throwIfAborted()
        assertStable(dependencies, session, summarized)
        stage = 'commit'
        const pending = commitCompactionBody(session, startEvent, summarized)
        closing = true
        const endEvent = session.append('compaction/end', lifecycle)
        closed = true
        result = completeCompaction(pending, endEvent)
        break
      } catch (error: unknown) {
        if (!isSpanRetryable(error) || attempt >= 2) throw error
        if (options.owner === null && deadline.signal.reason !== deadline.timeoutError) deadline.signal.throwIfAborted()
        // Validate the original snapshot before selecting a smaller paired span.
        assertStable(dependencies, session, preparedRef.current)
        const budget = options.maxSpanTokens === undefined
          ? undefined
          : Math.floor(options.maxSpanTokens / 2 ** (attempt + 1))
        const nextRange = selectCompactableRange(
          session,
          dependencies.meter.measure(session),
          0,
          budget,
        )
        if (nextRange === null) throw error
        preparedRef.current = prepareCompaction(dependencies, session, validateSurfaceRegion(session, nextRange.start, nextRange.end))
      }
    }
  } catch (error: unknown) {
    failure = { error, stage: closing ? 'commit' : stage }
    if (!closing) {
      closing = true
      try {
        session.append('compaction/end', { ...lifecycle, error: errorChain(error) })
        closed = true
      } catch (closeError: unknown) {
        failure = { error: closeError, stage: 'commit' }
      }
    }
  }

  if (closed && options.flush !== undefined) {
    try {
      await options.flush()
    } catch (error: unknown) {
      flushFailure = error
    }
  }

  deadline.dispose()
  if (options.owner === null) signal?.throwIfAborted()
  if (failure !== undefined) {
    if (options.owner === null) throwManualFailure(failure)
    throw failure.error
  }
  if (flushFailure !== undefined) {
    throw new ManualCompactionError(
      'persistence',
      'manual compaction durability checkpoint failed',
      { cause: flushFailure },
    )
  }
  /* v8 ignore next -- every path without a result records and throws a failure above. */
  if (result === undefined) throw new Error('compaction committed without a result')
  return result
}

/** Read a stable provider code through a local cause chain. */
interface CompactionDeadline {
  readonly signal: AbortSignal
  readonly timeoutError: LlmError
  run<T>(operation: Promise<T>): Promise<T>
  dispose(): void
}

function createCompactionDeadline(callerSignal: AbortSignal | undefined): CompactionDeadline {
  const controller = new AbortController()
  const timeoutError = new LlmError(
    'Compaction exceeded its overall deadline.',
    COMPACTION_TIMEOUT_CODE,
  )
  let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    controller.abort(timeoutError)
  }, COMPACTION_OPERATION_TIMEOUT_MS)
  const abortCaller = (): void => { controller.abort(callerSignal?.reason) }
  if (callerSignal?.aborted) abortCaller()
  else callerSignal?.addEventListener('abort', abortCaller, { once: true })
  const timeout = new Promise<never>((_resolve, reject) => {
    const rejectTimeout = (): void => {
      if (controller.signal.reason === timeoutError) reject(timeoutError)
    }
    if (controller.signal.aborted) rejectTimeout()
    else controller.signal.addEventListener('abort', rejectTimeout, { once: true })
  })
  let callerTimer: ReturnType<typeof setTimeout> | undefined
  const callerAbort = new Promise<never>((_resolve, reject) => {
    const rejectCaller = (): void => {
      if (controller.signal.reason === timeoutError) return
      // Let a provider's synchronous cancellation failure become the durable
      // end reason; a provider that ignores the signal still gets a bound.
      callerTimer = setTimeout(() => { reject(controller.signal.reason as Error) }, 0)
    }
    if (controller.signal.aborted) rejectCaller()
    else controller.signal.addEventListener('abort', rejectCaller, { once: true })
  })
  return {
    signal: controller.signal,
    timeoutError,
    run<T>(operation: Promise<T>): Promise<T> {
      void operation.catch(() => undefined)
      return Promise.race([operation, timeout, callerAbort])
    },
    dispose(): void {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (callerTimer !== undefined) {
        clearTimeout(callerTimer)
        callerTimer = undefined
      }
      callerSignal?.removeEventListener('abort', abortCaller)
    },
  }
}

/** Context overflow and output-cap truncation shrink the span; other failures do not. */
function isSpanRetryable(error: unknown): boolean {
  const code = errorCode(error)
  return code === CONTEXT_WINDOW_EXCEEDED_CODE || code === MAX_TOKENS_CODE
}

/** Read a stable provider code through a local cause chain. */
function errorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current !== undefined; depth += 1) {
    if (typeof current === 'object' && current !== null && 'code' in current) {
      const code = (current as { code?: unknown }).code
      if (typeof code === 'string') return code
    }
    current = current instanceof Error ? current.cause : undefined
  }
  if (error instanceof Error && isContextWindowExceededError(error.message)) return CONTEXT_WINDOW_EXCEEDED_CODE
  return undefined
}

/** Classify one closed manual attempt without weakening cancellation precedence. */
function throwManualFailure(failure: TransactionFailure): never {
  if (failure.stage === 'commit') {
    throw new ManualCompactionError(
      'commit',
      'manual compaction did not commit cleanly',
      { cause: failure.error },
    )
  }
  if (failure.error instanceof SurfaceChangedError) {
    throw new ManualCompactionError(
      'changed',
      'the compacted history changed during manual compaction',
      { cause: failure.error },
    )
  }
  throw new ManualCompactionError(
    'summary',
    'manual compaction could not produce a smaller summary',
    { cause: failure.error },
  )
}

/**
 * Reject a durable unmatched compaction marker unless a later constructor-seed
 * boundary proves that its owner belongs to an earlier session lifecycle.
 * @param unmatchedCompactionStart - latest unmatched opening marker, if any.
 * @param latestEndSeedSeq - newest constructor-seed boundary, if any.
 * @param stage - operation label included in the busy diagnostic.
 */
function assertCompactionInactive(
  unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined,
  latestEndSeedSeq: SessionSeq | undefined,
  stage: string,
): void {
  if (unmatchedCompactionStart === undefined
    || (latestEndSeedSeq !== undefined
      && latestEndSeedSeq > unmatchedCompactionStart.seq)) return
  throw new ManualCompactionError(
    'busy',
    `${stage}: compaction already in progress; the session compaction lock is already active`,
  )
}

/**
 * Recheck the durable compaction lock after an asynchronous policy decision.
 * @param session - session whose latest marker state is inspected.
 * @param stage - operation label included in the busy diagnostic.
 */
export function assertNoActiveCompaction(session: Session, stage: string): void {
  const entryState = inspectCompactionEntryState(session)
  assertCompactionInactive(
    entryState.unmatchedCompactionStart,
    entryState.latestEndSeedSeq,
    stage,
  )
}

/** Validate one requested surface-position span before asynchronous work begins. */
function validateSurfaceRegion(session: Session, start: SessionSeq, end: SessionSeq): SurfaceSelection {
  const nodes = session.surface.nodes
  const startIdx = nodes.indexOf(start)
  const endIdx = nodes.indexOf(end)
  if (startIdx === -1) throw new Error(`compactRegion: start seq ${start} not found in surface`)
  if (endIdx === -1) throw new Error(`compactRegion: end seq ${end} not found in surface`)
  if (startIdx > endIdx) {
    throw new Error(
      `compactRegion: start seq ${start} (position ${startIdx}) is after end seq ${end} (position ${endIdx}) on the surface`,
    )
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedBefore(session, nodes[startIdx]!)) {
    throw new Error(`compactRegion: start seq ${start} is not a balanced boundary (would split a step's tool-call/result pair)`)
  }
  // oxlint-disable-next-line typescript/no-non-null-assertion
  if (!toolPairingBalancedAfter(session, nodes[endIdx]!)) {
    throw new Error(`compactRegion: end seq ${end} is not a balanced boundary (would split a step, or the step is still open)`)
  }

  return { start, end, startIdx, endIdx, shadowedSeqs: nodes.slice(startIdx, endIdx + 1) }
}

/** Snapshot pricing and replay input for a validated surface range. */
function prepareCompaction(
  dependencies: RegionDependencies,
  session: Session,
  selection: SurfaceSelection,
): PreparedCompaction {
  const measurement = dependencies.meter.measure(session)
  const selectedNodes = measurement.nodes.slice(selection.startIdx, selection.endIdx + 1)
  if (selectedNodes.length !== selection.shadowedSeqs.length
    || selectedNodes.some((node, index) => node.seq !== selection.shadowedSeqs[index])) {
    throw new SurfaceChangedError('compaction: selected surface changed before summarization began')
  }
  return {
    ...selection,
    measurement,
    selectedNodes,
    // The shadow-price protocol prices replacements with the fixed heuristic
    // so the O(1) projection fold stays in agreement with its own appends;
    // retention, range selection, and the shrink comparison read the
    // route-priced `tokens` instead.
    shadowedTokenCount: selectedNodes.reduce((total, node) => total + node.heuristicTokens, 0),
    shadowedRouteTokenCount: selectedNodes.reduce((total, node) => total + node.tokens, 0),
    input: buildSummarizationInput(session, selection.shadowedSeqs),
  }
}

/** Run the summarizer and frame its replacement checkpoint. */
async function summarizeCompaction(
  dependencies: RegionDependencies,
  preparedRef: { current: PreparedCompaction },
  agent: Agent,
  compactionId: CompactionResult['compactionId'],
  sourceCommandId: CommandId | undefined,
  assertStable: StabilityCheck,
  signal?: AbortSignal,
): Promise<SummarizedCompaction> {
  let prepared = preparedRef.current
  let summaryResult: SummaryResult
  for (;;) {
    signal?.throwIfAborted()
    try {
      summaryResult = await dependencies.summarize(prepared.input, agent, signal)
      break
    } catch (error: unknown) {
      if (signal?.aborted === true) throw error
      assertStable(dependencies, agent.session, prepared)
      if (!dependencies.recover(error, agent, prepared.shadowedSeqs, signal)) throw error
      prepared = prepareCompaction(dependencies, agent.session,
        validateSurfaceRegion(agent.session, prepared.start, prepared.end))
      preparedRef.current = prepared
    }
  }
  const checkpointMessage = createUserMessage({
    content: frameSummary(summaryResult.summary),
    source: compactCheckpointSource(compactionId, sourceCommandId),
  })
  // The checkpoint is text-only, so its fixed-heuristic price IS its route
  // price; comparing it against the span's route price asks the real
  // question — does the replacement lower the next request's pressure.
  const framedSummaryTokenCount = dependencies.meter.estimateMessage(checkpointMessage)
  if (framedSummaryTokenCount >= prepared.shadowedRouteTokenCount) {
    throw new Error(
      `summary is not smaller than the shadowed content (${framedSummaryTokenCount} estimated framed tokens >= ${prepared.shadowedRouteTokenCount})`,
    )
  }
  return {
    ...prepared,
    ...summaryResult,
    checkpointMessage,
  }
}

/** Reject a summary prepared against any earlier surface generation. */
function assertWholeSurfaceUnchanged(
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
): void {
  const current = dependencies.meter.measure(session)
  if (!isDeepStrictEqual(current.nodes, prepared.measurement.nodes)) {
    throw new SurfaceChangedError('compaction: session surface changed during summarization')
  }
}

/**
 * Require only that the selected span remain the same present, contiguous,
 * equally priced, balanced replacement target. Nodes added outside it remain
 * visible and do not invalidate the summary.
 */
function assertSelectedSpanStable(
  dependencies: RegionDependencies,
  session: Session,
  prepared: PreparedCompaction,
): void {
  let current: SurfaceSelection
  try {
    current = validateSurfaceRegion(session, prepared.start, prepared.end)
  } catch (error: unknown) {
    throw new SurfaceChangedError(
      'compaction: the selected span is no longer a valid replacement target',
      { cause: error },
    )
  }
  if (!isDeepStrictEqual([...current.shadowedSeqs], [...prepared.shadowedSeqs])) {
    throw new SurfaceChangedError('compaction: the selected span changed during summarization')
  }
  const measured = dependencies.meter.measure(session).nodes.slice(current.startIdx, current.endIdx + 1)
  if (!isDeepStrictEqual(measured, prepared.selectedNodes)) {
    throw new SurfaceChangedError('compaction: the selected span was rewritten during summarization')
  }
}

/** Append one completed summary record and replacement body without yielding. */
function commitCompactionBody(
  session: Session,
  startEvent: SessionEvent<'compaction/start'>,
  summarized: SummarizedCompaction,
): Omit<CompactionResult, 'endSeq'> {
  const {
    start,
    end,
    shadowedSeqs,
    shadowedTokenCount,
    summary,
    provider,
    model,
    maxTokens,
    usage,
    checkpointMessage,
  } = summarized
  const callRecord = summarized.llmStreamCall === true
    ? { rawOutput: summarized.rawOutput, llmStreamCall: true as const }
    : summarized.rawOutput === undefined ? {} : { rawOutput: summarized.rawOutput }
  const summaryEvent = session.append('compaction/summary', {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    summary,
    ...callRecord,
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
    provider,
    model,
    ...maxTokens === undefined ? {} : { maxTokens },
    ...usage === undefined ? {} : { usage },
  })
  session.append('user/message', checkpointMessage, {
    surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
    sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
  })
  return {
    compactionId: startEvent.data.compactionId,
    ...startEvent.data.sourceCommandId === undefined
      ? {}
      : { sourceCommandId: startEvent.data.sourceCommandId },
    startSeq: startEvent.seq,
    summarySeq: summaryEvent.seq,
    summary,
    shadowedRange: { start, end },
    shadowedSeqs: [...shadowedSeqs],
    shadowedTokenCount,
  }
}

/** Attach the successfully appended close event to a pending result. */
function completeCompaction(
  pending: Omit<CompactionResult, 'endSeq'>,
  endEvent: SessionEvent<'compaction/end'>,
): CompactionResult {
  return { ...pending, endSeq: endEvent.seq }
}

/**
 * Reconstruct the last routed request's cacheable prefix for the shadowed
 * region: the system prompt held by the `system/message` at surface node 0,
 * then the region's own derived messages in surface order, plus the header's
 * tool schemas for the recorded input. The summarizer call omits tools and
 * appends only the compaction instruction after the messages, so the call
 * reuses the provider's KV cache for that prefix. A surface without a system
 * head, or whose head projects to no message, contributes no leading system
 * message.
 * @param session - session supplying the surface head, request header, and per-node projection.
 * @param shadowedSeqs - the surface-node seqs, in order, being compacted.
 * @returns the replayed conversation prefix to condense.
 */
function buildSummarizationInput(
  session: Session,
  shadowedSeqs: readonly SessionSeq[],
): SummarizationInput {
  const header = session.requestHeader()
  // shadowedSeqs are current surface seqs, so the surface has a node 0.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const head = systemHead(session, session.surface.nodes[0]!)
  const system = head === undefined ? null : session.deriveEventMessage(head)
  const regionMessages = shadowedSeqs
    // shadowedSeqs are current surface seqs, so each is a valid log index.
    // Existing Session history read; migration deferred.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    .map(seq => session.deriveEventMessage(session.eventAt(seq)!))
    .filter((message): message is Message => message !== null)
  return {
    ...header?.tools === undefined ? {} : { tools: header.tools },
    messages: system === null ? regionMessages : [system, ...regionMessages],
  }
}

/** Inspect open-turn, unmatched-compaction, and latest seed-boundary state independently. */
function inspectCompactionEntryState(session: Session): CompactionEntryState {
  let openTurn: number | null = null
  let openTurnStateKnown = false
  let unmatchedCompactionStart: SessionEvent<'compaction/start'> | undefined
  let compactionEntryStateKnown = false
  let latestEndSeedSeq: SessionSeq | undefined
  for (let seq = session.seq - 1; seq >= 0; seq -= 1) {
    // Existing Session history read; migration deferred.
    // oxlint-disable-next-line typescript/no-non-null-assertion, typescript/no-deprecated
    const event = session.eventAt(SessionSeq(seq))!
    if (latestEndSeedSeq === undefined && event.type === 'session/end-seed') {
      latestEndSeedSeq = event.seq
    }
    if (!compactionEntryStateKnown) {
      if (event.type === 'compaction/start') {
        unmatchedCompactionStart = event
        compactionEntryStateKnown = true
      } else if (event.type === 'compaction/end') {
        compactionEntryStateKnown = true
      }
    }
    if (!openTurnStateKnown) {
      if (event.type === 'turn/start') {
        openTurn = event.data.turn
        openTurnStateKnown = true
      } else if (event.type === 'turn/end') {
        openTurnStateKnown = true
      }
    }
    if (openTurnStateKnown
      && compactionEntryStateKnown
      && latestEndSeedSeq !== undefined) break
  }
  return { openTurn, unmatchedCompactionStart, latestEndSeedSeq }
}
