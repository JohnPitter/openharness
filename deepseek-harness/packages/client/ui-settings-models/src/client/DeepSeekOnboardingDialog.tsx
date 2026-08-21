/**
 * First-run API-key step. Readiness comes from the same provider/settings/
 * credential join as the Models page: any provider the user can already talk
 * to ends the step. When none exists, the prompt lists every writable
 * key-based route so the user picks DeepSeek, Kimi, or another adapter and
 * enters that provider's key once.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import { onboardableRows, onboardingReadiness } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import styles from './DeepSeekOnboardingDialog.module.css'

/** Registration-side dependencies of {@link DeepSeekOnboardingDialog}. */
export interface DeepSeekOnboardingInjected {
  hooks: {
    /** Shared Models-page join state, bound by the slot renderer. */
    models: SnapshotStore<ModelsSettingsState>
  }
  /** Shared Models-page join controller. */
  controller: ModelsSettingsStore
  /** Existing wire face reused by the Models credential editor. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Feature copy. */
  t: (key: keyof typeof en) => string
}

/** Slot owner props plus the feature's injected dependencies. */
export type DeepSeekOnboardingDialogProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<DeepSeekOnboardingInjected>

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
  const { complete, controller, useModels, api, schema, t } = props
  const state = useModels(snapshot => snapshot)
  const readiness = onboardingReadiness(state)
  const [pickedProvider, setPickedProvider] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (state.status === 'idle') void controller.load()
  }, [controller, state.status])

  useEffect(() => {
    if (
      readiness.kind === 'adapter-absent'
      || readiness.kind === 'provider-ready'
      || readiness.kind === 'unavailable'
    ) complete()
  }, [complete, readiness.kind])

  switch (readiness.kind) {
    case 'loading':
    case 'adapter-absent':
    case 'provider-ready':
    case 'unavailable':
      return null
    case 'credential-missing':
      break
    /* v8 ignore next -- every current readiness variant is handled above */
    default:
      return assertNever(readiness)
  }

  const candidates = onboardableRows(state)
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

  return (
    <OnboardingModal title={t('onboardingTitle')}>
      <p className={styles.description}>{t('onboardingDescription')}</p>
      <div className={styles.editor}>
        <div className={styles.field}>
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
        </div>
        <ProviderEditor
          key={row.entry.provider}
          provider={row.entry.provider}
          displayName={row.entry.displayName}
          namespace={namespace}
          schema={schema}
          settingsPath={row.entry.settingsPath}
          api={api}
          t={t}
          readOnly={false}
          hideTitle
          credentialOnly
          credentialRequired
          autoFocusCredential
          cancelLabel="onboardingLater"
          submitLabel="onboardingSave"
          submitBusyLabel="onboardingSaving"
          onClose={finishCredential}
        />
      </div>
    </OnboardingModal>
  )
}
