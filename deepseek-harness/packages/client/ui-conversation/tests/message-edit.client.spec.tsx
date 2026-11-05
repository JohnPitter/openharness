// Same-session latest-message revision, composer half: entering editing
// prefills the draft and stashes the prior one, cancel restores it, the next
// send routes to the revision sink (never the default prompt sink), and a
// refused revision keeps both the draft and the editing state with the
// Host's reason mapped to user-facing copy.

import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { SubmitOutcome } from '../src/client/contract/input.ts'
import type { ConversationLocation } from '../src/client/contract/conversation.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { editFailureKey, RevisionFailure } from '../src/client/input/hub.ts'
import { en, zh } from '../src/client/locales.ts'

const commandAttachments = {
  serialize: () => Promise.resolve([]),
  release: () => {},
  unsupportedNotice: (token: string) => `${token.trim()} attachments-unsupported`,
}

const LOCATION = { kind: 'turn', turn: { turn: 2 } } as unknown as ConversationLocation

function shellWith(editSink?: (text: string) => Promise<void>) {
  const defaultSink = vi.fn(() => Promise.resolve<SubmitOutcome>({ kind: 'success' }))
  const shell = new SessionInputShell({
    actx: {} as Context,
    defaultSink,
    commandAttachments,
    ...editSink === undefined ? {} : { editSink: (text: string) => editSink(text) },
  })
  return { shell, defaultSink }
}

describe('SessionInputShell editing state', () => {
  it('prefills the draft, publishes the revision anchor, and stashes the prior draft', () => {
    const { shell } = shellWith(() => Promise.resolve())
    shell.setDraft('work in progress')
    expect(shell.editMessage({ text: 'original prompt', location: LOCATION, messageId: 'm-7', anchorSeq: 7 })).toBe(true)
    expect(shell.snapshot.draft).toBe('original prompt')
    expect(shell.snapshot.editing).toEqual({ atSeq: 7, messageId: 'm-7', previousDraft: 'work in progress' })
  })

  it('refuses without a revision sink, an anchor, or a Turn Location', () => {
    expect(shellWith().shell.editMessage({ text: 'x', location: LOCATION, anchorSeq: 7 })).toBe(false)
    const { shell } = shellWith(() => Promise.resolve())
    expect(shell.editMessage({ text: 'x', location: LOCATION })).toBe(false)
    expect(shell.editMessage({ text: 'x', location: { kind: 'session' } as ConversationLocation, anchorSeq: 7 })).toBe(false)
    expect(shell.snapshot.editing).toBeNull()
  })

  it('cancel restores the stashed draft and clears the editing state', () => {
    const { shell } = shellWith(() => Promise.resolve())
    shell.setDraft('keep me')
    shell.editMessage({ text: 'original', location: LOCATION, messageId: 'm-7', anchorSeq: 7 })
    expect(shell.cancelEdit()).toBe(true)
    expect(shell.snapshot.draft).toBe('keep me')
    expect(shell.snapshot.editing).toBeNull()
    expect(shell.cancelEdit()).toBe(false)
  })

  it('send while editing routes through the revision sink and clears on success', async () => {
    const editSink = vi.fn(() => Promise.resolve())
    const { shell, defaultSink } = shellWith(editSink)
    shell.editMessage({ text: 'original', location: LOCATION, messageId: 'm-7', anchorSeq: 7 })
    shell.setDraft('revised text')
    shell.submit()
    await vi.waitFor(() => { expect(editSink).toHaveBeenCalledWith('revised text') })
    await vi.waitFor(() => { expect(shell.snapshot.editing).toBeNull() })
    expect(defaultSink).not.toHaveBeenCalled()
  })

  it('a refused revision keeps the draft and the editing state', async () => {
    const editSink = vi.fn(() => Promise.reject(new RevisionFailure('session/revision-anchor-stale')))
    const { shell } = shellWith(editSink)
    shell.editMessage({ text: 'original', location: LOCATION, messageId: 'm-7', anchorSeq: 7 })
    shell.setDraft('revised text')
    shell.submit()
    await vi.waitFor(() => { expect(editSink).toHaveBeenCalledOnce() })
    await vi.waitFor(() => { expect(shell.snapshot.phase).toBe('plain') })
    expect(shell.snapshot.draft).toBe('revised text')
    expect(shell.snapshot.editing).toMatchObject({ atSeq: 7 })
  })
})

describe('revision failure copy', () => {
  it('maps each Host refusal to its own localized copy and anything else to the generic one', () => {
    expect(editFailureKey(new RevisionFailure('session/active'))).toBe('message.editFailed.active')
    expect(editFailureKey(new RevisionFailure('session/revision-anchor-stale'))).toBe('message.editFailed.stale')
    expect(editFailureKey(new RevisionFailure('session/revision-anchor-not-latest'))).toBe('message.editFailed.notLatest')
    expect(editFailureKey(new RevisionFailure('session/revision-incomplete-turn'))).toBe('message.editFailed.incompleteTurn')
    expect(editFailureKey(new RevisionFailure('session/revision-uncertain'))).toBe('message.editFailed.uncertain')
    expect(editFailureKey(new RevisionFailure('session-unavailable'))).toBe('message.editFailed')
    expect(editFailureKey(new Error('transport'))).toBe('message.editFailed')
    expect(zh['message.editFailed.stale']).not.toBe(en['message.editFailed.stale'])
  })
})
