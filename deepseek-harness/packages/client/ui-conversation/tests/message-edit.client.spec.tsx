// @vitest-environment jsdom
// Sent-message editing: the bubble affordance (edit icon on settled user
// bubbles; steering excluded; the window's first turn refuses), the composer
// editing state (prefill, indicator, Esc/cancel draft restore), and the
// fork → child-prompt → switch orchestration (order, anchor, failure keeps
// the editing state and the draft).

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector, makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CHAT_SNAPSHOT, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ChatConversationViewNode, ClientContext, ConversationSnapshot, SessionId, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SubmitOutcome } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { UserMessageNodeView } from '../src/client/chat/MessageItem.tsx'
import type { ChatNodeViewProps } from '../src/client/contract/slots.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import type { EditingMessage } from '../src/client/input/contract.ts'
import { InputHub } from '../src/client/input/hub.ts'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { ConversationController } from '../src/client/service.ts'
import { InputBar, type InputBarProps } from '../src/client/skeleton/InputBar.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

// jsdom implements no Range geometry; the composer measures the caret through
// one when it restores the selection after an edit it performed itself.
Range.prototype.getBoundingClientRect = () => ({ top: 0, bottom: 0 }) as DOMRect

// Mirrors the real lookup chain (conversation namespace, then common).
const t = makeTranslate(zh, commonZh)
const SCTX = {} as ClientContext
const SID = 's1' as SessionId

/** Minimal TurnLocation fixture (closed turns carry their `turn/end` seq). */
function turnLocation(turn: number, endSeq: number | undefined): TurnLocation {
  return {
    turn,
    start: undefined,
    end: endSeq === undefined ? undefined : ({
      type: 'turn/end', seq: endSeq, time: 1_000, turn, reason: 'completed',
    } as never),
    status: endSeq === undefined ? 'open' : 'closed',
    steps: [],
    data: undefined as never,
  }
}

/** User-bubble view node fixture over one turn Location. */
function userNode(kind: 'user' | 'steering', text: string, turn: TurnLocation): ChatConversationViewNode {
  return {
    key: `fixture:${kind}:3`,
    kind,
    id: '3',
    target: 'chat',
    anchorSeq: 3,
    location: { kind: 'turn', turn },
    visibility: 'visible',
    data: { kind, seq: 3, time: 1_000, content: [{ type: 'text', text }], source: null },
  } as never
}

/** Real input shell wired for editing: edit sink spy + two-closed-turn boundary. */
function shellBench(editSinkImpl?: (text: string, mode: 'queue' | 'steer', editing: EditingMessage) => Promise<void>) {
  const editSink = vi.fn(editSinkImpl ?? (() => Promise.resolve()))
  const editBoundary = vi.fn((turn: number) => (turn === 1 ? undefined : 19))
  const defaultSink = vi.fn<() => Promise<SubmitOutcome>>(() => Promise.resolve({ kind: 'success' }))
  const shell = new SessionInputShell({
    actx: SCTX,
    defaultSink,
    editSink,
    editBoundary,
    commandImages: {
      serialize: () => Promise.resolve([]),
      release: () => {},
      unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
    },
  })
  return { shell, editSink, editBoundary, defaultSink }
}

describe('UserMessageNodeView edit affordance', () => {
  it('shows the edit action on a settled user bubble and reports text plus Location on click', () => {
    const editMessage = vi.fn()
    const node = userNode('user', 'hello edit', turnLocation(2, 29))
    render(
      <UserMessageNodeView
        {...{ node, t, renderMessageImages: () => null, editMessage } as unknown as ChatNodeViewProps<'user' | 'steering'>}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '编辑消息' }))
    expect(editMessage).toHaveBeenCalledWith('hello edit', node.location)
  })

  it('hides the edit action on steering bubbles and without owner wiring', () => {
    const editMessage = vi.fn()
    const steering = render(
      <UserMessageNodeView
        {...{
          node: userNode('steering', 'steered', turnLocation(2, 29)),
          t,
          renderMessageImages: () => null,
          editMessage,
        } as unknown as ChatNodeViewProps<'user' | 'steering'>}
      />,
    )
    expect(steering.queryByRole('button', { name: '编辑消息' })).toBeNull()
    cleanup()
    const plain = render(
      <UserMessageNodeView
        {...{
          node: userNode('user', 'hello edit', turnLocation(2, 29)),
          t,
          renderMessageImages: () => null,
        } as unknown as ChatNodeViewProps<'user' | 'steering'>}
      />,
    )
    expect(plain.queryByRole('button', { name: '编辑消息' })).toBeNull()
  })
})

describe('SessionInputShell editing state', () => {
  it('prefills the draft, publishes the fork anchor, and stashes the prior draft', () => {
    const { shell, editBoundary } = shellBench()
    shell.setDraft('work in progress')
    const entered = shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    expect(entered).toBe(true)
    expect(editBoundary).toHaveBeenCalledWith(2)
    expect(shell.snapshot.draft).toBe('original message')
    expect(shell.snapshot.editing).toEqual({ previousDraft: 'work in progress', atSeq: 19 })
  })

  it('refuses the window’s first turn (no fork boundary)', () => {
    const { shell } = shellBench()
    shell.setDraft('keep me')
    const entered = shell.editMessage({ text: 'first message', location: { kind: 'turn', turn: turnLocation(1, 19) } })
    expect(entered).toBe(false)
    expect(shell.snapshot.draft).toBe('keep me')
    expect(shell.snapshot.editing).toBeNull()
  })

  it('cancel restores the stashed draft and clears the editing state', () => {
    const { shell } = shellBench()
    shell.setDraft('work in progress')
    shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    shell.setDraft('half-edited')
    shell.cancelEdit()
    expect(shell.snapshot.draft).toBe('work in progress')
    expect(shell.snapshot.editing).toBeNull()
  })

  it('send while editing routes through the edit sink and clears on success', async () => {
    const { shell, editSink, defaultSink } = shellBench()
    shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    shell.setDraft('revised text')
    shell.submit('queue')
    await vi.waitFor(() => {
      expect(editSink).toHaveBeenCalledWith('revised text', 'queue', expect.objectContaining({ atSeq: 19 }))
    })
    expect(defaultSink).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(shell.snapshot.editing).toBeNull()
      expect(shell.snapshot.draft).toBe('')
    })
  })

  it('edit failure keeps the draft and the editing state', async () => {
    const { shell, editSink, defaultSink } = shellBench(() => Promise.reject(new Error('fork-unavailable')))
    shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    shell.setDraft('revised text')
    shell.submit('queue')
    await vi.waitFor(() => { expect(editSink).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(defaultSink).not.toHaveBeenCalled()
    expect(shell.snapshot.draft).toBe('revised text')
    expect(shell.snapshot.editing).toEqual(expect.objectContaining({ atSeq: 19 }))
  })
})

function snapshotOf(overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: EMPTY_CHAT_SNAPSHOT,
    nodes: [], turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false,
    openState: 'open', openError: null, hasMore: false, loadingOlder: false,
    promptError: null, blank: false, subagent: null, lastAgentError: null,
    ...overrides,
  }
}

describe('InputBar editing indicator', () => {
  it('shows the indicator while editing; Esc and the cancel control restore the prior draft', () => {
    const { shell } = shellBench()
    const session = createSnapshotStore<ConversationSnapshot>(snapshotOf())
    const menuLauncher = createSnapshotStore<string | null>(null)
    shell.setDraft('work in progress')
    shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    const props: InputBarProps = {
      sessionId: SID,
      useSession: bindSnapshotSelector(session),
      useProjection: (() => undefined),
      useInput: bindSnapshotSelector(shell.state),
      inputActions: shell.actions,
      keyboard: shell,
      addImages: () => null,
      removeImage: () => {},
      draftImages: () => [],
      resolveSubmitMode: () => 'queue',
      toggleCommandMenu: () => {},
      stop: () => {},
      command: () => Promise.resolve(true),
      cancelEdit: () => { shell.cancelEdit() },
      useNotices: bindSnapshotSelector(shell.notices),
      useLexicon: bindSnapshotSelector(shell.lexicon),
      useMenuLauncher: bindSnapshotSelector(menuLauncher),
      t,
      renderSlot: () => null,
      variant: 'composer',
    } as unknown as InputBarProps
    const view = render(<InputBar {...props} />)
    const textarea = view.container.querySelector('textarea')!
    expect(textarea.value).toBe('original message')
    expect(screen.getByText('正在编辑已发送的消息')).toBeTruthy()

    // Esc cancels and restores.
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(shell.snapshot.editing).toBeNull()
    expect(textarea.value).toBe('work in progress')
    expect(screen.queryByText('正在编辑已发送的消息')).toBeNull()

    // Re-enter and cancel through the explicit control.
    act(() => {
      shell.editMessage({ text: 'original message', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    })
    expect(screen.getByText('正在编辑已发送的消息')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }))
    expect(shell.snapshot.editing).toBeNull()
    expect(textarea.value).toBe('work in progress')
  })
})

describe('InputHub edit orchestration', () => {
  async function hubBench() {
    const runtime = await SlotTestRuntime.create()
    const order: string[] = []
    const prompt = vi.fn(() => {
      order.push('prompt')
      return Promise.resolve({ ok: true as const, value: { accepted: true as const } })
    })
    await runtime.sessions.add({ id: 's1', session: { prompt } })
    const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
    const fiber = runtime.ctx.plugin(ConversationController, { input: hub, blocks: new ComposerBlockRegistry() })
    await fiber.await()
    const shell = hub.shellFor(runtime.sessions.binding('s1')!)
    await runtime.sessions.updateSnapshot('s1', (draft) => {
      // The snapshot fields are readonly on the type; the test-side timeline
      // stand-in writes through a mutable view like the other fixture benches.
      const chat = draft.chat as { timeline: unknown }
      chat.timeline = {
        turnOrder: [1, 2],
        turns: new Map([[1, turnLocation(1, 19)], [2, turnLocation(2, 29)]]),
      }
    })
    return { runtime, hub, shell, prompt, order }
  }

  it('forks at the previous turn end, prompts the revised text in the child, then switches', async () => {
    const b = await hubBench()
    const forkOpts: { sessionId: SessionId; atSeq?: number; increaseTitle?: boolean }[] = []
    const originalFork = b.runtime.sessions.fork.bind(b.runtime.sessions)
    b.runtime.sessions.fork = (opts) => {
      b.order.push('fork')
      forkOpts.push(opts)
      return originalFork(opts)
    }
    const originalOpen = b.runtime.sessions.open.bind(b.runtime.sessions)
    b.runtime.sessions.open = (id) => {
      b.order.push('open')
      originalOpen(id)
    }
    b.shell.editMessage({ text: 'original', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    b.shell.setDraft('revised')
    b.shell.submit('queue')
    await vi.waitFor(() => { expect(b.order).toEqual(['fork', 'prompt', 'open']) })
    expect(forkOpts).toEqual([{ sessionId: SID, atSeq: 19, increaseTitle: false }])
    expect(b.prompt).toHaveBeenCalledWith([{ type: 'text', text: 'revised' }], 'queue')
    await b.runtime.dispose()
  })

  it('failure keeps the editing state and the draft, and surfaces the edit-failed notice', async () => {
    const b = await hubBench()
    b.runtime.sessions.fork = () => Promise.reject(new Error('fork-unavailable'))
    b.shell.editMessage({ text: 'original', location: { kind: 'turn', turn: turnLocation(2, 29) } })
    b.shell.setDraft('revised')
    b.shell.submit('queue')
    await vi.waitFor(() => {
      expect(b.shell.notices.getSnapshot()).toEqual(
        expect.objectContaining({ level: 'error', text: '编辑失败，请重试。' }),
      )
    })
    await vi.waitFor(() => { expect(b.shell.snapshot.phase).toBe('plain') })
    expect(b.prompt).not.toHaveBeenCalled()
    expect(b.shell.snapshot.draft).toBe('revised')
    expect(b.shell.snapshot.editing).toEqual(expect.objectContaining({ atSeq: 19 }))
    await b.runtime.dispose()
  })
})
