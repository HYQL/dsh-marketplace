/**
 * Verify the INSTALLED copy (what DSH actually loads) rather than the source
 * tree: same contract checks, run against
 * ~/.dsh/profiles/desktop/node_modules/agnes-media.
 *
 * The installed copy is a junction to local-plugins/agnes-media, so this is
 * also the check that the profile-relative install actually resolves.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'
import { join } from 'node:path'

const installed = join(homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'agnes-media')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (e ? ' :: ' + e : '')) } }

const registeredTools = []
const registeredRoutes = []
const provided = {}
const disposed = []

// The host half reads webServer / connection directly off ctx (no ctx.inject),
// so they belong on the context itself. `inject` must NOT be exercised here —
// if the module still uses it, these routes would silently not register.
const ctx = {
  tools: { register(t) { registeredTools.push(t); return () => {} } },
  provide(name, value) { provided[name] = value; return () => {} },
  webServer: { register(spec) { registeredRoutes.push(spec); return () => {} } },
  connection: { rpc: { handle(channel) { registeredRoutes.push({ channel }); return () => {} } } },
  on(e) { if (e === 'dispose') disposed.push(() => {}) },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get() { return undefined },
}

const hostSrc = readFileSync(join(installed, 'lib', 'host.js'), 'utf8')
const patched = hostSrc
  .replace(/from\s*["']@deepseek-ai\/dsh-tools["']/g, 'from "data:text/javascript,export const defineTool=(s)=>s"')
  .replace(/from\s*["']@deepseek-ai\/cordis["']/g, 'from "data:text/javascript,export default{}"')
const tmp = join(installed, 'lib', '.smoke.mjs')
writeFileSync(tmp, patched)

let mod
try {
  mod = await import(pathToFileURL(tmp).href)
  ok('installed host imports', true)
} catch (e) {
  ok('installed host imports', false, e.message)
  process.exit(1)
} finally {
  try { unlinkSync(tmp) } catch { /* ignore */ }
}

ok('name', mod.name === 'agnes-media', String(mod.name))
ok('apply fn', typeof mod.apply === 'function')

// `inject` declares every service the half accesses (cordis throws on an
// undeclared service access). tools + webServer is the legacy-proven pair.
ok('inject declares tools + webServer',
  JSON.stringify(mod.inject) === JSON.stringify(['tools', 'webServer']),
  JSON.stringify(mod.inject))

try {
  const r = mod.apply(ctx, { site: 'cn', apiKey: 'k' })
  ok('apply() returns no promise', !(r && typeof r.then === 'function'), typeof r)
  ok('apply() clean', true)
} catch (e) { ok('apply() clean', false, e.message) }

const names = registeredTools.map((t) => t.name)
ok('4 tools', registeredTools.length === 4, names.join(','))
for (const w of ['agnes_media_image', 'agnes_media_video', 'agnes_media_task', 'agnes_media_models']) {
  ok('tool ' + w, names.includes(w))
}
ok('provides agnesMedia', typeof provided.agnesMedia === 'object')
ok('route /agnes-media-studio/api', registeredRoutes.some((r) => r.path === '/agnes-media-studio/api'))
// No RPC-channel assertion: the `connection` service is not declared by any
// installed plugin, so the channel was removed to keep activation safe.

// Degraded context — apply() must still not throw or return a pending promise.
{
  const bare = { on() {}, effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} }, get() { return undefined } }
  try {
    const r = mod.apply(bare, { site: 'cn', apiKey: 'k' })
    ok('apply() survives missing services', !(r && typeof r.then === 'function'))
  } catch (e) { ok('apply() survives missing services', false, e.message) }
}

// Client artifact
const clientSrc = readFileSync(join(installed, 'lib', 'client.js'), 'utf8')
ok('client loader wrapper', clientSrc.startsWith('window.__ModuleLoader__.load({ id: "agnes-media"'))
ok('client prefix matches host', clientSrc.includes('/agnes-media-studio/api'))
ok('no stopImmediatePropagation', !clientSrc.includes('stopImmediatePropagation'))
ok('client inject declares slots + locale + sessions',
  /inject\s*=\s*\[\s*"slots"\s*,\s*"locale"\s*,\s*"sessions"\s*\]/.test(clientSrc)
  || /inject\s*=\s*\[\s*'slots'\s*,\s*'locale'\s*,\s*'sessions'\s*\]/.test(clientSrc),
  clientSrc.match(/inject\s*=\s*\[[^\]]*\]/)?.[0])
ok('dark mode wiring', clientSrc.includes('data-ds-dark-theme') && clientSrc.includes('prefers-color-scheme: dark'))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
