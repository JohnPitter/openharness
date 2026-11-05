#!/usr/bin/env node
// Stage the embedded DeepSeek Harness runtime for the OpenHarness sidecar.
//
//   node scripts/stage-runtime.mjs [--skip-build] [--node <node.exe>] [--out <dir>] [--harness <dir>]
//                                  [--no-smoke] [--no-zip]
//
// Steps (the manual pipeline in AGENTS.md, automated):
//  1. build deepseek-harness artifacts with the OpenHarness brand env
//  2. `pnpm deploy --prod` @deepseek-ai/dsh (apps/cli) into a hoisted tree
//  3. replace deploy links with real files and share workspace packages
//     (upstream helpers in scripts/build-exe-for-python-sdk-staging.ts)
//  4. copy workspace @deepseek-ai/* packages the deploy left out, refresh the
//     web frontend dist, and validate the staged package.json
//  5. smoke: boot `lib/bin.js web` from the staged tree and wait for its URL
//  6. zip into internal/sidecar/assets/dsh-runtime.zip (tools/zipruntime) and
//     copy --node to internal/sidecar/assets/node.exe
//
// Runs with the Node that runs this script (>= 24.9, the harness engine range).
import { spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { values: opts } = parseArgs({
  options: {
    harness: { type: 'string', default: join(repo, 'deepseek-harness') },
    'skip-build': { type: 'boolean', default: false },
    node: { type: 'string' },
    out: { type: 'string', default: join(repo, 'dsh-runtime') },
    'no-smoke': { type: 'boolean', default: false },
    'no-zip': { type: 'boolean', default: false },
  },
})
const harness = resolve(opts.harness)
const out = resolve(opts.out)
const isWindows = process.platform === 'win32'

function log(message) {
  console.log(`stage-runtime: ${message}`)
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} exited with ${String(result.status)}`)
}

const pnpm = (args, options) => run('pnpm', args, { cwd: harness, ...options })

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

// Workspace package directories (vendor/<pkg>, packages/<group>/<pkg>, apps/<app>) keyed by package name.
async function workspacePackages() {
  const found = new Map()
  const roots = [['vendor'], ['packages', '*'], ['apps']]
  for (const segments of roots) {
    const base = join(harness, segments[0])
    const groups = segments.length === 1 ? [base] : (await readdir(base, { withFileTypes: true }))
      .filter(entry => entry.isDirectory()).map(entry => join(base, entry.name))
    for (const group of groups) {
      for (const entry of await readdir(group, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const manifest = join(group, entry.name, 'package.json')
        if (!existsSync(manifest)) continue
        const { name } = await readJson(manifest)
        if (typeof name === 'string' && name.startsWith('@deepseek-ai/')) found.set(name, join(group, entry.name))
      }
    }
  }
  return found
}

// Package names under `name:` in the shipped bundle patches and preset patches.
async function composedPackageNames() {
  const names = new Set()
  const bundles = join(harness, 'packages', 'bundle')
  for (const bundle of await readdir(bundles, { withFileTypes: true })) {
    if (!bundle.isDirectory()) continue
    const files = [join(bundles, bundle.name, 'cordis.patch.yml')]
    const presets = join(bundles, bundle.name, 'presets')
    if (existsSync(presets)) {
      for (const file of await readdir(presets)) if (file.endsWith('.yml')) files.push(join(presets, file))
    }
    for (const file of files) {
      if (!existsSync(file)) continue
      for (const match of (await readFile(file, 'utf8')).matchAll(/name:\s*['"]?(@deepseek-ai\/[a-z0-9-]+)/g)) names.add(match[1])
    }
  }
  return names
}

const SKIP_DIRS = new Set(['node_modules', 'tests', 'test', 'src', '.turbo', 'coverage', 'snapshots'])

async function copyPackage(source, target) {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
    await cp(join(source, entry.name), join(target, entry.name), { recursive: true, dereference: true })
  }
}

async function build() {
  if (opts['skip-build']) {
    log('skipping build (--skip-build)')
    return
  }
  const env = { ...process.env, DSH_CLIENT_BUILD_PROFILE: 'official', DSH_CLIENT_TITLE: 'OpenHarness' }
  pnpm(['install', '--frozen-lockfile'], { env })
  pnpm(['run', 'build:artifacts'], { env })
}

async function deploy() {
  await rm(out, { recursive: true, force: true })
  pnpm([
    '--filter', '@deepseek-ai/dsh', 'deploy', '--prod',
    '--config.allow-unused-patches=true',
    '--config.node-linker=hoisted',
    `--config.pnpmfile=${join(harness, 'scripts', 'python-runtime-deploy.pnpmfile.mjs')}`,
    '--config.link-workspace-packages=true',
    '--config.hoist-workspace-packages=false',
    out,
  ])
  const helper = join(harness, 'scripts', 'build-exe-for-python-sdk-staging.ts')
  const code = [
    `const m = await import(${JSON.stringify(new URL(`file:///${helper.replaceAll('\\', '/')}`).href)})`,
    `await m.materializeStagedLinks(${JSON.stringify(out)})`,
    `await m.deduplicateStagedWorkspacePackages(${JSON.stringify(out)}, ${JSON.stringify(out)})`,
  ].join('\n')
  run(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: harness, shell: false })
}

async function overlay() {
  const modules = join(out, 'node_modules')
  const packages = await workspacePackages()
  // Plugins the shipped composition names (bundles and their presets) load by
  // name at runtime; copy any the deploy closure left out, plus the workspace
  // packages they depend on in turn.
  // The deploy closure omits workspace peer dependencies; close over those too.
  const queue = [...await composedPackageNames()]
  for (const entry of await readdir(join(modules, '@deepseek-ai'), { withFileTypes: true })) {
    const manifestPath = join(modules, '@deepseek-ai', entry.name, 'package.json')
    if (!entry.isDirectory() || !existsSync(manifestPath)) continue
    const manifest = await readJson(manifestPath)
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (packages.has(dep)) queue.push(dep)
    }
  }
  const added = []
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    const target = join(modules, ...name.split('/'))
    if (existsSync(join(target, 'package.json'))) continue
    const source = packages.get(name)
    if (source === undefined) throw new Error(`composition names ${name}, which is not a workspace package`)
    await copyPackage(source, target)
    added.push(name)
    const manifest = await readJson(join(source, 'package.json'))
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) {
      if (packages.has(dep)) queue.push(dep)
    }
  }
  log(added.length === 0
    ? 'the deploy closure already holds every composed plugin'
    : `copied ${added.length} composed workspace package(s) the deploy left out: ${added.join(', ')}`)
  const webDist = join(harness, 'apps', 'web', 'dist')
  const webTarget = join(modules, '@deepseek-ai', 'dsh-web-frontend', 'dist')
  if (!existsSync(join(webDist, 'index.html'))) throw new Error(`missing ${webDist}; build the web frontend first`)
  await rm(webTarget, { recursive: true, force: true })
  await cp(webDist, webTarget, { recursive: true })
  const manifestPath = join(out, 'package.json')
  try {
    await readJson(manifestPath)
  } catch {
    // pnpm deploy --prod can strip devDependencies and leave a trailing comma.
    const repaired = (await readFile(manifestPath, 'utf8')).replace(/,(\s*[}\]])/g, '$1')
    JSON.parse(repaired)
    await writeFile(manifestPath, repaired)
    log('repaired a trailing comma in the staged package.json')
  }
  for (const required of [join(out, 'lib', 'bin.js'), join(webTarget, 'index.html')]) {
    if (!existsSync(required)) throw new Error(`staged runtime is missing ${required}`)
  }
  await writeLspShims(modules)
  await verifyDependencies(modules)
}

// Preset plugins load only when a session starts, after the boot smoke; check
// that every staged @deepseek-ai package's runtime dependencies resolve.
async function verifyDependencies(modules) {
  const scope = join(modules, '@deepseek-ai')
  const missing = []
  for (const entry of await readdir(scope, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(scope, entry.name)
    const manifest = await readJson(join(dir, 'package.json'))
    const require = createRequire(join(dir, 'package.json'))
    const optional = new Set(Object.keys(manifest.optionalDependencies ?? {}))
    for (const [dep, meta] of Object.entries(manifest.peerDependenciesMeta ?? {})) if (meta?.optional) optional.add(dep)
    for (const dep of new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})])) {
      if (optional.has(dep)) continue
      try {
        require.resolve(`${dep}/package.json`)
      } catch {
        // Packages whose exports hide package.json still count when their directory exists.
        if (!existsSync(join(modules, ...dep.split('/'), 'package.json'))) missing.push(`${manifest.name} -> ${dep}`)
      }
    }
  }
  if (missing.length > 0) throw new Error(`unresolved runtime dependencies:\n  ${missing.join('\n  ')}`)
  log('every staged @deepseek-ai package resolves its runtime dependencies')
}

// lsp-stdio resolves `typescript-language-server` on PATH when a preset mounts;
// the sidecar puts node_modules/.bin first on PATH. pnpm's own shims point into
// the build machine's store, so write relocatable ones that run the staged CLI
// with the embedded node.exe (runtime/node.exe, three levels above .bin).
async function writeLspShims(modules) {
  for (const required of ['typescript-language-server/lib/cli.mjs', 'typescript/package.json']) {
    if (!existsSync(join(modules, ...required.split('/')))) {
      throw new Error(`staged runtime is missing node_modules/${required}; apps/cli must depend on it`)
    }
  }
  const bin = join(modules, '.bin')
  await mkdir(bin, { recursive: true })
  await writeFile(join(bin, 'typescript-language-server.cmd'), [
    '@ECHO off',
    'SETLOCAL',
    'SET "_node=%~dp0..\\..\\..\\node.exe"',
    'IF NOT EXIST "%_node%" SET "_node=node"',
    '"%_node%" "%~dp0..\\typescript-language-server\\lib\\cli.mjs" %*',
    '',
  ].join('\r\n'))
  const sh = join(bin, 'typescript-language-server')
  await writeFile(sh, [
    '#!/bin/sh',
    'dir=$(dirname "$0")',
    'node_bin="$dir/../../../node.exe"',
    '[ -x "$node_bin" ] || node_bin=node',
    'exec "$node_bin" "$dir/../typescript-language-server/lib/cli.mjs" "$@"',
    '',
  ].join('\n'), { mode: 0o755 })
  log('wrote node_modules/.bin/typescript-language-server shims')
}

async function smoke() {
  if (opts['no-smoke']) return
  const home = await mkdtemp(join(tmpdir(), 'openharness-smoke-'))
  log(`smoke: booting the staged runtime (DSH_HOME=${home})`)
  const child = spawn(process.execPath, [join(out, 'lib', 'bin.js'), 'web', '--no-open', '--host', '127.0.0.1', '--port', '0'], {
    cwd: out, env: { ...process.env, DSH_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000) })
  try {
    await new Promise((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error(`smoke: no URL within 120s\n${stderr}`)), 120_000)
      let buffered = ''
      child.stdout.on('data', (chunk) => {
        buffered += chunk
        const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(buffered)
        if (match) {
          clearTimeout(timer)
          log(`smoke: harness answered at ${match[1].replace(/token=[^&\s]+/, 'token=…')}`)
          resolveUrl(match[1])
        }
      })
      child.once('exit', (code) => {
        clearTimeout(timer)
        reject(new Error(`smoke: harness exited (${String(code)}) before announcing a URL\n${stderr}`))
      })
    })
  } finally {
    child.kill()
    await rm(home, { recursive: true, force: true }).catch(() => {})
  }
}

async function pack() {
  if (opts['no-zip']) return
  const assets = join(repo, 'internal', 'sidecar', 'assets')
  await mkdir(assets, { recursive: true })
  run('go', ['run', './tools/zipruntime', '-src', out, '-dst', join(assets, 'dsh-runtime.zip')], { cwd: repo, shell: false })
  if (opts.node !== undefined) {
    await cp(resolve(opts.node), join(assets, 'node.exe'))
    log(`copied ${opts.node} -> internal/sidecar/assets/node.exe`)
  } else if (!existsSync(join(assets, 'node.exe'))) {
    log('warning: internal/sidecar/assets/node.exe is missing; pass --node <path to node.exe>')
  }
  const { size } = await stat(join(assets, 'dsh-runtime.zip'))
  log(`wrote internal/sidecar/assets/dsh-runtime.zip (${(size / 1048576).toFixed(1)} MiB)`)
}

await build()
await deploy()
await overlay()
await smoke()
await pack()
log('done')
