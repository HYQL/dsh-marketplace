/**
 * The decisive test: simulate cordis's real `ctx` proxy semantics.
 *
 * From @deepseek-ai/cordis/lib/index.js (ReflectService.handler.get):
 *   - accessing a service property that is neither declared in the plugin's
 *     `inject` nor present on an ancestor fiber's store throws
 *     `cannot get property "<prop>" without inject`;
 *   - a property declared in `inject` resolves to the provided value.
 *
 * Every stub-ctx test in this suite uses plain objects, so they cannot catch
 * this class of bug. This harness reproduces the real failure mode.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const installed = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'node_modules', 'agnes-media')

let pass = 0, fail = 0
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n) } else { fail++; console.log('  FAIL  ' + n + (e ? '  :: ' + e : '')) } }

/**
 * Build a ctx that behaves like cordis: `effect`/`on`/`provide` are plain
 * methods (always available), while SERVICE properties resolve only if listed
 * in `inject`, and throw cordis's exact error otherwise.
 */
function cordisCtx(inject, services) {
  const injected = new Set(inject ?? [])
  const store = services ?? {}
  const target = {
    effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
    on() { return () => {} },
    provide() { return () => {} },
    get() { return undefined },
    // services land on the target only when provided
    ...Object.fromEntries(Object.entries(store).filter(([k]) => injected.has(k))),
  }
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver)
      if (typeof prop !== 'string') return undefined
      // cordis: special props pass through
      if (prop.startsWith('_')) return undefined
      if (injected.has(prop)) return Reflect.get(t, prop, receiver) // declared but not provided -> undefined, no throw
      // undeclared service access: this is the exact cordis failure
      throw new Error(`cannot get property "${prop}" without inject`)
    },
  })
}

async function main() {
  // --- host half ----------------------------------------------------------
  const hostSpec = fs.readFileSync(path.join(installed, 'lib', 'host.js'), 'utf8')
  const patched = hostSpec
    .replace(/from\s*["']@deepseek-ai\/dsh-tools["']/g, 'from "data:text/javascript,export const defineTool=(s)=>s"')
    .replace(/from\s*["']@deepseek-ai\/cordis["']/g, 'from "data:text/javascript,export default{}"')
  const tmpHost = path.join(installed, 'lib', '.cordis-test-host.mjs')
  fs.writeFileSync(tmpHost, patched)
  let host
  try {
    host = await import('file:///' + tmpHost.replace(/\\/g, '/'))
    ok('host module imports', true)
  } catch (e) {
    ok('host module imports', false, e.message)
    fs.unlinkSync(tmpHost)
    process.exit(1)
  }
  fs.unlinkSync(tmpHost)

  console.log('\n--- host: declared services match actual accesses ---')
  ok('host inject declares tools', host.inject.includes('tools'), JSON.stringify(host.inject))
  ok('host inject declares webServer', host.inject.includes('webServer'), JSON.stringify(host.inject))
  ok('host inject does NOT declare connection (unproven service)', !host.inject.includes('connection'))

  // Exact cordis semantics: ctx with tools + webServer provided, nothing else.
  const tools = [], routes = []
  const ctx = cordisCtx(host.inject, {
    tools: { register: (t) => { tools.push(t); return () => {} } },
    webServer: { register: (spec) => { routes.push(spec); return () => {} } },
  })
  let hostError = null
  try {
    host.apply(ctx, { site: 'cn', apiKey: 'k' })
  } catch (e) { hostError = e }
  ok('host apply() under real cordis semantics does not throw', hostError === null, hostError?.message)
  ok('registers 4 tools', tools.length === 4, tools.map((t) => t.name).join(','))
  ok('registers prefix route', routes.some((r) => r.path === '/agnes-media-studio/api'))

  // Host must not touch ctx.connection ANYWHERE: under cordis semantics an
  // undeclared access throws. Scan the bundle for any such access.
  ok('built host never reads ctx.connection', !/ctx\.connection\b/.test(hostSpec))

  // --- client half --------------------------------------------------------
  const clientSrc = fs.readFileSync(path.join(installed, 'lib', 'client.js'), 'utf8')
  const m = clientSrc.match(/inject\s*=\s*\[([^\]]*)\]/)
  const clientInject = m ? m[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : []
  console.log('\n--- client: declared services match actual accesses ---')
  ok('client inject declares slots', clientInject.includes('slots'), JSON.stringify(clientInject))
  ok('client inject declares locale', clientInject.includes('locale'), JSON.stringify(clientInject))
  ok('client inject declares sessions', clientInject.includes('sessions'), JSON.stringify(clientInject))

  // Simulate the browser loader, then call apply with a cordis-style ctx that
  // provides exactly the declared services.
  const styleNodes = []
  const doc = {
    getElementById: () => null,
    createElement: () => { const n = { style: {}, dataset: {}, setAttribute() {}, remove() {}, appendChild() {}, addEventListener() {}, innerHTML: '' }; return n },
    head: { appendChild(n) { styleNodes.push(n) } },
    querySelector: () => null,
    addEventListener() {}, removeEventListener() {},
  }
  const win = { addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { loaded: [], load(spec) { this.loaded.push(spec) } } }
  globalThis.window = win
  globalThis.document = doc
  globalThis.Element = class {}
  globalThis.Node = class {}
  globalThis.HTMLElement = class {}
  globalThis.HTMLTextAreaElement = class {}
  globalThis.AbortController = class { constructor() { this.signal = { aborted: false, addEventListener() {} } } abort() {} }
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true })

  const react = {
    useState: (i) => [i, () => {}], useEffect() {}, useCallback: (f) => f, useRef: () => ({ current: null }),
    useMemo: (f) => f(), createElement: () => null,
  }
  const modules = { react, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null, Fragment: 'f' } }

  let api
  try {
    new Function('require', clientSrc).call(globalThis, (n) => { if (n in modules) return modules[n]; throw new Error('missing ' + n) })
    const spec = win.__ModuleLoader__.loaded[0]
    if (spec === undefined) { ok('client factory evaluates', false, 'no module registered with __ModuleLoader__'); process.exit(1) }
    api = spec.factory((n) => { if (n in modules) return modules[n]; throw new Error('missing ' + n) })
    ok('client factory evaluates', api !== undefined)
  } catch (e) {
    ok('client factory evaluates', false, e.message)
    process.exit(1)
  }

  const clientCtx = cordisCtx(clientInject, {
    slots: {
      inject: (k, cb) => { try { cb() } catch {} return () => {} },
      register: () => () => null,
    },
    locale: { register: () => () => {}, bind: () => (k) => k },
    sessions: { binding: () => ({ ctx: { get: () => ({ send: async () => {} }) } }), list: Object.assign(() => [], { getSnapshot: () => ({}) }) },
  })
  let clientError = null
  try {
    api.apply(clientCtx)
  } catch (e) { clientError = e }
  ok('client apply() under real cordis semantics does not throw', clientError === null, clientError?.message)

  // Negative control: with inject IGNORED (the old bug), the same access
  // trips cordis's "cannot get property X without inject". apply()'s
  // try/catch safety net must convert that into a logged degradation, not a
  // propagated exception — because a throw here fails the whole web boot.
  const logs = []
  const realError = console.error
  console.error = (...a) => logs.push(a.map(String).join(' '))
  const buggyCtx = cordisCtx([], {
    slots: { inject: () => () => {}, register: () => () => null },
    locale: { register: () => () => {}, bind: () => (k) => k },
    sessions: {},
  })
  let bugEscaped = null
  try { api.apply(buggyCtx) } catch (e) { bugEscaped = e }
  console.error = realError
  const logged = logs.some((l) => /without inject/.test(l))
  ok('harness reproduces the cordis undeclared-service error (negative control)', logged, 'no "without inject" error recorded')
  ok('apply() safety net keeps the error from escaping (no throw)', bugEscaped === null, bugEscaped?.message)

  console.log('\n' + pass + ' passed, ' + fail + ' failed')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL: ' + e.stack); process.exit(1) })
