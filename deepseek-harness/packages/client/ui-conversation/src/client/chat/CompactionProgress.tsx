// Live compaction progress: elapsed clock plus a bar that fills toward the
// host transaction deadline so a long summarizer call is visibly alive.

import { useEffect, useState } from 'react'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatRunDuration } from './message-chrome.ts'
import css from './CompactionProgress.module.css'

/**
 * Matches `COMPACTION_OPERATION_TIMEOUT_MS` in compaction-basic. The client
 * cannot import that host package; keep the number aligned when the deadline
 * changes.
 */
export const COMPACTION_PROGRESS_DEADLINE_MS = 5 * 60 * 1_000

/** Percent of the deadline elapsed, capped below 100 until the row settles. */
export function compactionProgressPercent(elapsedMs: number, nowDeadlineMs = COMPACTION_PROGRESS_DEADLINE_MS): number {
  if (elapsedMs <= 0) return 0
  return Math.min(92, Math.max(1, Math.floor((elapsedMs / nowDeadlineMs) * 92)))
}

/**
 * Tick elapsed time from a durable start timestamp.
 * @param startedAt - Unix epoch ms of `command/run` or `compaction/start`.
 */
export function useCompactionProgress(startedAt: number): { percent: number; elapsedMs: number } {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(Date.now())
    }, 250)
    return () => {
      window.clearInterval(id)
    }
  }, [])
  const elapsedMs = Math.max(0, now - startedAt)
  return { percent: compactionProgressPercent(elapsedMs), elapsedMs }
}

interface CompactionProgressBarProps {
  startedAt: number
  t: ChatViewSlotProps['t']
}

/** Determinate bar and elapsed label for an in-flight compaction. */
export function CompactionProgressBar({ startedAt, t }: CompactionProgressBarProps) {
  const { percent, elapsedMs } = useCompactionProgress(startedAt)
  const label = t('message.compaction.runningProgress', {
    elapsed: formatRunDuration(elapsedMs, t),
    percent,
  })
  return (
    <div className={css.progress}>
      <div
        className={css.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className={css.fill} style={{ width: `${percent}%` }} />
      </div>
      <span className={css.label}>{label}</span>
    </div>
  )
}
