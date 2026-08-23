/**
 * Delegated `ask()` resolution: pick the recommended option label, else the first.
 * The suffix convention matches the model-facing schema on `ask_user_question`
 * and the Web composer's `parseRecommendedLabel`.
 *
 * @module @deepseek-ai/dsh-user-questions/auto-answer
 */

import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionItem,
} from './types.ts'

/** Conventional recommendation suffix on an option label. */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

/**
 * Whether an option label carries the recommendation suffix the schema documents.
 * @param label - Option label as submitted by the model.
 * @returns true when the label ends with `(Recommended)` or a Chinese 推荐 variant.
 */
export function isRecommendedOptionLabel(label: string): boolean {
  return RECOMMENDED_SUFFIX.test(label)
}

/**
 * Whether this live agent must not wait on a human channel.
 * Runtime ownership is the primary signal. A continuable child may still be a
 * registry root (created from a manager scope with no initiator); those stay
 * delegated while their durable parent session is live and `origin` is `subagent`.
 * @param agents - Live agent registry that already authenticated `agent`.
 * @param agent - The exact live calling agent.
 * @returns true when `ask()` must auto-answer or fail closed instead of waiting.
 */
export function isDelegatedQuestionCaller(agents: AgentRegistry, agent: Agent): boolean {
  if (!agents.roots().includes(agent)) return true
  const header = agent.session.header
  if (header.origin !== 'subagent') return false
  const parentId = header.parentSession
  return parentId !== undefined && agents.get(parentId) !== undefined
}

/**
 * Resolve a delegated question batch from option labels without a UI wait.
 * @param questions - The same items `ask()` validated.
 * @returns Structured answers, or `undefined` when any item has no options.
 */
export function autoAnswerDelegatedQuestions(
  questions: readonly AskUserQuestionItem[],
): AskUserQuestionAnswer | undefined {
  const answers: AskUserQuestionAnswerItem[] = []
  for (const question of questions) {
    const options = question.options ?? []
    const first = options[0]
    if (first === undefined) return undefined
    const recommended = options.filter(option => isRecommendedOptionLabel(option.label))
    if (question.multiSelect === true) {
      answers.push({
        id: question.id,
        selected: (recommended.length > 0 ? recommended : [first]).map(option => option.label),
      })
      continue
    }
    answers.push({
      id: question.id,
      selected: [(recommended[0] ?? first).label],
    })
  }
  return { answers }
}
