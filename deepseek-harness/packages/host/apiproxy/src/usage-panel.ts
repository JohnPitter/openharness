/**
 * Host-local usage ledger: fold session-log token reports into daily and
 * per-model buckets, persist them under `$DSH_HOME`, and survive session delete.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { UsageBuckets, UsagePanelView } from './api/usage.ts'

/** On-disk ledger version. A mismatch discards the file and refolds from logs. */
const LEDGER_VERSION = 1

/** Route used when usage arrives before any `request/header`. */
const UNKNOWN_PROVIDER = 'unknown'
const UNKNOWN_MODEL = 'unknown'

/** Persistence face the ledger reads during backfill. */
export type UsagePanelPersistence = Pick<SessionPersistence, 'list' | 'inspect'>

/** Durable JSON document stored at `$DSH_HOME/usage-panel.json`. */
interface UsageLedgerFile {
  version: number
  days: Record<string, UsageBuckets>
  models: Record<string, UsageBuckets>
  sessions: Record<string, SessionTrackerFile>
}

interface SessionTrackerFile {
  lastSeq: number
  provider: string
  model: string
  last?: {
    turn: number
    step: number
    date: string
    modelKey: string
    buckets: UsageBuckets
  }
}

interface SessionTracker {
  lastSeq: number
  provider: string
  model: string
  last: SessionTrackerFile['last']
}

/** In-memory fold the ledger and tests share. */
export interface UsageFoldState {
  days: Map<string, UsageBuckets>
  models: Map<string, UsageBuckets>
  sessions: Map<string, SessionTracker>
}

/** Empty request/token bucket. */
export function emptyUsageBuckets(): UsageBuckets {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
}

/**
 * Local calendar day of a unix-ms timestamp.
 * @param timeMs - event `time` (unix milliseconds).
 * @returns `YYYY-MM-DD` in the Host local timezone.
 */
export function calendarDate(timeMs: number): string {
  const date = new Date(timeMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

/**
 * Stable map key for one provider/model pair (model ids may contain `/`).
 * @param provider - provider route key.
 * @param model - provider-owned model id.
 * @returns JSON tuple used as the models-map key.
 */
export function usageModelKey(provider: string, model: string): string {
  return JSON.stringify([provider, model])
}

function parseModelKey(key: string): { provider: string; model: string } {
  try {
    const parsed: unknown = JSON.parse(key)
    if (Array.isArray(parsed) && parsed.length === 2
      && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { provider: parsed[0], model: parsed[1] }
    }
  } catch (error: unknown) {
    // A corrupt on-disk model key still occupies a row; ids fall back to unknown.
    void error
  }
  return { provider: UNKNOWN_PROVIDER, model: UNKNOWN_MODEL }
}

/** Empty fold. */
export function createUsageFold(): UsageFoldState {
  return { days: new Map(), models: new Map(), sessions: new Map() }
}

/**
 * Sum billed tokens in one bucket (uncached input, cache traffic, and output).
 * @param buckets - one day or model row.
 * @returns the panel's token total for that row.
 */
export function usageTokenTotal(buckets: UsageBuckets): number {
  return buckets.inputTokens + buckets.outputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens
}

const bucketsFrom = (usage: TokenUsage): UsageBuckets => ({
  requests: 0,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
})

const bucketsEqual = (left: UsageBuckets, right: UsageBuckets): boolean =>
  left.inputTokens === right.inputTokens
  && left.outputTokens === right.outputTokens
  && left.cacheReadTokens === right.cacheReadTokens
  && left.cacheWriteTokens === right.cacheWriteTokens

const addBuckets = (left: UsageBuckets, right: UsageBuckets, requests: number): UsageBuckets => ({
  requests: Math.max(0, left.requests + requests),
  inputTokens: Math.max(0, left.inputTokens + right.inputTokens),
  outputTokens: Math.max(0, left.outputTokens + right.outputTokens),
  cacheReadTokens: Math.max(0, left.cacheReadTokens + right.cacheReadTokens),
  cacheWriteTokens: Math.max(0, left.cacheWriteTokens + right.cacheWriteTokens),
})

const subtractBuckets = (left: UsageBuckets, right: UsageBuckets): UsageBuckets => ({
  requests: left.requests,
  inputTokens: Math.max(0, left.inputTokens - right.inputTokens),
  outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
  cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
  cacheWriteTokens: Math.max(0, left.cacheWriteTokens - right.cacheWriteTokens),
})

const isEmptyBuckets = (buckets: UsageBuckets): boolean =>
  usageTokenTotal(buckets) === 0 && buckets.requests === 0

const credit = (map: Map<string, UsageBuckets>, key: string, delta: UsageBuckets, requests: number): void => {
  const next = addBuckets(map.get(key) ?? emptyUsageBuckets(), delta, requests)
  if (isEmptyBuckets(next)) map.delete(key)
  else map.set(key, next)
}

const debit = (map: Map<string, UsageBuckets>, key: string, previous: UsageBuckets): void => {
  const next = subtractBuckets(map.get(key) ?? emptyUsageBuckets(), previous)
  if (isEmptyBuckets(next)) map.delete(key)
  else map.set(key, next)
}

const trackerOf = (state: UsageFoldState, sessionId: string): SessionTracker => {
  const existing = state.sessions.get(sessionId)
  if (existing !== undefined) return existing
  const created: SessionTracker = {
    lastSeq: -1,
    provider: UNKNOWN_PROVIDER,
    model: UNKNOWN_MODEL,
    last: undefined,
  }
  state.sessions.set(sessionId, created)
  return created
}

const usageOf = (event: SessionEvent): { turn: number; step: number; usage: TokenUsage } | undefined => {
  if (event.type === 'assistant/chunk' && event.data.chunk.type === 'usage') {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.chunk.usage }
  }
  if (event.type === 'assistant/message' && event.data.usage !== undefined) {
    return { turn: event.data.turn, step: event.data.step, usage: event.data.usage }
  }
  return undefined
}

/**
 * Fold one session event into daily and per-model buckets.
 * Same-step usage samples replace the earlier value instead of double counting.
 * @param state - mutable fold.
 * @param sessionId - owning session identity.
 * @param event - log or live event.
 * @returns whether the fold changed.
 */
export function ingestSessionEvent(
  state: UsageFoldState,
  sessionId: string,
  event: SessionEvent,
): boolean {
  const tracker = trackerOf(state, sessionId)
  if (event.seq <= tracker.lastSeq) return false
  tracker.lastSeq = event.seq

  if (event.type === 'request/header') {
    tracker.provider = event.data.header.config.provider
    tracker.model = event.data.header.config.model
    return true
  }

  const reported = usageOf(event)
  if (reported === undefined) return true

  const nextBuckets = bucketsFrom(reported.usage)
  const previous = tracker.last !== undefined
    && tracker.last.turn === reported.turn
    && tracker.last.step === reported.step
    ? tracker.last
    : undefined
  if (previous !== undefined && bucketsEqual(previous.buckets, nextBuckets)) return true

  const date = calendarDate(event.time)
  const modelKey = usageModelKey(tracker.provider, tracker.model)
  if (previous !== undefined) {
    debit(state.days, previous.date, previous.buckets)
    debit(state.models, previous.modelKey, previous.buckets)
  }
  const previousEmpty = previous === undefined || usageTokenTotal(previous.buckets) === 0
  const nextEmpty = usageTokenTotal(nextBuckets) === 0
  const requestDelta = (nextEmpty ? 0 : 1) - (previousEmpty ? 0 : 1)
  credit(state.days, date, nextBuckets, requestDelta)
  credit(state.models, modelKey, nextBuckets, requestDelta)
  tracker.last = {
    turn: reported.turn,
    step: reported.step,
    date,
    modelKey,
    buckets: nextBuckets,
  }
  return true
}

/**
 * Project the fold into the wire view: days newest-first, models by token total.
 * @param state - current fold.
 * @returns `usage.panel` value.
 */
export function snapshotUsageFold(state: UsageFoldState): UsagePanelView {
  const days = [...state.days.entries()]
    .map(([date, buckets]) => ({ date, ...buckets }))
    .sort((left, right) => right.date.localeCompare(left.date))
  const models = [...state.models.entries()]
    .map(([key, buckets]) => ({ ...parseModelKey(key), ...buckets }))
    .sort((left, right) => {
      const tokenDelta = usageTokenTotal(right) - usageTokenTotal(left)
      return tokenDelta !== 0 ? tokenDelta : right.requests - left.requests
    })
  const totals = days.reduce<UsageBuckets>(
    (acc, day) => addBuckets(acc, day, day.requests),
    emptyUsageBuckets(),
  )
  return { days, models, totals }
}

const isBuckets = (value: unknown): value is UsageBuckets => {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return Number.isInteger(record.requests)
    && Number.isInteger(record.inputTokens)
    && Number.isInteger(record.outputTokens)
    && Number.isInteger(record.cacheReadTokens)
    && Number.isInteger(record.cacheWriteTokens)
}

const restoreFold = (file: UsageLedgerFile): UsageFoldState => {
  const state = createUsageFold()
  for (const [date, buckets] of Object.entries(file.days ?? {})) {
    if (isBuckets(buckets)) state.days.set(date, { ...buckets })
  }
  for (const [key, buckets] of Object.entries(file.models ?? {})) {
    if (isBuckets(buckets)) state.models.set(key, { ...buckets })
  }
  for (const [sessionId, tracker] of Object.entries(file.sessions ?? {})) {
    if (typeof tracker.lastSeq !== 'number' || typeof tracker.provider !== 'string' || typeof tracker.model !== 'string') {
      continue
    }
    state.sessions.set(sessionId, {
      lastSeq: tracker.lastSeq,
      provider: tracker.provider,
      model: tracker.model,
      last: tracker.last,
    })
  }
  return state
}

const serializeFold = (state: UsageFoldState): UsageLedgerFile => ({
  version: LEDGER_VERSION,
  days: Object.fromEntries(state.days),
  models: Object.fromEntries(state.models),
  sessions: Object.fromEntries([...state.sessions].map(([id, tracker]) => [id, {
    lastSeq: tracker.lastSeq,
    provider: tracker.provider,
    model: tracker.model,
    ...tracker.last === undefined ? {} : { last: tracker.last },
  }])),
})

/** Options for {@link UsagePanelLedger}. */
export interface UsagePanelLedgerOptions {
  /** Durable JSON path; omitted, the fold is process-local only. */
  path?: string
  /** Session store used to backfill watermarks; omitted, only live events fold. */
  persistence?: UsagePanelPersistence
}

/**
 * Process-owned usage fold: optional file, optional cold-log backfill, live ingest.
 */
export class UsagePanelLedger {
  private state = createUsageFold()
  private pending: Array<{ sessionId: string; event: SessionEvent }> = []
  private live = false
  private readonly readyPromise: Promise<void>
  private dirty = false
  private persistChain: Promise<void> = Promise.resolve()

  /**
   * @param options - optional file path and persistence backfill.
   */
  constructor(private readonly options: UsagePanelLedgerOptions = {}) {
    this.readyPromise = this.boot()
  }

  /**
   * Wait until the file load and cold-log backfill have finished, then replay
   * events that arrived during that window.
   */
  ready(): Promise<void> {
    return this.readyPromise
  }

  /**
   * Ingest a live or buffered session event.
   * @param sessionId - owning session.
   * @param event - appended log event.
   */
  ingestEvent(sessionId: SessionId | string, event: SessionEvent): void {
    const id = String(sessionId)
    if (!this.live) {
      this.pending.push({ sessionId: id, event })
      return
    }
    if (ingestSessionEvent(this.state, id, event)) this.markDirty()
  }

  /**
   * Current wire view. Call {@link ready} first so backfill is included.
   * @returns days, models, and totals.
   */
  snapshot(): UsagePanelView {
    return snapshotUsageFold(this.state)
  }

  private async boot(): Promise<void> {
    await this.loadFile()
    await this.backfill()
    const buffered = this.pending
    this.pending = []
    this.live = true
    for (const item of buffered) {
      if (ingestSessionEvent(this.state, item.sessionId, item.event)) this.dirty = true
    }
    if (this.dirty) await this.enqueuePersist()
  }

  private async loadFile(): Promise<void> {
    const path = this.options.path
    if (path === undefined) return
    try {
      const raw = await readFile(path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (parsed === null || typeof parsed !== 'object') return
      const file = parsed as UsageLedgerFile
      if (file.version !== LEDGER_VERSION) return
      this.state = restoreFold(file)
    } catch (error: unknown) {
      // Missing or unreadable ledger: fold from live events and remaining logs.
      if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') return
    }
  }

  private async backfill(): Promise<void> {
    const persistence = this.options.persistence
    if (persistence === undefined) return
    let headers
    try {
      headers = await persistence.list()
    } catch (error: unknown) {
      // A listing failure leaves the file/live fold as the authority.
      void error
      return
    }
    for (const header of headers) {
      try {
        const inspected = await persistence.inspect(header.id)
        for (const event of inspected.events) {
          if (ingestSessionEvent(this.state, String(header.id), event)) this.dirty = true
        }
      } catch (error: unknown) {
        // One unreadable log must not block the rest of the panel.
        void error
      }
    }
  }

  private markDirty(): void {
    this.dirty = true
    void this.enqueuePersist().catch((error: unknown) => {
      /* v8 ignore next -- live ingest must not reject when a concurrent write fails. */
      void error
    })
  }

  private enqueuePersist(): Promise<void> {
    const run = this.persistChain.then(() => this.flush())
    this.persistChain = run.then(() => undefined, (error: unknown) => {
      /* v8 ignore next -- keep the write queue moving after a failed flush. */
      void error
    })
    return run
  }

  private async flush(): Promise<void> {
    const path = this.options.path
    if (path === undefined || !this.dirty) return
    const body = `${JSON.stringify(serializeFold(this.state))}\n`
    this.dirty = false
    try {
      await writeFileAtomic(path, body, { mode: 0o600, dirMode: 0o700 })
    } catch (error: unknown) {
      /* v8 ignore start -- Windows/sandbox cannot always rename over an existing ledger. */
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        await writeFile(path, body, 'utf8')
        return
      }
      this.dirty = true
      throw error
      /* v8 ignore stop */
    }
  }
}
