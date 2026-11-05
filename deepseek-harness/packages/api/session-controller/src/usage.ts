/**
 * Host-local usage Remote (`ctx.remote.usage`): the Settings → Status ledger
 * of daily and per-model request/token history, and the provider account
 * quota read used by Settings → Limits and the composer usage chip.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { UsagePanelLedger } from './usage-panel.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `usage` Remote namespace. */
    sessionUsage: SessionUsageController
  }
}

import type { AccountUsageRequest, AccountUsageView, UsagePanelView } from './types.ts'

export type {
  AccountUsageRequest, AccountUsageView, AccountUsageWindowView,
  UsageBuckets, UsageDayView, UsageModelView, UsagePanelView,
} from './types.ts'

/** Usage Remote deployment policy. */
export interface UsageConfig {
  /**
   * Persist the ledger at `$DSH_HOME/usage-panel.json` (deleted Sessions stay
   * in the totals) and backfill it from the stored logs at boot. Off (tests,
   * headless), the fold is process-local and covers live events only.
   */
  readonly persistLedger?: boolean
}

/** Host service backing `ctx.remote.usage`. */
export class SessionUsageController extends TypertRemoteService {
  static inject = ['llm']

  private ledger!: UsagePanelLedger

  /**
   * @param ctx - Host context carrying the LLM registry and optional Session persistence.
   * @param config - ledger persistence policy.
   */
  constructor(ctx: Context, private readonly config: UsageConfig = {}) {
    super(ctx, 'sessionUsage', { namespace: 'usage' })
  }

  protected [Service.init](): void {
    // A persisted ledger also backfills the stored logs once at boot; the
    // process-local fold (tests, headless) folds live events only.
    const persistence = this.config.persistLedger === true ? this.ctx.get('sessionPersistence') : undefined
    this.ledger = new UsagePanelLedger({
      ...this.config.persistLedger === true ? { path: dshHomePath('usage-panel.json') } : {},
      ...persistence === undefined ? {} : { persistence },
    })
    this.ctx.on('session/event', (session, event) => {
      this.ledger.ingestEvent(session.id, event)
    })
  }

  /**
   * Host-local request and token history folded from Session logs and live
   * `session/event` ingest. Empty when nothing has reported usage.
   * @returns days newest first, models by token total, and all-time totals.
   */
  @Remote('panel')
  async panel(): Promise<UsagePanelView> {
    await this.ledger.ready()
    return this.ledger.snapshot()
  }

  /**
   * Account-level quota for one provider route, using the credentials already
   * configured for generation. `supported: false` when the adapter has no
   * quota surface or the route is unregistered; read failures (missing key,
   * AUTH, transport) stay on `error` instead of failing the call.
   * @param request - provider route to inspect.
   * @param signal - caller cancellation for the adapter lookup.
   * @returns the quota view.
   */
  @Remote('accountUsage')
  async accountUsage(request: AccountUsageRequest, signal: AbortSignal): Promise<AccountUsageView> {
    try {
      const usage = await this.ctx.llm.accountUsage(request.provider, signal)
      if (usage === undefined) return { supported: false }
      return {
        supported: true,
        ...usage.plan === undefined || usage.plan.length === 0 ? {} : { plan: usage.plan },
        windows: usage.windows.map(window => ({
          id: window.id,
          used: window.used,
          limit: window.limit,
          percent: window.percent,
          ...window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt },
          ...window.windowMinutes === undefined ? {} : { windowMinutes: window.windowMinutes },
        })),
      }
    } catch (error: unknown) {
      if (error instanceof LlmError && error.code === 'NO_ADAPTER') return { supported: false }
      return { supported: true, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
