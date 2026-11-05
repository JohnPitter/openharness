/** Adapt the wire-shaped fakes these specs build into the plugin's {@link UsageApi} face. */
import type { UsageApi } from '../src/client/usage-slots.ts'

type Wire<T> = Promise<{ result: { ok: true; value: T } | { ok: false; error: { message: string } } }>

/** The request/response fakes: llm.providers + llm.accountUsage, and usage.panel. */
export interface WireUsageFake {
  llm?: {
    providers?: (request: object) => Wire<{ providers: readonly { provider: string; displayName: string }[] }>
    accountUsage?: (request: { provider: string }, signal?: AbortSignal) => Wire<never>
  }
  usage?: { panel?: (request: object) => Wire<never> }
}

/**
 * Adapt one fake.
 * @param fake - the spec's wire-shaped fake.
 * @returns the UsageApi the components consume.
 */
export function usageApiOf(fake: WireUsageFake): UsageApi {
  return {
    listProviders: async () => {
      const { result } = await fake.llm!.providers!({})
      return result.ok ? { ok: true, value: result.value.providers } : { ok: false, error: result.error.message }
    },
    accountUsage: async (provider, signal) => {
      const { result } = await fake.llm!.accountUsage!({ provider }, signal)
      return result.ok ? result.value : { supported: true, error: result.error.message }
    },
    panel: async () => {
      const { result } = await fake.usage!.panel!({})
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error.message }
    },
  }
}
