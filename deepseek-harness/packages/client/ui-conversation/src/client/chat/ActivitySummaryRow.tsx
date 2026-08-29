import type { ReactNode } from 'react'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ActivityCategory, ActivityGroup } from './activity-groups.ts'
import css from './ChatView.module.css'
import a11yCss from './accessibility.module.css'

interface ActivitySummaryRowProps {
  readonly group: ActivityGroup
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly t: ChatViewSlotProps['t']
  readonly renderNode: (node: ActivityGroup['nodes'][number]) => ReactNode
}

const order: readonly ActivityCategory[] = ['context', 'explored', 'edits', 'searches', 'commands', 'web', 'subagents', 'other']

function categoryText(category: ActivityCategory, count: number, t: ChatViewSlotProps['t']): string {
  return t(`activity.${category}.${count === 1 ? 'one' : 'other'}`, { count })
}

/** Compact disclosure summary for a consecutive run of activity cards. */
export function ActivitySummaryRow({ group, expanded, onToggle, t, renderNode }: ActivitySummaryRowProps) {
  const summary = order
    .filter(category => group.counts[category] > 0)
    .map(category => categoryText(category, group.counts[category], t))
    .join(t('activity.separator'))
  return (
    <div className={css.flowItem} data-activity-group={group.key} data-running={group.running || undefined}>
      {group.running && <span className={a11yCss.visuallyHidden}>{t('activity.inProgress')}</span>}
      <DisclosureRow
        icon={group.running ? <StateDot state="ongoing" /> : <IconApiOutline14 size={14} />}
        title={summary}
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={onToggle}
        ariaLabel={t(expanded ? 'activity.collapse' : 'activity.expand')}
      >
        {group.nodes.map(node => <div key={node.key}>{renderNode(node)}</div>)}
      </DisclosureRow>
    </div>
  )
}
