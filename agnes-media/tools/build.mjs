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
import { statSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const PLUGIN_ID = 'agnes-media'

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
  await build({
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
  })
  console.log(`host   -> ${outfile} (${statSync(outfile).size} bytes)`)
}

async function buildClient() {
  const outfile = join(root, 'lib', 'client.js')
  await build({
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
  })
  console.log(`client -> ${outfile} (${statSync(outfile).size} bytes)`)
}

await buildHost()
await buildClient()
console.log('build OK')
