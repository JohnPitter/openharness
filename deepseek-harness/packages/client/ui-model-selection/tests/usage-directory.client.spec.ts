/** Current-session directory observable used by the sidebar usage chip. */
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { currentDirectorySource } from '../src/client/usage-directory.ts'

const sid = (k: string): SessionId => k as SessionId

function empty(): ModelDirectoryState {
  return {
    current: null, routable: null, currentMetering: null, groups: [], failures: [], status: 'idle', error: null,
  }
}

describe('currentDirectorySource', () => {
  it('tracks the staged session directory and rebinds when current moves', () => {
    const a = createSnapshotStore<ModelDirectoryState>(empty())
    const b = createSnapshotStore<ModelDirectoryState>(empty())
    a.update((s) => { s.current = { provider: 'deepseek-official', model: 'deepseek-v4-flash' } })
    b.update((s) => { s.current = { provider: 'kimi-for-coding', model: 'k3-256k' } })
    const list = createSnapshotStore({ current: sid('a') as SessionId | undefined })
    const models = {
      directoryFor: (id: SessionId) => {
        if (id === sid('a')) return { store: a }
        if (id === sid('b')) return { store: b }
        throw new Error(`unknown ${String(id)}`)
      },
    }
    const source = currentDirectorySource(
      { list } as never,
      models as never,
    )
    expect(source.getSnapshot().current?.model).toBe('deepseek-v4-flash')

    const listener = vi.fn()
    const stop = source.subscribe(listener)
    a.update((s) => { s.routable = true })
    expect(listener).toHaveBeenCalled()

    list.update((s) => { s.current = sid('b') })
    expect(source.getSnapshot().current?.model).toBe('k3-256k')
    listener.mockClear()
    b.update((s) => { s.routable = true })
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    a.update((s) => { s.routable = false })
    expect(listener).not.toHaveBeenCalled()

    list.update((s) => { s.current = undefined })
    expect(source.getSnapshot().current).toBeNull()
    list.update((s) => { s.current = sid('ghost') })
    expect(source.getSnapshot().current).toBeNull()
    stop()
  })
})
