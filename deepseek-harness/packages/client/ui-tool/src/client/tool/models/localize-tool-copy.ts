/**
 * Locale chrome for tool rows: known English executor error prefixes in the
 * collapsed failure line and the Output section. Titles and Input/Output/Inspect
 * labels are localized by the row model and its keys; model-authored argument
 * summaries and unknown error bodies stay verbatim.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

const CODE_RUN_FAILED = /^code run failed \(([^)]+)\):\s*(.*)$/
const ERROR_PREFIX = 'Error: '

/** Exact English executor messages remapped as a whole line. */
const EXACT_ERROR_KEYS: Record<string, 'tool.error.waitAborted' | 'tool.error.toolAborted' | 'tool.error.toolAbortedBeforeDispatch' | 'tool.error.commandAborted'> = {
  'wait aborted': 'tool.error.waitAborted',
  'tool call aborted': 'tool.error.toolAborted',
  'tool call aborted before dispatch': 'tool.error.toolAbortedBeforeDispatch',
  'command aborted': 'tool.error.commandAborted',
}

const CANCELLED_DETAILS = new Set(['user', 'parent', 'disposed', 'aborted', '[object Object]'])

/**
 * Locale first line of a tool error shown in the collapsed row or Output.
 * Unknown English bodies keep their text; only the `Error:` prefix localizes.
 * @param text - first line of the settled result (or the whole flattened text).
 * @param t - conversation locale seat.
 * @returns the line to render.
 */
export function localizeDisplayedError(text: string, t: TranslateNS<'conversation'>): string {
  const rest = text.startsWith(ERROR_PREFIX) ? text.slice(ERROR_PREFIX.length) : text
  const exact = EXACT_ERROR_KEYS[rest]
  if (exact !== undefined) return t(exact)
  const codeRun = CODE_RUN_FAILED.exec(rest)
  if (codeRun !== null) {
    const kind = codeRun[1] === 'abort' ? t('tool.error.kind.abort') : codeRun[1]!
    return t('tool.error.codeRunFailed', { kind, message: localizeAbortDetail(codeRun[2]!, t) })
  }
  if (text.startsWith(ERROR_PREFIX)) {
    return t('tool.error.generic', { message: localizeAbortDetail(rest, t) })
  }
  return text
}

/**
 * Locale the first line of flattened tool output; later lines stay verbatim.
 * @param text - flattened result text.
 * @param t - conversation locale seat.
 * @returns the text to render in the Output section.
 */
export function localizeToolOutput(text: string, t: TranslateNS<'conversation'>): string {
  const nl = text.indexOf('\n')
  if (nl === -1) return localizeDisplayedError(text, t)
  return `${localizeDisplayedError(text.slice(0, nl), t)}${text.slice(nl)}`
}

function localizeAbortDetail(message: string, t: TranslateNS<'conversation'>): string {
  return CANCELLED_DETAILS.has(message) ? t('tool.error.cancelled') : message
}
