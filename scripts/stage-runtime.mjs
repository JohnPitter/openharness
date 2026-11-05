#!/usr/bin/env node
// Stage the embedded DeepSeek Harness runtime for the OpenHarness sidecar.
//
//   node scripts/stage-runtime.mjs [--skip-build] [--node <node.exe>] [--out <dir>]
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
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = join(repo, 'deepseek-harness')
const { values: opts } = parseArgs({
  options: {
    'skip-build': { type: 'boolean', default: false },
    node: { type: 'string' },
    out: { type: 'string', default: join(repo, 'dsh-runtime') },
    'no-smoke': { type: 'boolean', default: false },
    'no-zip': { type: 'boolean', default: false },
  },
})
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

/** Workspace package directories (vendor/*, packages/*/*, apps/web) keyed by package name. */
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
    '--filter', '@deepseek-ai/dsh', 'deploy', '--prod', '--legacy',
    '--config.allow-unused-patches=true',
    '--config.node-linker=hoisted',
    '--config.auto-install-peers=false',
    `--config.pnpmfile=${join(harness, 'scripts', 'python-runtime-deploy.pnpmfile.mjs')}`,
    '--config.link-workspace-packages=true',
    '--config.hoist-workspace-packages=false',
    out,
  ])
  const helper = join(harness, 'scripts', 'build-exe-for-python-sdk-staging.ts')
  const code = [
    `const m = await import(${JSON.stringify(new URL(`file:///${helper.replaceAll('\\', '/')}`).href)})`,
    `await m.materializeStagedLinks(${JSON.stringify(out)})`,
    `await m.deduplicateStagedWorkspacePackages(${JSON.stringify(out)}, ${JSON.stringify(harness)})`,
  ].join('\n')
  run(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: harness, shell: false })
}

async function overlay() {
  const modules = join(out, 'node_modules')
  const packages = await workspacePackages()
  let added = 0
  for (const [name, source] of packages) {
    const target = join(modules, ...name.split('/'))
    if (existsSync(join(target, 'package.json'))) continue
    if (!existsSync(join(source, 'lib')) && !existsSync(join(source, 'dist'))) continue
    await copyPackage(source, target)
    added++
  }
  log(`copied ${added} workspace package(s) the deploy left out`)
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
  const lsp = join(modules, '.bin', isWindows ? 'typescript-language-server.cmd' : 'typescript-language-server')
  if (!existsSync(lsp)) log(`warning: ${lsp} is missing; run scripts/stage-typescript-language-server.ps1`)
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
