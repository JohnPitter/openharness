/** Shared projection of the live LLM registry into the browser model catalog. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ModelCatalog,
  ModelReasoning,
  ModelSelection,
} from './types.ts'

/** Per-provider bound on `listModels` inside the picker catalog. */
export const MODEL_CATALOG_PROVIDER_TIMEOUT_MS = 4_000

/**
 * Race one provider listing against a deadline so a hung adapter cannot stall the picker.
 * @param work - provider listing in flight.
 * @param ms - deadline in milliseconds.
 * @param message - failure text when the deadline wins.
 * @returns the listing result.
 */
function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    work.finally(() => {
      if (timer !== undefined) clearTimeout(timer)
    }),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => { reject(new Error(message)) }, ms)
    }),
  ])
}

/**
 * Build the browser model catalog without requiring a Session. Routes whose
 * adapter does not currently advertise models (no usable API key or OAuth
 * session) are omitted rather than listed as empty or failed; each listing is
 * bounded by {@link MODEL_CATALOG_PROVIDER_TIMEOUT_MS} and a timeout rides
 * `failures` without failing the sound groups.
 * @param ctx - Host context carrying the live LLM registry.
 * @param defaultSelection - deployment default used before a Session selects a model.
 * @param timeoutMs - per-provider listing deadline.
 * @returns successful non-empty provider groups and isolated provider failures.
 */
export async function buildModelCatalog(
  ctx: Context,
  defaultSelection: ModelSelection = ctx.agentDefaultModel.currentSelection(),
  timeoutMs: number = MODEL_CATALOG_PROVIDER_TIMEOUT_MS,
): Promise<ModelCatalog> {
  const providers = ctx.llm.listProviders()
  const catalog = await Promise.all(providers.map(async (provider) => {
    try {
      if (!await ctx.llm.advertiseModels(provider.id)) return { kind: 'hidden' as const }
      const models = await withTimeout(
        ctx.llm.listModels(provider.id),
        timeoutMs,
        `model listing timed out after ${String(timeoutMs)}ms`,
      )
      const entries = await Promise.all(models.map(async (model) => {
        const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id)
        const reasoning: ModelReasoning | undefined = resolved.reasoning === undefined
          ? undefined
          : {
            efforts: resolved.reasoning.efforts.map(effort => ({
              id: effort.id,
              name: effort.name,
              ...(effort.description === undefined ? {} : { description: effort.description }),
            })),
            ...(resolved.reasoning.defaultEffort === undefined
              ? {}
              : { defaultEffort: resolved.reasoning.defaultEffort }),
          }
        return {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(model.badge === undefined ? {} : { badge: model.badge }),
          ...(resolved.context === undefined ? {} : { contextWindow: resolved.context.contextWindow }),
        }
      }))
      return {
        kind: 'group' as const,
        group: {
          id: provider.id,
          name: provider.name,
          ...(ctx.llm.providerMetering(provider.id) === 'requests' ? { metering: 'requests' as const } : {}),
          models: entries,
        },
      }
    } catch (error) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  const groups = catalog.flatMap(item => item.kind === 'group' ? [item.group] : [])
    .filter(group => group.models.length > 0)
  return {
    default: { ...defaultSelection },
    routableProviders: groups.map(group => group.id),
    groups,
    failures: catalog.flatMap(item => item.kind === 'failure' ? [item.failure] : []),
  }
}

/**
 * Check a GUI selection against the current available provider catalog.
 * @param ctx - Host LLM registry.
 * @param selection - stored or explicitly requested selection.
 * @returns whether the exact model is currently advertised as available; false for a route whose adapter advertises nothing.
 */
export async function modelAvailable(ctx: Context, selection: ModelSelection): Promise<boolean> {
  if (!ctx.llm.listProviders().some(provider => provider.id === selection.provider)) return false
  let models: readonly LlmModelInfo[]
  try {
    // A registered route without a usable credential stays in Settings but is not selectable.
    if (!await ctx.llm.advertiseModels(selection.provider)) return false
    models = await withTimeout(
      ctx.llm.listModels(selection.provider),
      MODEL_CATALOG_PROVIDER_TIMEOUT_MS,
      `model listing timed out after ${String(MODEL_CATALOG_PROVIDER_TIMEOUT_MS)}ms`,
    )
  }
  catch (error) {
    throw new RemoteError('session/model-unavailable',
      error instanceof Error ? error.message : String(error),
      { provider: selection.provider, model: selection.model })
  }
  return models.some(model => model.id === selection.model)
}

/**
 * Check configured provider API-key references independently of model availability.
 * @param ctx - Host registry, settings, and credential services.
 * @returns whether any API-key provider has a configured credential.
 */
export async function hasProviderApiKey(ctx: Context): Promise<boolean> {
  const settings = ctx.get('settings')
  const credentials = ctx.get('credentials')
  if (settings === undefined || credentials === undefined) {
    throw new RemoteError('session/provider-credentials-unavailable', 'provider credentials are unavailable', {})
  }
  const namespaces = settings.describe({ redactSecrets: true })
  for (const provider of ctx.llm.listConfigurableProviders()) {
    if (provider.provider === 'deepseek-account') continue
    let profile = namespaces.find(namespace => namespace.ns === provider.settingsNs)?.value
    for (const key of provider.settingsPath) {
      profile = typeof profile === 'object' && profile !== null ? Reflect.get(profile, key) : undefined
    }
    if (typeof profile !== 'object' || profile === null) continue
    const ref: unknown = Reflect.get(profile, 'apiKeyEnv')
    if (typeof ref === 'string' && ref.length > 0
      && (await credentials.describe(credentialRef(ref))).configured) return true
  }
  return false
}
