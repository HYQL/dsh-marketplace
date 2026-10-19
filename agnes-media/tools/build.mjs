/**
 * Build both halves with esbuild.
 *
 *   host   → lib/host.js   (ESM, node, external @deepseek-ai/*, node:*)
 *   client → lib/client.js (CJS wrapped in the DSH lazy-loader contract)
 *
 * Usage: node tools/build.mjs
 */

import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statSync, writeFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PLUGIN_ID = 'agnes-media'

/**
 * Build with the in-memory result, rewriting the build location out of the
 * output before writing it.
 *
 * esbuild writes each bundled CommonJS module's path as a `//` comment and as
 * the wrapper's key. Relative to the working directory, those paths differ
 * with the *install location* — the same `src/` produced
 * `../../../local-plugins/agnes-media/...` from one checkout and
 * `../../../workspace/dsh-marketplace/agnes-media/...` from another — so every
 * rebuild rewrote 150+ lines of `lib/host.js` and showed up as a change even
 * though the code was identical. Naming them `extern:<module>` makes the
 * committed `lib/` reproducible from any directory.
 */
function rewritePaths(text) {
  return text
    .replace(/(?<=^\/\/ )\S+(node_modules\/\S+)$/gm, 'extern:$1')
    .replace(/(?<=^ {2}")\S+(node_modules\/\S+)(?="\(exports\) \{)/gm, 'extern:$1')
}

/** Run one esbuild bundle in memory and write the rewritten sources. */
async function bundle(options, outfile) {
  const result = await build({ ...options, absWorkingDir: root, write: false })
  for (const out of result.outputFiles) {
    const body = out.path.endsWith('.map') ? out.text : rewritePaths(out.text)
    writeFileSync(out.path, body)
  }
  return statSync(outfile)
}

const SHARED_EXTERNAL = [
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/schemastery',
]

/**
 * Only modules the browser module table actually provides. Everything else is
 * bundled: a `require()` of a module the loader does not know throws at
 * activation and blanks the slot.
 */
const CLIENT_EXTERNAL = [
  'react',
  'react/jsx-runtime',
]

async function buildHost() {
  const outfile = join(root, 'lib', 'host.js')
  const stat = await bundle({
    entryPoints: [join(root, 'src', 'host.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: [...SHARED_EXTERNAL, 'node:*'],
    sourcemap: true,
    // Some bundled deps (yaml) emit require() for node builtins; an ESM banner
    // that exposes createRequire keeps those resolvable.
    banner: {
      js: "import { createRequire as __cr } from 'node:module';\nconst require = __cr(import.meta.url);\n",
    },
  }, outfile)
  console.log(`host   -> ${outfile} (${stat.size} bytes)`)
}

async function buildClient() {
  const outfile = join(root, 'lib', 'client.js')
  const stat = await bundle({
    entryPoints: [join(root, 'src', 'client', 'index.tsx')],
    outfile,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: ['chrome110', 'firefox110', 'safari16'],
    external: CLIENT_EXTERNAL,
    sourcemap: true,
    jsx: 'automatic',
    jsxImportSource: 'react',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    banner: {
      js:
        `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {\n` +
        'var module = { exports: {} }; var exports = module.exports;',
    },
    footer: { js: 'return module.exports; } });' },
  }, outfile)
  console.log(`client -> ${outfile} (${stat.size} bytes)`)
}

await buildHost()
await buildClient()
console.log('build OK')
