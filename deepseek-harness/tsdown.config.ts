import { existsSync, globSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'
import { decoratorPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'
import { workspacePackageGlobs } from './scripts/workspace-package-globs.ts'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

// OpenHarness: tsdown on Windows does not expand the brace glob below, so the
// overlay plugin swaps it for the entry files that exist in each package.
const HOST_ENTRY_GLOB = 'lib/types/{index,startup}.js'
const HOST_ENTRY_FILES = ['lib/types/index.js', 'lib/types/startup.js'] as const

/** Expand the Host brace glob against files that actually exist in this package. */
function expandHostEntries(cwd: string): string[] {
  const found = HOST_ENTRY_FILES.filter((rel) => existsSync(resolve(cwd, rel)))
  return found.length > 0 ? [...found] : [resolve(import.meta.dirname, 'scripts/tsdown-root-stub.js')]
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project after source-only Typert generation. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact. `apps/desktop` bundles after
 * this pass (root package.json `build:lib:host`): its main bundle inlines
 * workspace devDependencies from their lib/ output, and tsdown builds
 * workspace members concurrently without ordering them.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  const packages = workspacePackageGlobs(globSync(['vendor/*/package.json', 'packages/*/*/package.json'], { cwd: import.meta.dirname }))
  return {
    workspace: [...packages, 'apps/cli', ...client ? [] : ['apps/desktop-host']],
    entry: client ? '' : [HOST_ENTRY_GLOB],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [
      decoratorPlugin(),
      {
        name: 'openharness-expand-host-entries',
        tsdownConfig(config: { entry?: unknown, cwd?: string }) {
          const entry = config.entry
          if (entry !== HOST_ENTRY_GLOB && !(Array.isArray(entry) && entry[0] === HOST_ENTRY_GLOB)) return
          return { entry: expandHostEntries(config.cwd ?? process.cwd()) }
        },
      },
    ],
  }
})
