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
 * Name every bundled module's path by where it lives in the package.
 *
 * esbuild writes each module's path relative to the working directory, as a
 * `//` comment and as the CJS wrapper key, so the output depended on where the
 * package happened to sit: `../../../local-plugins/agnes-media/node_modules/…`
 * from one checkout, `../../../workspace/dsh-marketplace/agnes-media/…` from
 * another, `node_modules/…` when deps were local. Same `src/`, three different
 * `lib/host.js`. Normalising to `extern:<module>` makes the committed bundle
 * reproducible from any directory and keeps build-machine paths out of it.
 */
function rewritePaths(text) {
  return text
    // `// ../../x/node_modules/yaml/dist/visit.js` and `// node_modules/yaml/…`
    .replace(/(?<=^\/\/ )(?:[^\n]*?\/)?(node_modules\/[^\n]+)$/gm, 'extern:$1')
    // The same path as a CJS wrapper key: `  "../../x/node_modules/yaml/…"(exports) {`
    .replace(/(?<=^ {2}")(?:[^"\n]*?\/)?(node_modules\/[^"\n]+)(?="\(exports\) \{)/gm, 'extern:$1')
}

/**
 * The same normalisation for the sourcemap's `sources` list.
 *
 * A map is only useful to a debugger when its entries resolve, so entries are
 * kept relative to the map's own directory — but the *install-location* part is
 * dropped, leaving `node_modules/…` (or `../node_modules/…` for a nested map).
 * Without this the `.map` still differed between checkouts even though the
 * script no longer did.
 */
function rewriteSources(text) {
  let map
  try { map = JSON.parse(text) } catch { return text }
  if (!Array.isArray(map.sources)) return text
  map.sources = map.sources.map((source) => {
    const at = source.lastIndexOf('node_modules/')
    if (at < 0) return source
    // Keep however many `../` the map needs to climb out, then anchor at the
    // module name.
    const depth = (source.slice(0, at).match(/\.\.\//g) ?? []).length
    return `${'../'.repeat(depth)}${source.slice(at)}`
  })
  return JSON.stringify(map)
}

/** Run one esbuild bundle in memory and write the rewritten sources. */
async function bundle(options, outfile) {
  const result = await build({ ...options, absWorkingDir: root, write: false })
  for (const out of result.outputFiles) {
    writeFileSync(out.path, out.path.endsWith('.map') ? rewriteSources(out.text) : rewritePaths(out.text))
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
