/**
 * GET/HEAD /api/file: POSIX absolute paths through the composed filesystem.
 */

import { describe, expect, it, vi } from 'vitest'
import { FsError, FsTargetKey, FsVersion, type FsTarget } from '@deepseek-ai/dsh-fs'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { serveFile, type FileDisplayFs } from '../src/file-display.ts'

const TARGET: FsTarget = {
  targetKey: FsTargetKey('/tmp/graph.png'),
  displayPath: '/tmp/graph.png',
}

function fsStub(over: Partial<FileDisplayFs> = {}): FileDisplayFs {
  return {
    resolve: vi.fn(async () => TARGET),
    stat: vi.fn(async () => ({ type: 'file' as const, version: FsVersion('v1'), size: 4 })),
    readBytes: vi.fn(async () => new Uint8Array([1, 2, 3, 4])),
    ...over,
  }
}

describe('serveFile', () => {
  it('rejects a missing, relative, or protocol-relative path', async () => {
    const fs = fsStub()
    expect((await serveFile(new Request('http://host/api/file'), fs, 1024)).status).toBe(400)
    expect((await serveFile(new Request('http://host/api/file?path='), fs, 1024)).status).toBe(400)
    expect((await serveFile(new Request('http://host/api/file?path=relative.png'), fs, 1024)).status).toBe(400)
    expect((await serveFile(new Request('http://host/api/file?path=//cdn.example.com/x.png'), fs, 1024)).status).toBe(400)
    expect(fs.resolve).not.toHaveBeenCalled()
  })

  it('serves GET bytes and HEAD metadata for a POSIX absolute path', async () => {
    const fs = fsStub()
    const get = await serveFile(new Request('http://host/api/file?path=%2Ftmp%2Fgraph.png'), fs, 1024)
    expect(get.status).toBe(200)
    expect(get.headers.get('content-type')).toBe('image/png')
    expect(await get.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3, 4]).buffer)

    const head = await serveFile(
      new Request('http://host/api/file?path=/tmp/graph.png', { method: 'HEAD' }),
      fs,
      1024,
    )
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('4')
    expect(head.body).toBeNull()
  })

  it('maps FS_NOT_FOUND to 404', async () => {
    const fs = fsStub({
      resolve: async () => {
        throw new FsError('missing', 'FS_NOT_FOUND')
      },
    })
    const response = await serveFile(new Request('http://host/api/file?path=/tmp/missing.png'), fs, 1024)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('FS_NOT_FOUND')
  })
})

describe('toFetchHandler /api/file', () => {
  it('answers 404 when downloads.file is omitted', async () => {
    const { fetch } = toFetchHandler({
      downloads: {
        sessionLog: () => Promise.resolve(new Response(null, { status: 500 })),
      },
    } as unknown as ApiProxy)
    const response = await fetch(new Request('http://host/api/file?path=/tmp/graph.png'))
    expect(response.status).toBe(404)
  })

  it('routes GET and HEAD through downloads.file', async () => {
    const file = vi.fn(async (request: Request) => new Response(request.method, { status: 200 }))
    const { fetch } = toFetchHandler({
      downloads: {
        sessionLog: () => Promise.resolve(new Response(null, { status: 500 })),
        file,
      },
    } as unknown as ApiProxy)
    expect((await fetch(new Request('http://host/api/file?path=/tmp/graph.png'))).status).toBe(200)
    expect((await fetch(new Request('http://host/api/file?path=/tmp/graph.png', { method: 'HEAD' }))).status)
      .toBe(200)
    expect(file).toHaveBeenCalledTimes(2)
  })
})
