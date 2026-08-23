import { memo, useState } from 'react'
import { IconChevronDownOutline14, IconChevronRightOutline14, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps } from '../contract/slots.ts'
import css from './MessageItem.module.css'

/**
 * Collapsed-by-default milestone chip in the transcript.
 * @param props - keyed Chat renderer share for one `milestone` Node.
 * @returns the chip row, with the body disclosure when expanded.
 */
export const MilestoneNodeView = memo(function MilestoneNodeView({ node, t }: ChatNodeViewProps<'milestone'>) {
  const [expanded, setExpanded] = useState(false)
  const data = node.data
  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        aria-expanded={expanded}
        title={t('message.milestone.expand')}
        onClick={() => { setExpanded(value => !value) }}
      >
        <span className={css.compactionLeading} aria-hidden>
          <span
            className={css.compactionDisclosureIcon}
            data-compaction-disclosure={expanded ? 'expanded' : 'collapsed'}
          >
            {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
        </span>
        <span className={css.compactionTitle}>{t('message.milestone')}</span>
        <span className={css.compactionSep} aria-hidden />
        <span className={css.compactionSummary}>{data.title}</span>
      </button>
      {expanded && <div className={css.compactionBody}><MarkdownText text={data.body} /></div>}
    </div>
  )
})
