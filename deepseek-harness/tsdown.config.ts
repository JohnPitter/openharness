import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

const HOST_ENTRY_GLOB = 'lib/types/{index,invariant,startup}.js'
const HOST_ENTRY_FILES = ['lib/types/index.js', 'lib/types/invariant.js', 'lib/types/startup.js'] as const

/** Expand the Host brace glob against files that actually exist in this package. */
function expandHostEntries(cwd: string): string[] {
  const found = HOST_ENTRY_FILES.filter((rel) => existsSync(resolve(cwd, rel)))
  return found.length > 0 ? [...found] : [resolve(import.meta.dirname, 'scripts/tsdown-root-stub.js')]
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    entry: client ? '' : HOST_ENTRY_GLOB,
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [
      typertPlugin({ mode: 'workspace', faces: ['host'] }),
      {
        name: 'openharness-expand-host-entries',
        tsdownConfig(config) {
          if (config.entry !== HOST_ENTRY_GLOB && !(Array.isArray(config.entry) && config.entry[0] === HOST_ENTRY_GLOB)) {
            return
          }
          return { entry: expandHostEntries(config.cwd ?? process.cwd()) }
        },
      },
    ],
  }
})
