import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one recorded session milestone. */
export type MilestoneId = Branded<'MilestoneId'>

/**
 * Brand an implementation-minted milestone identity.
 * @param id - opaque milestone identity.
 * @returns the same string, branded; no validation is performed.
 */
export function MilestoneId(id: string): MilestoneId {
  return id as MilestoneId
}
