/**
 * First-run API-key step. Readiness comes from the same provider/settings/
 * credential join as the Models page: any provider the user can already talk
 * to ends the step. When none exists, the prompt lists every writable
 * key-based route so the user picks DeepSeek, Kimi, or another adapter and
 * enters that provider's key once.
 */
import type { TrackProductEvent } from '@deepseek-ai/dsh-client-product-analytics/client'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import { onboardableRows, onboardingReadiness } from './store.ts'
import type { ModelsOperations } from './operations.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type {} from './slot-contract.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  /** Desktop-only event collection. */
  track?: TrackProductEvent
  /** Whether first-run setup should show automatically. Explicit requests remain available. */
  automatic: boolean
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** The Host operations the reused Models credential editor writes through. */
  operations: ModelsOperations
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & PropsRenderSlots<'settings.models.sign-in'> & InjectFace<DeepSeekOnboardingInjected>

/* v8 ignore next 3 -- closed-union defaults only defend future source widening */
function assertNever(_value: never): never {
  throw new Error('unexpected DeepSeek onboarding state')
}

/** Prefer the official DeepSeek route, then the shipped coding providers. */
function preferredRow(rows: readonly ProviderRow[]): ProviderRow | undefined {
  const preferred = [
    'deepseek-official',
    'kimi-for-coding',
    'claude-code',
    'openai-codex',
    'zai',
    'anthropic',
    'openai',
  ]
  for (const provider of preferred) {
    const row = rows.find(entry => entry.entry.provider === provider)
    if (row !== undefined) return row
  }
  return rows[0]
}

/**
 * Prompt a first-run user for one provider credential while no provider can
 * serve requests and at least one key-based credential is writable.
 * @param props - settings-shell owner state and Models feature dependencies.
 * @returns the onboarding modal or null when onboarding needs no intervention.
 */
export function DeepSeekOnboardingDialog(props: DeepSeekOnboardingDialogProps): ReactNode {
  const { complete, controller, useModels, operations, schema, t, renderSlot, automatic, explicit = false } = props
  const [apiKey, setApiKey] = useState(explicit)
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  const [pickedProvider, setPickedProvider] = useState<string | undefined>(undefined)

  useEffect(() => {
    if ((automatic || explicit) && state.status === 'idle') void controller.load()
  }, [controller, state.status, automatic, explicit])

  useEffect(() => {
    if (
      (!automatic && !explicit)
      || readiness.kind === 'adapter-absent'
      || (!explicit && readiness.kind === 'provider-ready')
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind, explicit, automatic])

  if (!automatic && !explicit) return null

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'unavailable':
      return null
    case 'provider-ready':
      if (!explicit) return null
      break
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  // A first run lists every key-based route still missing a credential; the
  // explicit account-menu setup (a provider is already usable) keeps the
  // official DeepSeek editor.
  const official = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  const promptable = onboardableRows(state)
  const candidates = promptable.length > 0 ? promptable : official === undefined ? [] : [official]
  const row = candidates.find(candidate => candidate.entry.provider === pickedProvider)
    ?? preferredRow(candidates)
  const namespace = row === undefined ? undefined : state.namespaces.get(row.entry.settingsNs)
  /* v8 ignore next 2 -- credential-missing is derived only from promptable joined rows. */
  if (row === undefined || namespace === undefined) return null

  const finishCredential = (changed: boolean): void => {
    if (!changed) {
      complete()
      return
    }
    void controller.load()
  }

  const editor = (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        {candidates.length < 2 ? null : <div className={styles.field}>
          <span className={styles.fieldLabel}>{t('provider')}</span>
          <select
            className={`${styles.input} ${styles.selectInput}`}
            value={row.entry.provider}
            aria-label={t('provider')}
            onChange={(event) => { setPickedProvider(event.target.value) }}
          >
            {candidates.map(candidate => (
              <option key={candidate.entry.provider} value={candidate.entry.provider}>
                {candidate.entry.displayName}
              </option>
            ))}
          </select>
        </div>}
        <ProviderEditor
          key={row.entry.provider}
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          operations={operations}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          onSubmitCredential={() => { props.track?.('api_key_save_click', {}) }}
          credentialRequired
          autoFocusCredential
          cancelLabelKey="onboardingLater"
          submitLabelKey="onboardingSave"
          submitBusyLabelKey="onboardingSaving"
          onClose={finishCredential}
        />
      </div>
    </OnboardingModal>
  )
  return apiKey ? editor : renderSlot('settings.models.sign-in', { complete, useApiKey: () => { setApiKey(true) } }, { fallback: editor })
}
