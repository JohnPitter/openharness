import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  DuckDuckGoSearchProvider,
  DUCKDUCKGO_PROVIDER_ID,
  decodeHtmlText,
  mapDuckDuckGoHtml,
  parseDuckDuckGoHtml,
  unwrapDuckDuckGoHref,
} from '@deepseek-ai/dsh-web-search-duckduckgo'
import * as duckduckgoPlugin from '@deepseek-ai/dsh-web-search-duckduckgo'

const options = { baseURL: 'https://html.duckduckgo.test/html/' }

function htmlResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/html' }, ...init })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DuckDuckGo HTML mapping', () => {
  it('maps a titled result with a snippet', () => {
    expect(parseDuckDuckGoHtml(`
      <div class="result results_links">
        <a rel="nofollow" class="result__a" href="https://a.test/page">Alpha &amp; Title</a>
        <a class="result__snippet">Alpha <b>snippet</b></a>
      </div>
    `)).toEqual([{ url: 'https://a.test/page', title: 'Alpha & Title', snippet: 'Alpha snippet' }])
  })

  it('unwraps uddg redirect wrappers', () => {
    expect(unwrapDuckDuckGoHref('//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.test%2Fpath')).toBe('https://b.test/path')
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/l/?uddg=http%3A%2F%2Fc.test%2F')).toBe('http://c.test/')
  })

  it('drops ads and duckduckgo-hosted hrefs without uddg', () => {
    expect(parseDuckDuckGoHtml(`
      <div class="result results_links result--ad">
        <a class="result__a" href="https://sponsor.test">Ad</a>
      </div>
      <div class="result results_links">
        <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Tracker</a>
      </div>
      <div class="result results_links">
        <a class="result__a" href="https://kept.test">Kept</a>
      </div>
    `)).toEqual([{ url: 'https://kept.test', title: 'Kept' }])
  })

  it('drops a result__a without href and an empty snippet field', () => {
    expect(parseDuckDuckGoHtml(`
      <a class="result__a">No href</a>
      <a class="result__a" href="https://a.test">Kept</a>
      <a class="result__snippet">   </a>
    `)).toEqual([{ url: 'https://a.test', title: 'Kept' }])
  })

  it('drops a single-quoted ad block', () => {
    expect(parseDuckDuckGoHtml(`
      <div class='result results_links result--ad'>
        <a class="result__a" href="https://sponsor.test">Ad</a>
      </div>
      <div class='result results_links'>
        <a class="result__a" href="https://kept.test">Kept</a>
      </div>
    `)).toEqual([{ url: 'https://kept.test', title: 'Kept' }])
  })

  it('omits an empty title or snippet rather than emitting them', () => {
    expect(parseDuckDuckGoHtml(
      '<a class="result__a" href="https://a.test"></a>',
    )).toEqual([{ url: 'https://a.test' }])
  })

  it('deduplicates by unwrapped URL', () => {
    expect(parseDuckDuckGoHtml(`
      <a class="result__a" href="https://a.test">First</a>
      <a class="result__a" href="https://a.test">Second</a>
    `)).toEqual([{ url: 'https://a.test', title: 'First' }])
  })

  it('maps HTML to a result with no content', () => {
    expect(mapDuckDuckGoHtml('<a class="result__a" href="https://a.test">A</a>')).toEqual({
      sources: [{ url: 'https://a.test', title: 'A' }],
      truncated: false,
    })
    expect(mapDuckDuckGoHtml('').content).toBeUndefined()
  })

  it('strips tags and collapses whitespace in decodeHtmlText', () => {
    expect(decodeHtmlText('  Alpha<br> &quot;quoted&quot;  ')).toBe('Alpha "quoted"')
  })

  it('rejects a non-http href', () => {
    expect(unwrapDuckDuckGoHref('javascript:alert(1)')).toBeUndefined()
    expect(unwrapDuckDuckGoHref('')).toBeUndefined()
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/l/?uddg=not a url')).toBeUndefined()
    expect(unwrapDuckDuckGoHref('https://duckduckgo.com/l/?uddg=ftp%3A%2F%2Fx.test')).toBeUndefined()
    expect(unwrapDuckDuckGoHref('::::')).toBeUndefined()
  })
})

describe('DuckDuckGoSearchProvider availability', () => {
  it('is available with a parseable base URL', () => {
    expect(new DuckDuckGoSearchProvider(options).available()).toBe(true)
  })

  it('is misconfigured when the base URL is unparseable', () => {
    expect(new DuckDuckGoSearchProvider({ baseURL: 'not a url' }).available()).toBe(false)
  })
})

describe('DuckDuckGoSearchProvider request mapping', () => {
  it('POSTs q= and refuses redirects', async () => {
    const fetchMock = vi.fn(async () => htmlResponse('<a class="result__a" href="https://a.test">A</a>'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new DuckDuckGoSearchProvider(options).search({ query: 'hello world' })
    expect(result.sources).toEqual([{ url: 'https://a.test', title: 'A' }])
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://html.duckduckgo.test/html/')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(init.body).toBe('q=hello+world')
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(''))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new DuckDuckGoSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('DuckDuckGoSearchProvider error handling', () => {
  it('maps an HTTP error to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('nope', { status: 403 })))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({
        code: 'WEB_PROVIDER_ERROR',
        message: 'DuckDuckGo search error (HTTP 403)',
      }))
  })

  it('maps a network failure to WEB_PROVIDER_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('connection refused'))))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps an abort to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('surfaces an abort during body read as WEB_ABORTED', async () => {
    const body = { text: () => Promise.reject(new DOMException('aborted', 'AbortError')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('maps a non-abort body-read failure to WEB_PROVIDER_ERROR', async () => {
    const body = { text: () => Promise.reject(new TypeError('stream exploded')), ok: true, status: 200 }
    vi.stubGlobal('fetch', vi.fn(async () => body as unknown as Response))
    await expect(new DuckDuckGoSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

describe('web-search-duckduckgo plugin registration', () => {
  it('registers the provider into ctx.web (HMR-safe)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse('')))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
    const fiber = await ctx.plugin(duckduckgoPlugin, { baseURL: options.baseURL })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ sources: [], truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('has no default export (namespace plugin export shape)', () => {
    expect('default' in duckduckgoPlugin).toBe(false)
  })

  it('uses $DUCKDUCKGO_SEARCH_BASE_URL when config omits baseURL', async () => {
    const prev = process.env.DUCKDUCKGO_SEARCH_BASE_URL
    process.env.DUCKDUCKGO_SEARCH_BASE_URL = 'https://html.duckduckgo.env.test/html/'
    try {
      const fetchMock = vi.fn(async () => htmlResponse(''))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
      const fiber = await ctx.plugin(duckduckgoPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://html.duckduckgo.env.test/html/')
      await fiber.dispose()
    } finally {
      if (prev === undefined) delete process.env.DUCKDUCKGO_SEARCH_BASE_URL
      else process.env.DUCKDUCKGO_SEARCH_BASE_URL = prev
    }
  })

  it('falls back to the public HTML endpoint when config omits baseURL', async () => {
    const prev = process.env.DUCKDUCKGO_SEARCH_BASE_URL
    delete process.env.DUCKDUCKGO_SEARCH_BASE_URL
    try {
      const fetchMock = vi.fn(async () => htmlResponse(''))
      vi.stubGlobal('fetch', fetchMock)
      const ctx = new Context()
      await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
      const fiber = await ctx.plugin(duckduckgoPlugin, {})
      await ctx.web.search({ query: 'q' })
      const [url] = fetchMock.mock.calls[0] as unknown as [string]
      expect(url).toBe('https://html.duckduckgo.com/html/')
      await fiber.dispose()
    } finally {
      if (prev !== undefined) process.env.DUCKDUCKGO_SEARCH_BASE_URL = prev
    }
  })

  it('is unavailable when the configured base URL cannot be parsed', async () => {
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: DUCKDUCKGO_PROVIDER_ID })
    await ctx.plugin(duckduckgoPlugin, { baseURL: 'not a url' })
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })
})
