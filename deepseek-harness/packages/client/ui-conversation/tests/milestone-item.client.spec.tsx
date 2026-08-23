// @vitest-environment jsdom
// Milestone chip: collapsed title with a body disclosure.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { MilestoneNodeView } from '../src/client/chat/MilestoneItem.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(zh, commonZh)

function props(): ChatNodeViewProps<'milestone'> {
  return {
    t,
    node: {
      key: 'ms-1',
      kind: 'milestone',
      id: 'ms-1',
      target: 'chat',
      anchorSeq: 2,
      location: { kind: 'session' },
      visibility: 'visible',
      data: {
        seq: 2,
        time: 2_000,
        title: 'Found the leak',
        body: 'Cache key was session id.',
        origin: 'session',
      },
    },
  } as ChatNodeViewProps<'milestone'>
}

describe('MilestoneNodeView', () => {
  it('discloses the recorded body from the collapsed chip', () => {
    const view = render(<MilestoneNodeView {...props()} />)
    const row = view.getByRole('button', { name: /里程碑/ })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('Found the leak')).toBeTruthy()
    expect(view.queryByText('Cache key was session id.')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('Cache key was session id.')).toBeTruthy()
  })
})
