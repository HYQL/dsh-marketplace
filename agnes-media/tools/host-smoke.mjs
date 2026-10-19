/**
 * Load the host bundle with stubbed DSH peer deps and exercise `apply()`.
 * Confirms the module's contract and that it registers the expected tools.
 */

import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const hostUrl = pathToFileURL(join(root, 'lib', 'host.js')).href

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (e ? ' :: ' + e : '')) } }

// --- Stub the DSH peer modules ---------------------------------------------
const registeredTools = []
const registeredRoutes = []
const provided = {}
const disposed = []

const ctx = {
  tools: { register(t) { registeredTools.push(t); return () => {} } },
  provide(name, value) { provided[name] = value; return () => {} },
  // The host half reads these directly (no ctx.inject) so activation can never
  // be held in LOADING by an unsatisfiable service dependency.
  webServer: {
    register(spec) { registeredRoutes.push(spec); return () => {} },
  },
  connection: {
    rpc: { handle(channel) { registeredRoutes.push({ channel }); return () => {} } },
  },
  on(event, listener) { if (event === 'dispose') disposed.push(listener) },
  effect(cb, label) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
}

// Intercept the imports by rewriting the module source's specifiers.
const { readFileSync, writeFileSync, unlinkSync } = await import('node:fs')
const src = readFileSync(join(root, 'lib', 'host.js'), 'utf8')
const patched = src.replace(
  /from\s*["']@deepseek-ai\/dsh-tools["']/g,
  'from "data:text/javascript,export const defineTool = (s) => s"',
).replace(
  /from\s*["']@deepseek-ai\/cordis["']/g,
  'from "data:text/javascript,export default {}"',
)
// Write to a real temp file so import.meta.url resolves (the banner uses it).
const tmpFile = join(root, 'lib', '.host-smoke.mjs')
writeFileSync(tmpFile, patched)
const patchedUrl = pathToFileURL(tmpFile).href

let mod
try {
  mod = await import(patchedUrl)
  ok('host module imports', true)
} catch (e) {
  ok('host module imports', false, e.message)
  process.exit(1)
}

ok('exports name', mod.name === 'agnes-media', String(mod.name))
// `inject` must declare every service this half accesses: cordis throws
// "cannot get property X without inject" for an undeclared service, which
// fails activation and then the whole web boot. `tools` + `webServer` is the
// pair the legacy dsh-agnes-media plugin declared while it activated cleanly.
ok('exports inject (tools + webServer)',
  JSON.stringify(mod.inject) === JSON.stringify(['tools', 'webServer']),
  JSON.stringify(mod.inject))
ok('exports provide', Array.isArray(mod.provide) && mod.provide.includes('agnesMedia'))
ok('exports apply fn', typeof mod.apply === 'function')

try {
  const r = mod.apply(ctx, { site: 'cn', apiKey: 'test-key' })
  // A returned promise is awaited by Cordis; a never-settling one pins the
  // fiber in LOADING and fails the boot check. apply() must be synchronous.
  ok('apply() returns no promise', !(r && typeof r.then === 'function'), typeof r)
  ok('apply() runs clean', true)
} catch (e) {
  ok('apply() runs clean', false, e.message)
}

// Degraded context: no webServer, no connection, no tools. apply() must still
// succeed — a throw here is what reports as "<entry>: loading" and kills boot.
{
  const bare = { on() {}, effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} }, get() { return undefined } }
  try {
    const r = mod.apply(bare, { site: 'cn', apiKey: 'test-key' })
    ok('apply() survives missing services', !(r && typeof r.then === 'function'))
  } catch (e) {
    ok('apply() survives missing services', false, e.message)
  }
}

const names = registeredTools.map((t) => t.name)
ok('registers 4 tools', registeredTools.length === 4, names.join(','))
for (const want of ['agnes_media_image', 'agnes_media_video', 'agnes_media_task', 'agnes_media_models']) {
  ok(`tool ${want}`, names.includes(want))
}
ok('provides agnesMedia', typeof provided.agnesMedia === 'object')
ok('api has generateImage', typeof provided.agnesMedia?.generateImage === 'function')
ok('api has generateVideo', typeof provided.agnesMedia?.generateVideo === 'function')
ok('api has getVideoTask', typeof provided.agnesMedia?.getVideoTask === 'function')
ok('api has listVideoModels', typeof provided.agnesMedia?.listVideoModels === 'function')

ok('registers webServer route', registeredRoutes.some((r) => r.path === '/agnes-media-studio/api'))
ok('route kind is prefix', registeredRoutes.some((r) => r.kind === 'prefix'))
// No RPC-channel assertion: the `connection` service is not declared by any
// installed plugin, so the channel was removed to keep activation safe.
ok('registers dispose hook', disposed.length > 0)

// Exercise the tool parameter schemas are JSON-serializable.
for (const t of registeredTools) {
  ok(`tool ${t.name} has parameters`, typeof t.parameters === 'object' && t.parameters !== null)
  ok(`tool ${t.name} has execute`, typeof t.execute === 'function')
}

try { unlinkSync(tmpFile) } catch { /* ignore */ }

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
