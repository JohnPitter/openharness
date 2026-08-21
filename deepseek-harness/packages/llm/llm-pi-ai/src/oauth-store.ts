/**
 * File-backed pi-ai CredentialStore. Writes serialize per provider id so a
 * refresh and a concurrent login cannot clobber each other.
 * @module dsh-llm-pi-ai/oauth-store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import { oauthAuthPath } from './oauth-path.ts'

type AuthFile = Record<string, Credential>

/** Durable store Models.getAuth() uses to refresh subscription tokens. */
export class FileCredentialStore implements CredentialStore {
  private readonly chains = new Map<string, Promise<void>>()
  private cache: AuthFile | undefined

  constructor(readonly path: string = oauthAuthPath()) {}

  private async load(): Promise<AuthFile> {
    if (this.cache !== undefined) return this.cache
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      this.cache = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? parsed as AuthFile
        : {}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = {}
    }
    return this.cache
  }

  private async save(next: AuthFile): Promise<void> {
    this.cache = next
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(task)
    this.chains.set(providerId, run.then(() => undefined, () => undefined))
    return run
  }

  async read(providerId: string): Promise<Credential | undefined> {
    const file = await this.load()
    return file[providerId]
  }

  async list(): Promise<readonly CredentialInfo[]> {
    const file = await this.load()
    return Object.entries(file).map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const file = { ...(await this.load()) }
      const next = await fn(file[providerId])
      if (next === undefined) return file[providerId]
      file[providerId] = next
      await this.save(file)
      return next
    })
  }

  delete(providerId: string): Promise<void> {
    return this.enqueue(providerId, async () => {
      const file = { ...(await this.load()) }
      if (file[providerId] === undefined) return
      delete file[providerId]
      await this.save(file)
    })
  }
}
