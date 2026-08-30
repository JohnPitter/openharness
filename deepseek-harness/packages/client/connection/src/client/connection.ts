import type { HostDescription, IApiClient, HostFrame, MuxFrame, RpcRequest } from './api.ts'

/** Reconnect/backoff tunables (deployment-varying — no hardcoded tunables; these become the
 *  future `ctx.connection` plugin's Config). All fields optional; defaults below. */
export interface ConnectionConfig {
  /** First-retry backoff cap in ms (jittered: actual delay is cap/2..cap). */
  backoffBaseMs?: number
  /** Exponential growth factor per consecutive failed attempt. */
  backoffFactor?: number
  /** Upper bound for the backoff cap in ms. */
  backoffMaxMs?: number
  /** Cap on waiting for both streams' onOpen before onConnected, in ms. The strict handshake
   *  waits for mux+host stream establishment plus describe; a carrier that never
   *  fires onOpen (misbehaving proxy) must not wedge the connection forever — on timeout the
   *  generation proceeds as connected and the live-gap repair path covers stragglers. */
  streamOpenTimeoutMs?: number
}

const CONNECTION_DEFAULTS: Required<ConnectionConfig> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  streamOpenTimeoutMs: 3_000,
}

const MANUAL_RECONNECT = new Error('connection: manual reconnect requested')
const NETWORK_STATE_CHANGED = new Error('connection: browser network state changed')

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
    function done(): void {
      clearTimeout(t)
      signal.removeEventListener('abort', done)
      resolve()
    }
  })
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
}

/** Coarse connection state for the UI after the first attempt has an outcome. */
export type ConnectionState = 'connected' | 'disconnected' | 'connecting'

/** Frame sink callbacks: the Controller owns the physical streams; business dispatch belongs to
 *  SessionManager. */
export interface ConnectionSinks {
  onMuxEnvelope?: (envelope: RpcRequest<MuxFrame>) => void
  onHostEnvelope?: (envelope: RpcRequest<HostFrame>) => void
  /** After each connection generation is established (both streams open + describe succeeded), first connect included. */
  onConnected?: (description: HostDescription) => void
  /** Coarse state transitions (deduplicated: fires only on change). The initial pre-connect
   *  span reports nothing — the UI treats "no state yet" as connecting, not as an outage. */
  onStateChange?: (state: ConnectionState) => void
}

/**
 * Opens both streams and keeps iterating (pull mode: nothing reads the socket and the tap
 * never fires unless someone for-awaits), reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * The pump body feeds each frame to a sink (sink exceptions must
 * not kill the pump — a broken business layer must not drag down the connection layer).
 */
export class ConnectionController {
  private generation = 0
  private attempt = 0
  private current: AbortController | null = null
  private retryDelay: AbortController | null = null
  private running = false
  private immediateRetry = false
  private networkAvailable = true
  private lastState: ConnectionState | null = null
  private readonly config: Required<ConnectionConfig>

  constructor(
    private readonly api: IApiClient,
    private readonly sinks: ConnectionSinks = {},
    config: ConnectionConfig = {},
  ) {
    this.config = { ...CONNECTION_DEFAULTS, ...config }
  }

  /** Idempotent: begin the connect/pump/reconnect loop. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  /** Stop the loop and abort the current generation's streams. */
  stop(): void {
    this.running = false
    this.current?.abort()
    this.current = null
    this.retryDelay?.abort()
    this.retryDelay = null
  }

  /** Reset the retry sequence and replace the current generation or retry delay immediately. */
  reconnect(): void {
    if (!this.running) return
    this.attempt = 0
    this.immediateRetry = true
    this.emitState('connecting')
    if (!this.isRunning()) return
    this.current?.abort(MANUAL_RECONNECT)
    this.retryDelay?.abort(MANUAL_RECONNECT)
  }

  /**
   * Suspend automatic retries while offline and restart backoff when the network returns.
   * @param available - whether the browser reports network access.
   */
  setNetworkAvailable(available: boolean): void {
    if (this.networkAvailable === available) return
    this.networkAvailable = available
    this.attempt = 0
    this.immediateRetry = false
    if (!this.running) return
    this.emitState(available ? 'connecting' : 'disconnected')
    if (!this.isRunning()) return
    this.current?.abort(NETWORK_STATE_CHANGED)
    this.retryDelay?.abort(NETWORK_STATE_CHANGED)
  }

  private backoffCap(attempt: number): number {
    const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config
    return Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1))
  }

  private backoffDelay(attempt: number): number {
    const cap = this.backoffCap(attempt)
    return cap / 2 + Math.random() * (cap / 2)
  }

  private isFinalBackoffTier(attempt: number): boolean {
    const cap = this.backoffCap(attempt)
    const nextCap = this.backoffCap(attempt + 1)
    return cap >= this.config.backoffMaxMs || !Number.isFinite(nextCap) || nextCap <= cap
  }

  /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
  private isRunning(): boolean {
    return this.running
  }

  /** Re-read both mutable liveness guards after a potentially reentrant sink. */
  private isGenerationActive(controller: AbortController): boolean {
    return this.isRunning() && !controller.signal.aborted
  }

  private async loop(): Promise<void> {
    let retry = false
    while (this.running) {
      if (!this.networkAvailable && !this.immediateRetry) {
        const retryDelay = new AbortController()
        this.retryDelay = retryDelay
        this.emitState('disconnected')
        await waitForAbort(retryDelay.signal)
        if (this.retryDelay === retryDelay) this.retryDelay = null
        if (!this.isRunning()) return
        retry = true
        continue
      }

      let manualAttempt = false
      if (retry) {
        const immediate = this.immediateRetry
        this.immediateRetry = false
        if (immediate) this.attempt = 0
        manualAttempt = immediate
        if (!immediate && this.attempt > 0 && this.isFinalBackoffTier(this.attempt)) {
          const retryDelay = new AbortController()
          this.retryDelay = retryDelay
          this.emitState('disconnected')
          await waitForAbort(retryDelay.signal)
          if (this.retryDelay === retryDelay) this.retryDelay = null
          continue
        }
        const attempt = ++this.attempt
        this.emitState('connecting')
        if (!this.isRunning()) return
        if (!immediate) {
          const retryDelay = new AbortController()
          this.retryDelay = retryDelay
          await sleep(this.backoffDelay(attempt), retryDelay.signal)
          if (this.retryDelay === retryDelay) this.retryDelay = null
          if (!this.isRunning()) return
          if (retryDelay.signal.aborted) continue
        }
        console.warn(`[web-runtime] connection lost, retry #${String(attempt)}`)
      }

      const gen = ++this.generation
      const ac = new AbortController()
      this.current = ac

      /* v8 ignore next -- initializer placeholder: the Promise executor
       * below runs synchronously and replaces it before anyone can call it. */
      let muxOpened = (): void => {}
      /* v8 ignore next -- same placeholder pattern as muxOpened. */
      let hostOpened = (): void => {}
      const streamsOpen = Promise.all([
        new Promise<void>((resolve) => { muxOpened = resolve }),
        new Promise<void>((resolve) => { hostOpened = resolve }),
      ])

      const failed = new Promise<void>((resolve) => {
        const settle = (): void => {
          if (gen === this.generation && !ac.signal.aborted) ac.abort()
          resolve()
        }
        void this.pumpStream(this.api.events.mux({}, ac.signal, muxOpened), this.sinks.onMuxEnvelope, settle)
        void this.pumpStream(this.api.events.host({}, ac.signal, hostOpened), this.sinks.onHostEnvelope, settle)
      })

      try {
        // Strict readiness handshake: describe proves unary reachability, onOpen
        // proves each physical stream is established before any frame —
        // only then may onConnected fire, so the resync it triggers cannot outrun the
        // subscribed baseline. The timeout guards against a carrier that never fires onOpen
        // (see ConnectionConfig.streamOpenTimeoutMs).
        const timeout = new AbortController()
        const [description] = await Promise.all([
          this.api.host.describe({}),
          Promise.race([streamsOpen, sleep(this.config.streamOpenTimeoutMs, timeout.signal)]),
        ])
        timeout.abort()
        const descriptionResult = description.result
        if (!descriptionResult.ok) {
          throw new Error(`host.describe failed: ${descriptionResult.error.code}: ${descriptionResult.error.message}`)
        }
        if (ac.signal.aborted) throw new Error('generation aborted during readiness handshake')
        this.attempt = 0
        this.emitState('connected')
        // A state sink may synchronously stop this controller. Do not publish
        // a description for a generation that no longer exists afterward.
        if (this.isGenerationActive(ac)) {
          this.callSink(() => { this.sinks.onConnected?.(descriptionResult.value) })
        }
      } catch {
        // Transport failure: treat as generation failure, fall through to the shared backoff.
        if (!ac.signal.aborted) ac.abort()
      }

      await failed
      if (!this.isRunning()) return
      if (manualAttempt) this.attempt = 0
      retry = true
    }
  }

  /** Deduplicated state emission (sink isolation applies). */
  private emitState(state: ConnectionState): void {
    if (this.lastState === state) return
    this.lastState = state
    this.callSink(() => this.sinks.onStateChange?.(state))
  }

  private async pumpStream<F extends { type: string }>(
    stream: AsyncIterable<RpcRequest<F>>,
    sink: ((envelope: RpcRequest<F>) => void) | undefined,
    onEnd: () => void,
  ): Promise<void> {
    try {
      for await (const envelope of stream) {
        if (envelope.payload.type === 'stream/error') break
        if (sink !== undefined) this.callSink(() => { sink(envelope) })
      }
    } catch {
      // Stream loss: converge on onEnd, which triggers the shared reconnect.
    }
    onEnd()
  }

  /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
  private callSink(fn: () => void): void {
    try {
      fn()
    } catch (error) {
      console.error('[web-runtime] connection sink threw:', error)
    }
  }
}
