import { defineConfig } from 'tsdown'

/** Host adapter bundle: plain node ESM entries, external workspace/runtime deps. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: ['@cursor/sdk', 'protobufjs'],
})
