import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  calendarDate,
  createUsageFold,
  emptyUsageBuckets,
  ingestSessionEvent,
  snapshotUsageFold,
  UsagePanelLedger,
  usageModelKey,
  usageTokenTotal,
} from '../src/usage-panel.ts'

const time = Date.parse('2026-08-25T15:00:00')

function header(seq: number, provider: string, model: string, at = time): SessionEvent {
  return {
    type: 'request/header',
    seq,
    time: at,
    data: {
      header: { config: { provider, model } },
      reason: 'initial',
    },
  }
}

function chunk(
  seq: number,
  turn: number,
  step: number,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number },
  at = time,
): SessionEvent {
  return {
    type: 'assistant/chunk',
    seq,
    time: at,
    data: { turn, step, chunk: { type: 'usage', usage } },
  }
}

function message(
  seq: number,
  turn: number,
  step: number,
  usage: { inputTokens: number; outputTokens: number },
  at = time,
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: at,
    data: {
      turn,
      step,
      message: createMessage({
        role: 'assistant',
        content: [],
        source: { kind: 'model', provider: 'mock', model: 'mock' },
      }),
      usage,
    },
  }
}

function other(seq: number): SessionEvent {
  return { type: 'turn/start', seq, time, data: { turn: 1 } }
}

describe('usage fold', () => {
  it('attributes a new step to the latest request header and increments requests once', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', header(0, 'kimi-for-coding', 'kimi-for-coding'))
    ingestSessionEvent(state, 's1', chunk(1, 1, 1, { inputTokens: 10, outputTokens: 4, cacheReadTokens: 2, cacheWriteTokens: 1 }))
    const view = snapshotUsageFold(state)
    expect(view.totals).toEqual({
      requests: 1,
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    })
    expect(view.days).toEqual([{
      date: calendarDate(time),
      requests: 1,
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    }])
    expect(view.models).toEqual([{
      provider: 'kimi-for-coding',
      model: 'kimi-for-coding',
      requests: 1,
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    }])
    expect(usageTokenTotal(view.totals)).toBe(17)
    expect(usageModelKey('kimi-for-coding', 'kimi-for-coding')).toBe(JSON.stringify(['kimi-for-coding', 'kimi-for-coding']))
  })

  it('replaces the same turn/step instead of double counting requests', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', header(0, 'p', 'm'))
    ingestSessionEvent(state, 's1', chunk(1, 1, 1, { inputTokens: 10, outputTokens: 1 }))
    ingestSessionEvent(state, 's1', message(2, 1, 1, { inputTokens: 12, outputTokens: 8 }))
    expect(snapshotUsageFold(state).totals).toEqual({
      requests: 1,
      inputTokens: 12,
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it('skips an identical replacement sample', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', header(0, 'p', 'm'))
    const usage = { inputTokens: 3, outputTokens: 1 }
    ingestSessionEvent(state, 's1', chunk(1, 1, 1, usage))
    ingestSessionEvent(state, 's1', message(2, 1, 1, usage))
    expect(snapshotUsageFold(state).totals.requests).toBe(1)
    expect(snapshotUsageFold(state).totals.inputTokens).toBe(3)
  })

  it('skips events at or behind the session watermark', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', header(2, 'p', 'm'))
    expect(ingestSessionEvent(state, 's1', header(2, 'other', 'x'))).toBe(false)
    expect(ingestSessionEvent(state, 's1', header(1, 'other', 'x'))).toBe(false)
  })

  it('credits unknown/unknown when usage arrives before a header', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', chunk(0, 1, 1, { inputTokens: 5, outputTokens: 1 }))
    expect(snapshotUsageFold(state).models[0]).toMatchObject({ provider: 'unknown', model: 'unknown', inputTokens: 5 })
  })

  it('splits days and models, and ignores non-usage events besides advancing seq', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', other(0))
    ingestSessionEvent(state, 's1', header(1, 'a', 'one'))
    ingestSessionEvent(state, 's1', chunk(2, 1, 1, { inputTokens: 4, outputTokens: 1 }, time))
    ingestSessionEvent(state, 's1', header(3, 'b', 'two'))
    ingestSessionEvent(state, 's1', chunk(4, 1, 2, { inputTokens: 20, outputTokens: 2 }, time + 86_400_000))
    const view = snapshotUsageFold(state)
    expect(view.days).toHaveLength(2)
    expect(view.days[0]?.date).toBe(calendarDate(time + 86_400_000))
    expect(view.models.map(row => row.model)).toEqual(['two', 'one'])
    expect(view.totals.requests).toBe(2)
  })

  it('drops a day row when a replacement subtracts it to empty', () => {
    const state = createUsageFold()
    ingestSessionEvent(state, 's1', header(0, 'p', 'm'))
    ingestSessionEvent(state, 's1', chunk(1, 1, 1, { inputTokens: 0, outputTokens: 0 }))
    expect(snapshotUsageFold(state).days).toEqual([])
    ingestSessionEvent(state, 's1', chunk(2, 1, 1, { inputTokens: 9, outputTokens: 0 }))
    ingestSessionEvent(state, 's1', message(3, 1, 1, { inputTokens: 0, outputTokens: 0 }))
    expect(snapshotUsageFold(state).days).toEqual([])
    ingestSessionEvent(state, 's1', message(4, 1, 1, { inputTokens: 2, outputTokens: 0 }))
    expect(snapshotUsageFold(state).totals.inputTokens).toBe(2)
  })

  it('breaks model ties by request count and skips a debit whose row is already gone', () => {
    const state = createUsageFold()
    state.models.set(usageModelKey('a', 'one'), {
      requests: 1, inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
    state.models.set(usageModelKey('b', 'two'), {
      requests: 2, inputTokens: 10, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    })
    expect(snapshotUsageFold(state).models.map(row => row.model)).toEqual(['two', 'one'])
    ingestSessionEvent(state, 's1', header(0, 'p', 'm'))
    ingestSessionEvent(state, 's1', chunk(1, 1, 1, { inputTokens: 4, outputTokens: 0 }))
    state.days.clear()
    state.models.delete(usageModelKey('p', 'm'))
    ingestSessionEvent(state, 's1', message(2, 1, 1, { inputTokens: 5, outputTokens: 0 }))
    expect(snapshotUsageFold(state).totals.inputTokens).toBe(5)
  })
})

describe('UsagePanelLedger', () => {
  const dirs: string[] = []

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'usage-panel-'))
    dirs.push(dir)
    return dir
  }

  it('buffers live events until backfill finishes, then persists', async () => {
    const dir = await tempDir()
    const path = join(dir, 'usage-panel.json')
    let resolveList!: (headers: SessionHeader[]) => void
    const listed = new Promise<SessionHeader[]>(resolve => { resolveList = resolve })
    const ledger = new UsagePanelLedger({
      path,
      persistence: {
        list: () => listed,
        inspect: async () => ({ meta: { id: 'cold' as SessionId } as SessionHeader, events: [] }),
      },
    })
    ledger.ingestEvent('live', header(0, 'kimi-for-coding', 'k3'))
    ledger.ingestEvent('live', header(0, 'kimi-for-coding', 'k3'))
    ledger.ingestEvent('live', chunk(1, 1, 1, { inputTokens: 8, outputTokens: 2 }))
    ledger.ingestEvent('header-only', header(0, 'p', 'm'))
    resolveList([])
    await ledger.ready()
    expect(snapshotUsageFold(createUsageFold())).toEqual({ days: [], models: [], totals: emptyUsageBuckets() })
    expect(ledger.snapshot().totals.inputTokens).toBe(8)
    const raw = JSON.parse(await readFile(path, 'utf8')) as { version: number; days: Record<string, { inputTokens: number }> }
    expect(raw.version).toBe(1)
    expect(Object.values(raw.days)[0]?.inputTokens).toBe(8)
  })

  it('backfills logs, skips an unreadable session, and reloads from disk without the logs', async () => {
    const dir = await tempDir()
    const path = join(dir, 'usage-panel.json')
    const events = [
      header(0, 'deepseek-official', 'deepseek-v4-flash'),
      chunk(1, 1, 1, { inputTokens: 30, outputTokens: 5 }),
    ]
    const first = new UsagePanelLedger({
      path,
      persistence: {
        list: async () => [
          { id: 'ok' as SessionId } as SessionHeader,
          { id: 'bad' as SessionId } as SessionHeader,
        ],
        inspect: async (id) => {
          if (String(id) === 'bad') throw new Error('corrupt log')
          return { meta: { id } as SessionHeader, events }
        },
      },
    })
    await first.ready()
    expect(first.snapshot().totals.inputTokens).toBe(30)

    const reloaded = new UsagePanelLedger({
      path,
      persistence: {
        list: async () => { throw new Error('listing failed') },
        inspect: async () => ({ meta: { id: 'x' as SessionId } as SessionHeader, events: [] }),
      },
    })
    await reloaded.ready()
    expect(reloaded.snapshot().totals.inputTokens).toBe(30)
  })

  it('skips inspect events behind a restored watermark and restores sparse files', async () => {
    const dir = await tempDir()
    const path = join(dir, 'usage-panel.json')
    await writeFile(path, `${JSON.stringify({
      version: 1,
      sessions: {
        s: { lastSeq: 5, provider: 'p', model: 'm' },
        skipProvider: { lastSeq: 1, provider: 1, model: 'm' },
        skipModel: { lastSeq: 1, provider: 'p', model: 1 },
      },
    })}\n`, 'utf8')
    const ledger = new UsagePanelLedger({
      path,
      persistence: {
        list: async () => [{ id: 's' as SessionId } as SessionHeader],
        inspect: async () => ({
          meta: { id: 's' as SessionId } as SessionHeader,
          events: [
            header(1, 'p', 'm'),
            chunk(2, 1, 1, { inputTokens: 9, outputTokens: 0 }),
          ],
        }),
      },
    })
    await ledger.ready()
    expect(ledger.snapshot().totals.inputTokens).toBe(0)
  })

  it('replaces a restored last sample whose day row is gone', async () => {
    const dir = await tempDir()
    const path = join(dir, 'usage-panel.json')
    await writeFile(path, `${JSON.stringify({
      version: 1,
      days: {},
      models: {},
      sessions: {
        s: {
          lastSeq: 1,
          provider: 'p',
          model: 'm',
          last: {
            turn: 1,
            step: 1,
            date: '1999-01-01',
            modelKey: JSON.stringify(['p', 'm']),
            buckets: { requests: 0, inputTokens: 3, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          },
        },
      },
    })}\n`, 'utf8')
    const ledger = new UsagePanelLedger({ path })
    await ledger.ready()
    ledger.ingestEvent('s', chunk(2, 1, 1, { inputTokens: 7, outputTokens: 0 }))
    expect(ledger.snapshot().totals.inputTokens).toBe(7)
  })

  it('discards a corrupt or version-mismatched file and treats a missing file as empty', async () => {
    const dir = await tempDir()
    const corrupt = join(dir, 'corrupt.json')
    await writeFile(corrupt, '{not json', 'utf8')
    const fromCorrupt = new UsagePanelLedger({ path: corrupt })
    await fromCorrupt.ready()
    expect(fromCorrupt.snapshot().totals).toEqual(emptyUsageBuckets())

    const emptyKeys = join(dir, 'empty-keys.json')
    await writeFile(emptyKeys, `${JSON.stringify({ version: 1 })}\n`, 'utf8')
    const fromEmptyKeys = new UsagePanelLedger({ path: emptyKeys })
    await fromEmptyKeys.ready()
    expect(fromEmptyKeys.snapshot().days).toEqual([])

    const stale = join(dir, 'stale.json')
    await writeFile(stale, `${JSON.stringify({
      version: 2,
      days: { '2026-01-01': { ...emptyUsageBuckets(), inputTokens: 99 } },
      models: {},
      sessions: {},
    })}\n`, 'utf8')
    const fromStale = new UsagePanelLedger({ path: stale })
    await fromStale.ready()
    expect(fromStale.snapshot().totals.inputTokens).toBe(0)

    const missing = new UsagePanelLedger({ path: join(dir, 'missing', 'usage-panel.json') })
    await missing.ready()
    expect(missing.snapshot().days).toEqual([])
  })

  it('restores a file with a corrupt model key and skips a malformed session tracker', async () => {
    const dir = await tempDir()
    const path = join(dir, 'usage-panel.json')
    await writeFile(path, `${JSON.stringify({
      version: 1,
      days: {
        '2026-08-25': { requests: 1, inputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        'nope': { requests: 'x' },
        'null-day': null,
        'num-day': 3,
      },
      models: {
        nope: { requests: 1, inputTokens: 4, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        '{': { requests: 1, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        bad: { requests: 'x' },
      },
      sessions: {
        good: { lastSeq: 3, provider: 'p', model: 'm' },
        bad: { lastSeq: 'x' },
      },
    })}\n`, 'utf8')
    const ledger = new UsagePanelLedger({ path })
    await ledger.ready()
    expect(ledger.snapshot().models[0]).toMatchObject({ provider: 'unknown', model: 'unknown', inputTokens: 4 })
    ledger.ingestEvent('good', chunk(3, 1, 1, { inputTokens: 9, outputTokens: 1 }))
    expect(ledger.snapshot().totals.inputTokens).toBe(4)
    ledger.ingestEvent('good', chunk(4, 1, 1, { inputTokens: 9, outputTokens: 1 }))
    expect(ledger.snapshot().totals.inputTokens).toBe(13)
  })

  it('ignores a non-object JSON document and process-local mode never writes', async () => {
    const dir = await tempDir()
    const path = join(dir, 'null.json')
    await writeFile(path, 'null\n', 'utf8')
    const fromNull = new UsagePanelLedger({ path })
    await fromNull.ready()
    expect(fromNull.snapshot().days).toEqual([])

    const memory = new UsagePanelLedger()
    memory.ingestEvent('s', header(0, 'p', 'm'))
    memory.ingestEvent('s', chunk(1, 1, 1, { inputTokens: 1, outputTokens: 0 }))
    await memory.ready()
    expect(memory.snapshot().totals.inputTokens).toBe(1)
  })
})
