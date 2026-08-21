import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FileCredentialStore } from '../src/oauth-store.ts'
import { pickSelectOption, resetLoginWatches } from '../src/oauth-login.ts'
import { oauthAuthPath } from '../src/oauth-path.ts'

afterEach(() => {
  resetLoginWatches()
})

describe('pickSelectOption', () => {
  const options = [
    { id: 'browser', label: 'Browser login (default)' },
    { id: 'device_code', label: 'Device code login (headless)' },
  ] as const

  it('prefers Codex browser login on this desktop app', () => {
    expect(pickSelectOption('openai-codex', options).id).toBe('browser')
  })

  it('honours an explicit device-code request', () => {
    expect(pickSelectOption('openai-codex', options, 'device_code').id).toBe('device_code')
  })

  it('falls through to the first option for other providers', () => {
    expect(pickSelectOption('claude-code', [
      { id: 'console', label: 'Console' },
      { id: 'subscription', label: 'Subscription' },
    ]).id).toBe('console')
  })
})

describe('FileCredentialStore', () => {
  it('round-trips an OAuth credential and lists it without exposing the token', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-oauth-'))
    const path = join(dir, 'pi-ai-oauth.json')
    try {
      const store = new FileCredentialStore(path)
      await store.modify('claude-code', async () => ({
        type: 'oauth',
        access: 'access-token',
        refresh: 'refresh-token',
        expires: Date.now() + 60_000,
      }))
      const read = await store.read('claude-code')
      expect(read).toMatchObject({ type: 'oauth', access: 'access-token' })
      expect(await store.list()).toEqual([{ providerId: 'claude-code', type: 'oauth' }])
      const raw = await readFile(path, 'utf8')
      expect(raw).toContain('refresh-token')
      await store.delete('claude-code')
      expect(await store.read('claude-code')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('oauthAuthPath', () => {
  it('joins pi-ai-oauth.json onto DSH_HOME when set', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = 'C:\\tmp\\openharness-home'
    try {
      expect(oauthAuthPath().replace(/\\/g, '/')).toMatch(/openharness-home\/pi-ai-oauth\.json$/)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
