/**
 * Proves the exact LSP composition wired into the shipped agent presets
 * (`lsp` + `lsp-stdio` + `tool-lsp` under one `isolate: { lsp: true }` realm)
 * activates through the real Cordis Loader with real filesystem and
 * subprocess providers, and registers the model-facing `lsp` tool. Rows
 * reference the published package names, resolved by the Loader through
 * their built `lib/` output exactly as production boot does.
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot } from '@deepseek-ai/dsh-app-boot'

const EMPTY_CONFIG = fileURLToPath(new URL('./fixtures/empty.cordis.yml', import.meta.url))
// The pinned runtime dependency this app installs beside its own manifest.
const SERVER_BIN = fileURLToPath(new URL('../node_modules/.bin/typescript-language-server', import.meta.url))

let root: string
let ctx: Context

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-lsp-composition-')))
  await mkdir(join(root, 'proj'))
  await writeFile(join(root, 'proj', 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }))
  await writeFile(join(root, 'proj', 'greet.ts'), [
    'export function greet(name: string): string {',
    '  return `hello ${name}`',
    '}',
    '',
    'export const message = greet(\'world\')',
    '',
  ].join('\n'))

  const patches: PatchOptions[] = [{
    insert: [
      { id: 'fs', name: '@deepseek-ai/dsh-fs-local', config: { cwd: root } },
      { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
      { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: { persona: '' } },
      { id: 'tools', name: '@deepseek-ai/dsh-tools' },
      { id: 'lsp-service', name: '@deepseek-ai/dsh-lsp' },
      {
        id: 'lsp-stdio',
        name: '@deepseek-ai/dsh-lsp-stdio',
        config: {
          servers: {
            typescript: {
              command: SERVER_BIN,
              args: ['--stdio'],
              extensionToLanguage: { '.ts': 'typescript' },
            },
          },
        },
      },
      { id: 'tool-lsp', name: '@deepseek-ai/dsh-tool-lsp' },
    ],
  }]

  ctx = await boot('lsp-composition-test', EMPTY_CONFIG, patches)
}, 30_000)

afterAll(async () => {
  if (ctx) await ctx.fiber.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

describe('the shipped LSP composition', () => {
  it('registers the model-facing lsp tool', () => {
    expect(ctx.tools.schemas().some(schema => schema.name === 'lsp')).toBe(true)
  })
})
