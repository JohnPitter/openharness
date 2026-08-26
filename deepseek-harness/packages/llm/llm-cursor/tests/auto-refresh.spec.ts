import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as LlmCursor from '../src/index.ts'
import { encodeResponseFixture, frame, trailerFrame } from '../src/protobuf.ts'

/**
 * Fake `node:http2` client stream: an EventEmitter carrying the subset of
 * `ClientHttp2Stream` the transport uses.
 */
class FakeHttp2Stream extends EventEmitter {
  end(_body: Uint8Array): void { queueMicrotask(() => { this.deliver() }) }
  close(): void {}
  constructor(private readonly body: Uint8Array) { super() }
  private deliver(): void {
    this.emit('response', { ':status': 200 })
    this.emit('data', Buffer.from(this.body))
    this.emit('end')
  }
}

/** Shared mutable state the `node:http2` mock reads per test, set up before each `harness()` call. */
const http2State = vi.hoisted(() => ({
  onRequest: undefined as ((headers: Record<string, unknown>) => void) | undefined,
  body: undefined as Uint8Array | undefined,
}))

vi.mock('node:http2', async () => {
  const actual = await vi.importActual<typeof import('node:http2')>('node:http2')
  return {
    ...actual,
    connect: () => ({
      on: () => {},
      closed: false,
      destroyed: false,
      close: () => {},
      request: (headers: Record<string, unknown>) => {
        http2State.onRequest?.(headers)
        return new FakeHttp2Stream(http2State.body ?? textBody())
      },
    }),
  }
})

const ACCESS_REF = credentialRef('CURSOR_ACCESS_TOKEN')
const REFRESH_REF = credentialRef('CURSOR_REFRESH_TOKEN')
const dirs: string[] = []
const contexts: Context[] = []

/** A minimal unsigned JWT carrying only `exp`. */
function jwt(expEpochSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({ exp: expEpochSeconds, sub: 'user_1' })).toString('base64url')
  return `${header}.${body}.`
}

const FAR_FUTURE = jwt(Math.floor(Date.now() / 1000) + 3600)
const ALREADY_EXPIRED = jwt(Math.floor(Date.now() / 1000) - 60)
const ABOUT_TO_EXPIRE = jwt(Math.floor(Date.now() / 1000) + 30) // inside the 2-minute skew window

/** One complete Connect stream body: a text data frame carrying "hi", followed by a clean trailer. */
function textBody(): Uint8Array {
  const data = frame(encodeResponseFixture({ text: 'hi' }))
  const trailer = trailerFrame()
  const out = new Uint8Array(data.length + trailer.length)
  out.set(data)
  out.set(trailer, data.length)
  return out
}

/** Capture the request headers the mocked HTTP/2 stream (the Connect call) receives. */
function captureHttp2Headers(): { headers: Record<string, unknown> | undefined } {
  const captured: { headers: Record<string, unknown> | undefined } = { headers: undefined }
  http2State.onRequest = (headers) => { captured.headers = headers }
  return captured
}

async function harness(config: Partial<LlmCursor.Config> = {}): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-cursor-refresh-'))
  dirs.push(dir)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmCursor, {
    apiKeyEnv: 'CURSOR_ACCESS_TOKEN',
    refreshTokenEnv: 'CURSOR_REFRESH_TOKEN',
    defaultModel: 'composer-2.5',
    models: [],
    baseURL: 'https://api2.cursor.sh',
    clientVersion: '3.17.21',
    machineId: 'test-machine',
    ghostMode: false,
    transportMode: 'native',
    ...config,
  })
  return ctx
}

async function drain(ctx: Context): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'cursor', model: 'composer-2.5', messages: [] })) chunks.push(chunk)
  return chunks
}

/** The terminal `finish` chunk's `error`/`aborted` failure, or undefined when the stream finished normally. */
function failureOf(chunks: StreamChunk[]): { code: string } | undefined {
  const finish = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'finish' }> => chunk.type === 'finish')
  return finish !== undefined && (finish.reason.kind === 'error' || finish.reason.kind === 'aborted')
    ? finish.reason.failure
    : undefined
}

afterEach(async () => {
  vi.unstubAllGlobals()
  http2State.onRequest = undefined
  http2State.body = undefined
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  contexts.length = 0
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('llm-cursor auto-refresh', () => {
  it('uses the stored access token as-is while it is far from expiry', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, FAR_FUTURE)
    await ctx.credentials.set(REFRESH_REF, 'refresh-token')
    const captured = captureHttp2Headers()

    await drain(ctx)

    expect(captured.headers?.authorization).toBe(`Bearer ${FAR_FUTURE}`)
  })

  it('refreshes before streaming when the access token is already expired, and persists the result', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ALREADY_EXPIRED)
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    let refreshCalls = 0
    const captured = captureHttp2Headers()
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url.endsWith('/oauth/token')).toBe(true)
      refreshCalls++
      expect(JSON.parse(init.body as string)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'old-refresh' })
      return new Response(JSON.stringify({ access_token: 'fresh-access' }), { status: 200 })
    }))

    await drain(ctx)

    expect(refreshCalls).toBe(1)
    expect(captured.headers?.authorization).toBe('Bearer fresh-access')
    await expect(ctx.credentials.resolve(ACCESS_REF)).resolves.toMatchObject({ value: 'fresh-access' })
    // The refresh response carried no refresh_token of its own, so the
    // original is kept rather than overwritten with the access token.
    await expect(ctx.credentials.resolve(REFRESH_REF)).resolves.toMatchObject({ value: 'old-refresh' })
  })

  it('refreshes proactively inside the two-minute skew window even though the token has not expired yet', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ABOUT_TO_EXPIRE)
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url.endsWith('/oauth/token')).toBe(true)
      refreshCalls++
      return new Response(JSON.stringify({ access_token: 'fresh-access' }), { status: 200 })
    }))

    await drain(ctx)

    expect(refreshCalls).toBe(1)
  })

  it('shares one in-flight refresh across concurrent callers instead of spending the refresh token twice', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ALREADY_EXPIRED)
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    let refreshCalls = 0
    let resolveRefresh: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { resolveRefresh = resolve })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url.endsWith('/oauth/token')).toBe(true)
      refreshCalls++
      await gate
      return new Response(JSON.stringify({ access_token: 'fresh-access' }), { status: 200 })
    }))

    const first = drain(ctx)
    const second = drain(ctx)
    await new Promise(resolve => setTimeout(resolve, 10))
    resolveRefresh?.()
    await Promise.all([first, second])

    expect(refreshCalls).toBe(1)
  })

  it('adopts a fresh refresh token when the backend rotates it', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ALREADY_EXPIRED)
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url.endsWith('/oauth/token')).toBe(true)
      return new Response(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'rotated-refresh' }), { status: 200 })
    }))

    await drain(ctx)

    await expect(ctx.credentials.resolve(REFRESH_REF)).resolves.toMatchObject({ value: 'rotated-refresh' })
  })

  it('surfaces a failed refresh as an AUTH-coded LlmError', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ALREADY_EXPIRED)
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(url.endsWith('/oauth/token')).toBe(true)
      return new Response('nope', { status: 500 })
    }))

    expect(failureOf(await drain(ctx))).toMatchObject({ code: 'AUTH' })
  })

  it('streams with the stale access token when no refresh token is stored', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, ALREADY_EXPIRED)
    const captured = captureHttp2Headers()

    await drain(ctx)

    expect(captured.headers?.authorization).toBe(`Bearer ${ALREADY_EXPIRED}`)
  })

  it('uses a non-JWT access token as-is, never attempting a refresh', async () => {
    const ctx = await harness()
    await ctx.credentials.set(ACCESS_REF, 'crsr_opaque_value')
    await ctx.credentials.set(REFRESH_REF, 'old-refresh')
    let refreshCalls = 0
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/oauth/token')) { refreshCalls++; return new Response('{}', { status: 200 }) }
      throw new Error(`unexpected fetch: ${url}`)
    }))

    await drain(ctx)

    expect(refreshCalls).toBe(0)
  })

  it('discovers the configured catalog when live listing is unavailable', async () => {
    const ctx = await harness({
      models: [{ id: 'composer-2.5', name: 'Composer 2.5', contextWindow: 200_000, maxTokens: 32_768 }],
    })
    await expect(ctx.llm.discoverModels('llm-cursor', { provider: 'cursor' })).resolves.toEqual([
      { id: 'composer-2.5', name: 'Composer 2.5', contextWindow: 200_000, maxTokens: 32_768 },
    ])
  })
})
