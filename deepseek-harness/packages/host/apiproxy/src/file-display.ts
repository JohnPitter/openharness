/**
 * Authenticated GET/HEAD /api/file reads bounded file responses through
 * the composed filesystem provider. Paths and MIME types do not restrict access;
 * the webserver authenticates `/api` before this handler.
 * @module @deepseek-ai/dsh-host-apiproxy/file-display
 */

import { extname } from 'node:path'
import { FsError, type FileSystem } from '@deepseek-ai/dsh-fs'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // HTML and SVG files may be opened directly on the authenticated API origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
} as const

/** Extension → MIME for common image types; anything else is octet-stream. */
const MIME_BY_EXT: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

/** Filesystem methods the file-display GET uses. */
export type FileDisplayFs = Pick<FileSystem, 'resolve' | 'stat' | 'readBytes'>

/**
 * POSIX absolute path the assistant-markdown vocabulary will request.
 * Node `path.isAbsolute` on Windows rejects `/tmp/...`, so this check is
 * independent of the host platform.
 */
function isPosixAbsolutePath(path: string): boolean {
  return path.length > 0 && !path.includes('\0') && path.startsWith('/') && !path.startsWith('//')
}

function mediaTypeOf(displayPath: string): string {
  return MIME_BY_EXT[extname(displayPath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Serve one regular file for an authenticated GET/HEAD `/api/file?path=`.
 * @param request - the inbound GET or HEAD.
 * @param fs - composed filesystem provider.
 * @param maxBytes - inclusive byte cap from attachment image limits.
 * @returns the file bytes or a status-only failure.
 */
export async function serveFile(request: Request, fs: FileDisplayFs, maxBytes: number): Promise<Response> {
  const fail = (status: number, text: string): Response =>
    new Response(request.method === 'HEAD' ? null : text, { status, headers: BASE_HEADERS })
  const path = new URL(request.url).searchParams.get('path')
  if (path === null || path.length === 0) return fail(400, 'missing path')
  if (!isPosixAbsolutePath(path)) return fail(400, 'absolute path required')
  try {
    const target = await fs.resolve(path, { signal: request.signal })
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Content-Type': mediaTypeOf(target.displayPath),
    }
    if (request.method === 'HEAD') {
      const info = await fs.stat(target, request.signal)
      if (info === undefined) return fail(404, 'not found')
      if (info.type !== 'file') return fail(403, 'not a regular file')
      if (info.size !== undefined) {
        if (info.size > maxBytes) return fail(413, 'file exceeds byte limit')
        headers['Content-Length'] = String(info.size)
      }
      return new Response(null, { headers })
    }
    const bytes = await fs.readBytes(target, request.signal, maxBytes)
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes.slice(), { headers })
  } catch (error: unknown) {
    if (!(error instanceof FsError)) throw error
    const statuses: Partial<Record<FsError['code'], number>> = {
      FS_NOT_FOUND: 404,
      FS_NOT_REGULAR_FILE: 403,
      FS_PERMISSION_DENIED: 403,
      FS_SANDBOX_DENIED: 403,
      FS_TOO_LARGE: 413,
      FS_ABORTED: 499,
    }
    return fail(statuses[error.code] ?? 500, error.code)
  }
}
