/**
 * Verify both build artifacts: loader contract, host exports, API-correctness
 * regressions, and the runtime behaviour of the host half against a stubbed
 * Cordis context plus a stubbed Agnes gateway.
 *
 * Usage: node tools/verify.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const clientPath = join(root, 'lib', 'client.js')
const hostPath = join(root, 'lib', 'host.js')
const clientSrc = readFileSync(clientPath, 'utf8')
const hostSrc = readFileSync(hostPath, 'utf8')

let pass = 0
let fail = 0
const ok = (n, c, extra = '') => {
  if (c) { pass++; console.log('  PASS  ' + n) }
  else { fail++; console.log('  FAIL  ' + n + (extra ? ' :: ' + extra : '')) }
}
const group = (title) => console.log(`\n--- ${title} ---`)

// ---------------------------------------------------------------------------
group('client loader contract')
ok('lazy-loader wrapper', clientSrc.startsWith('window.__ModuleLoader__.load({ id: "agnes-media"'))
ok('module shim present', clientSrc.includes('var module = { exports: {} }'))
ok('factory footer', clientSrc.includes('return module.exports; } });'))
ok('react external', /require\("react"\)/.test(clientSrc))
ok('jsx-runtime external', /require\("react\/jsx-runtime"\)/.test(clientSrc))
ok('no ESM imports left', !/^import\s/m.test(clientSrc))
const requires = [...clientSrc.matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1])
const allowed = new Set(['react', 'react/jsx-runtime'])
ok('only loader-provided modules required', requires.every((r) => allowed.has(r)),
  [...new Set(requires)].filter((r) => !allowed.has(r)).join(', '))

// ---------------------------------------------------------------------------
group('host export shape')
ok('ESM export shape', /export\s*\{/.test(hostSrc))
ok('exports apply', /export\s*\{[^}]*\bapply\b/.test(hostSrc))
ok('exports name', /name\s*=\s*['"]agnes-media['"]/.test(hostSrc))
ok('route prefix', hostSrc.includes('/agnes-media-studio/api'))
ok('registers the tool set', (hostSrc.match(/agnes_media_(image|video|task|models|history)/g) ?? []).length >= 5)

// ---------------------------------------------------------------------------
group('the original bug class is absent')
ok('no stopImmediatePropagation', !clientSrc.includes('stopImmediatePropagation'))
ok('no window-level click capture', !/window\.addEventListener\("click"/.test(clientSrc))
ok('no composer slot takeover', !/name:\s*"conversation\.composer"/.test(clientSrc))
ok('no manual sidebar DOM injection', !clientSrc.includes('insertBefore'))
ok('uses documented slots', clientSrc.includes('sidebar.panellist') && clientSrc.includes('shell.overlay')
  && clientSrc.includes('conversation.session.header.utilities'))

// ---------------------------------------------------------------------------
group('API contract regressions (fixed)')
ok('image refs go through extra_body', hostSrc.includes('extra.image') && hostSrc.includes('extra_body'))
ok('video polls the documented /agnesapi contract', hostSrc.includes('/agnesapi?video_id='))
ok('no dead /v1/videos/{id} probe path', !hostSrc.includes('/v1/videos/${encodeURIComponent'))
ok('model_name sent while polling', hostSrc.includes('model_name='))
ok('429 is retryable', hostSrc.includes('error.status === 429'))
ok('Retry-After honoured', hostSrc.includes('retry-after'))
ok('fastapi {detail} errors surfaced', hostSrc.includes('detail'))
// The gateway answers "no available channel" with a top-level `type` field and
// often no `error.code`; losing it makes that look like a generic 400. The two
// cases below assert the behaviour directly instead of matching minified source.
{
  const { describe: describeError } = await import('../src/agnes/http.ts')
  const nested = describeError(400, { error: { message: 'boom', type: 'nested_kind' } })
  const topLevel = describeError(400, { error: { message: 'boom' }, type: 'top_kind' })
  ok('nested error.type kept', /\[nested_kind\]/.test(nested), nested)
  ok('top-level type kept', /\[top_kind\]/.test(topLevel), topLevel)
  ok('code wins over type', describeError(400, { error: { message: 'boom', code: 'c' }, type: 't' }).endsWith('[c]'))
}

// --- entry toggles ----------------------------------------------------------
// The two entries are user-switchable in the bundle's config. The probe must
// carry them, and the client must gate each registration on its own flag.
{
  const { resolveConfig } = await import('../src/config.ts')
  const off = resolveConfig({ pageEnabled: false, drawerEnabled: false })
  const on = resolveConfig({ pageEnabled: true, drawerEnabled: true })
  const dflt = resolveConfig({})
  ok('page toggle defaults on', dflt.pageEnabled === true)
  ok('drawer toggle defaults on', dflt.drawerEnabled === true)
  ok('page toggle can be turned off', off.pageEnabled === false)
  ok('drawer toggle can be turned off', off.drawerEnabled === false)
  ok('toggles are independent', on.pageEnabled === true && on.drawerEnabled === true)
}
// The toggles come from the preference store, not straight from the config:
// the detail-page switches write the store, and the patch overrides it.
ok('probe exposes the toggles', /pageEnabled: prefs\?\.get\(\)\.pageEnabled/.test(hostSrc))
ok('patch can still override the store', /prefs\?\.applyPatch\(cfg\)/.test(hostSrc))
ok('entries endpoint reads the store', hostSrc.includes('options.prefs?.get()'))
ok('entries endpoint writes the store', hostSrc.includes('options.prefs.set(patch)'))
// Registration must stay synchronous: a plugin that awaits the network before
// registering leaves its slots empty and can hold the boot.
ok('apply registers synchronously', !/\bawait\s+readEntryToggles/.test(clientSrc))
// The stored preference is read from `entries`, not `probe`: a switch writes the
// store, which is a different value from the boot config.
ok('boot state comes from the entries endpoint',
  /void api\.entries\(\)[\s\S]{0,120}\.then\(\(next\) => setEntryPrefs\(next\)\)/.test(clientSrc))
// A Host that never answers must leave both entries registered. esbuild strips
// the explanatory comment, so the assertion targets the empty .catch handler.
ok('fails open when the host is unreachable', /\.catch\(\(\) => \{\s*\}\)/.test(clientSrc))
ok('no image key sent to foreign CDNs', hostSrc.includes('isAgnesOrigin'))
ok('mode validation before spending a task', hostSrc.includes('keyframe mode cannot carry images/audios'))
ok('seconds clamped to 4–12', /seconds must be 4\\?u?2013?12/.test(hostSrc) || hostSrc.includes('secondsNum < 4 || secondsNum > 12'))
ok('one-step image-to-video', hostSrc.includes('from_image_prompt'))
ok('job store persisted', hostSrc.includes('jobs.json'))
ok('interrupted jobs are resumable', hostSrc.includes('"interrupted"'))
ok('credentials service consulted', /get\?\.\("credentials"\)/.test(hostSrc))

// ---------------------------------------------------------------------------
group('theme tokens only')
const cssTokens = [...clientSrc.matchAll(/--dsw-[a-z0-9-]+/g)].map((m) => m[0])
ok('uses theme tokens', cssTokens.length > 0)
ok('no hard-coded panel background', !/--ag-bg:\s*#/.test(clientSrc))
ok('light/dark via tokens + color-mix', clientSrc.includes('color-mix'))

// ---------------------------------------------------------------------------
group('accent-button legibility (dark mode)')
// The label on an accent fill must come from a token, never a literal: a white
// label vanishes on a dark theme's light brand colour.
ok('on-accent label derived from a token', clientSrc.includes('--ag-on-accent: var(--dsw-alias-bg-base'))
ok('primary button uses the on-accent token', /ag-btn-primary[^}]*color:\s*var\(--ag-on-accent\)/s.test(clientSrc))
ok('no literal white primary label', !/ag-btn-primary[^}]*color:\s*#fff/s.test(clientSrc))
// A faded disabled button turns grey-on-grey; it must stay opaque with a legible label.
ok('disabled primary is not faded', /ag-btn-primary:disabled[^}]*opacity:\s*1/s.test(clientSrc))
ok('disabled primary keeps a foreground colour', /ag-btn-primary:disabled[^}]*color:\s*var\(--ag-fg\)/s.test(clientSrc))
ok('busy primary keeps the accent fill', /ag-btn-primary\[data-busy="true"\][^}]*background:\s*var\(--ag-accent\)/s.test(clientSrc))

// ---------------------------------------------------------------------------
group('runtime: client artifact evaluates')
const listeners = { doc: {}, win: {} }
const styleNodes = []
const doc = {
  addEventListener(t, f) { (listeners.doc[t] ??= []).push(f) },
  removeEventListener(t, f) { listeners.doc[t] = (listeners.doc[t] ?? []).filter((x) => x !== f) },
  getElementById: () => null,
  createElement: () => {
    const node = { style: {}, dataset: {}, setAttribute() {}, remove() {}, textContent: '', appendChild() {}, addEventListener() {} }
    styleNodes.push(node)
    return node
  },
  head: { appendChild() {} },
  querySelector: () => null,
}
const win = {
  addEventListener(t, f) { (listeners.win[t] ??= []).push(f) },
  removeEventListener(t, f) { listeners.win[t] = (listeners.win[t] ?? []).filter((x) => x !== f) },
  __ModuleLoader__: { loaded: [], load(spec) { this.loaded.push(spec) } },
}
globalThis.window = win
globalThis.document = doc
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: async () => {} } },
  configurable: true,
  writable: true,
})

const react = {
  useState: (i) => [i, () => {}],
  useEffect() {},
  useCallback: (f) => f,
  useRef: () => ({ current: null }),
  useMemo: (f) => f(),
  createElement: () => null,
  Fragment: 'fragment',
}
const jsx = { jsx: () => null, jsxs: () => null, Fragment: 'fragment' }
const modules = { react, 'react/jsx-runtime': jsx }

try {
  new Function('require', clientSrc).call(globalThis, (n) => {
    if (n in modules) return modules[n]
    throw new Error('missing shared module: ' + n)
  })
  ok('client artifact evaluates', true)
} catch (e) {
  ok('client artifact evaluates', false, e.message)
}

const spec = win.__ModuleLoader__.loaded[0]
if (spec !== undefined) {
  ok('registered id agnes-media', spec.id === 'agnes-media', spec.id)
  let api
  try {
    api = spec.factory((n) => { if (n in modules) return modules[n]; throw new Error('missing ' + n) })
    ok('factory returns exports', api !== undefined && typeof api === 'object')
  } catch (e) { ok('factory returns exports', false, e.message) }

  if (api !== undefined) {
    ok('exports apply fn', typeof api.apply === 'function')
    ok('exports name', api.name === 'agnes-media/client', String(api.name))

    const registered = []
    const ctx = {
      effect: (f) => { f(); return () => {} },
      locale: { register: () => () => {}, bind: () => (k) => k },
      slots: {
        inject: (k, cb) => { cb(); return () => {} },
        register: (s, c) => { registered.push({ spec: s, component: c }); return () => {} },
      },
      sessions: {
        binding: () => ({ ctx: { get: (n) => (n === 'conversation' ? { send: async () => {} } : undefined) } }),
      },
    }
    const winBefore = Object.keys(listeners.win).length
    try { api.apply(ctx); ok('apply() runs clean', true) } catch (e) { ok('apply() runs clean', false, e.message) }
    ok('NO window listeners added', winBefore === Object.keys(listeners.win).length,
      'types: ' + JSON.stringify(Object.keys(listeners.win)))
    ok('styles installed', styleNodes.length > 0)
    ok('registers sidebar row', registered.some((r) => r.spec.name === 'sidebar.panellist'))
    ok('registers main page', registered.some((r) => r.spec.name === 'main' && r.spec.key === 'agnes-media'))
    ok('registers overlay drawer', registered.some((r) => r.spec.name === 'shell.overlay'))
    ok('registers header button', registered.some((r) => r.spec.name === 'conversation.session.header.utilities'))
  }
}

// --- send-channel provenance ------------------------------------------------
// Regression: "发送到对话" was invisible everywhere because the channel came
// from (a) a drawer-only slot and (b) polling `sessions.list`, which is NOT a
// method of the sessions service. Both must stay gone, and the session-scoped
// header slot must be the source that publishes the channel.
{
  ok('no polling of sessions.list', !clientSrc.includes("getSnapshot?.()") && !/sessions\?\.\s*list/.test(clientSrc))
  ok('no polling anywhere in the client', !/setInterval\(/.test(clientSrc))
  ok('channel published from a session-scoped slot', /conversation\.session\.header\.utilities[\s\S]{0,400}?inject:\s*\(sessionId/.test(clientSrc))
  ok('header slot resolves a binding', clientSrc.includes('binding?.(sessionId)'))
}

// ---------------------------------------------------------------------------
group('plugin detail page switches')
// The switches live in `plugins.detail.section`, the seat the Plugins page
// reserves for a bundle's own configuration.
// esbuild normalises the string quotes, so match either form.
ok('switches registered in plugins.detail.section',
  /slots\.inject\(['"]plugins\.detail\.section['"]/.test(clientSrc))
ok('switches use role="switch" with aria-checked', clientSrc.includes('role: "switch"') && clientSrc.includes('aria-checked'))
ok('switches write through the Host', clientSrc.includes('setEntries'))
ok('switch thumb colour comes from a token', /--ag-on-accent/.test(clientSrc))

// --- toggles must be reversible --------------------------------------------
// `slots.inject`'s disposer is permanent. If a toggle only ever calls it, the
// entry can never come back without a reload — which is exactly what a switch in
// the plugin detail page must not do. Each entry therefore holds an on() that
// registers afresh.
ok('page entry can be re-registered',
  /entries\.page\s*=\s*\{[\s\S]{0,700}?on:\s*\(\)\s*=>\s*\{[\s\S]{0,500}?offSidebarRow\s*=\s*slots\.inject/.test(clientSrc))
ok('drawer entry can be re-registered',
  /entries\.drawer\s*=\s*\{[\s\S]{0,700}?on:\s*\(\)\s*=>\s*\{[\s\S]{0,500}?offDrawer\s*=\s*slots\.inject/.test(clientSrc))
ok('toggle-off clears the drawer channel', /setSlotSend\(null\)/.test(clientSrc))

// --- the change must reach the slots in the same tick ----------------------
// A poll cannot do this: one that stops after its first success never sees a
// later change (the original bug), and one that runs forever still adds a full
// interval of latency. A shared store publishes synchronously instead.
ok('no polling of the entry state', !/setInterval\(/.test(clientSrc))
ok('switches publish to the shared store', /setEntryPrefs\(/.test(clientSrc))
ok('slots subscribe to the shared store', /subscribeEntryPrefs\(/.test(clientSrc))
ok('header button re-renders from the store', /function useEntryEnabled/.test(clientSrc))
ok('header registration is unconditional',
  /conversation\.session\.header\.utilities[\s\S]{0,700}?QuickButton\(\{ t \}\)/.test(clientSrc))

// ---------------------------------------------------------------------------
group('runtime: host half against a stubbed context + gateway')

const registeredTools = []
const registeredRoutes = []
const provided = {}
const calls = []
let jobFile = null

const fakeFetch = async (url, init = {}) => {
  const href = String(url)
  calls.push({ href, method: init.method ?? 'GET', body: init.body, headers: init.headers })
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })
  if (href.includes('/v1/images/generations')) {
    return json({ created: 1, data: [{ url: 'https://cos-platform-outputs.agnes-ai.cn/images/x.png' }] })
  }
  if (href.includes('/v1/videos') && (init.method ?? 'GET') === 'POST') {
    return json({ id: 'task_1', video_id: 'task_1', task_id: 'task_1', status: 'queued' })
  }
  if (href.includes('/agnesapi')) {
    return json({ id: 'task_1', status: 'completed', progress: 100, url: 'https://cos-platform-outputs.agnes-ai.cn/v.mp4', size: '720P', seconds: '4' })
  }
  if (href.includes('/v1/models')) {
    return json({ data: [{ id: 'agnes-image-2.5-flash' }, { id: 'agnes-video-2.5-flash' }] })
  }
  // A CDN object fetch (inlineReference): headers must be recorded so the test
  // can prove the token never travels to a foreign origin.
  if (href.includes('cos-platform-outputs')) {
    return new Response('binary-bytes', { status: 200, headers: { 'content-type': 'image/png' } })
  }
  return json({ detail: 'unexpected ' + href }, 404)
}

const realFetch = globalThis.fetch
globalThis.fetch = fakeFetch
process.env.AGNES_API_KEY = 'sk-test-key'

const ctx = {
  tools: { register(t) { registeredTools.push(t); return () => {} } },
  provide(name, value) { provided[name] = value; return () => {} },
  on() { return () => {} },
  effect(cb) { const d = cb(); return typeof d === 'function' ? d : () => {} },
  get(name) {
    if (name === 'credentials') {
      return {
        async resolve(ref) {
          return ref === 'AGNES_API_KEY' ? { value: 'sk-test-key', source: 'env' } : undefined
        },
      }
    }
    return undefined
  },
  webServer: {
    register(route) { registeredRoutes.push(route); return () => {} },
  },
}

let hostApi
try {
  const mod = await import(pathToFileURL(hostPath).href)
  mod.apply(ctx, { site: 'cn', storeDir: join(root, '.tmp-store'), maxHistory: 5 })
  hostApi = provided.agnesMedia
  ok('host apply() runs clean', true)
} catch (e) {
  ok('host apply() runs clean', false, e.message)
}

ok('host provides agnesMedia', hostApi !== undefined)
ok('host registers the tool set', registeredTools.length === 5, String(registeredTools.length))
ok('history tool is registered', registeredTools.some((t) => t.name === 'agnes_media_history'))
ok('host registers the prefix route', registeredRoutes.length === 1 && registeredRoutes[0].kind === 'prefix')
ok('tool schemas declare video modes', JSON.stringify(registeredTools.find((t) => t.name === 'agnes_media_video')?.parameters ?? {})
  .includes('reference'))

if (hostApi !== undefined) {
  // image
  try {
    const r = await hostApi.generateImage({ prompt: 'a panda', size: '1K', ratio: '1:1' })
    ok('image result has a url', r.images[0]?.url?.includes('agnes-ai.cn'))
    const call = calls.find((c) => c.href.includes('/v1/images/generations'))
    const body = JSON.parse(call.body)
    ok('image payload nests response_format in extra_body', body.extra_body?.response_format === 'url')
    ok('image payload keeps scalars top-level', body.size === '1K' && body.ratio === '1:1')
  } catch (e) {
    ok('image generation', false, e.message)
  }

  // image-to-image
  try {
    await hostApi.generateImage({ prompt: 'recolor', image: ['https://example.com/in.png'] })
    const call = [...calls].reverse().find((c) => c.href.includes('/v1/images/generations'))
    const body = JSON.parse(call.body)
    ok('image-to-image refs land in extra_body.image', Array.isArray(body.extra_body?.image) && body.extra_body.image.length === 1)
  } catch (e) {
    ok('image-to-image', false, e.message)
  }

  // A panel upload arrives as a data URI; it must survive to the wire intact.
  try {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    await hostApi.generateImage({ prompt: 'restyle', image: [dataUri] })
    const call = [...calls].reverse().find((c) => c.href.includes('/v1/images/generations'))
    const body = JSON.parse(call.body)
    ok('uploaded data URI reaches extra_body.image', body.extra_body?.image?.[0] === dataUri)
    ok('data URI stays out of the top level', body.image === undefined)
  } catch (e) {
    ok('uploaded data URI reaches extra_body.image', false, e.message)
  }

  // Multiple references (composition) keep their order and count.
  try {
    const refs = [
      'data:image/png;base64,AAA',
      'data:image/jpeg;base64,BBB',
      'https://example.com/third.png',
    ]
    await hostApi.generateImage({ prompt: 'compose', image: refs })
    const call = [...calls].reverse().find((c) => c.href.includes('/v1/images/generations'))
    const body = JSON.parse(call.body)
    ok('multiple references preserve order', JSON.stringify(body.extra_body?.image) === JSON.stringify(refs))
  } catch (e) {
    ok('multiple references preserve order', false, e.message)
  }

  // video (wait: false → create only)
  try {
    const r = await hostApi.generateVideo({ prompt: 'rain', seconds: '4' }, { wait: false })
    ok('video create returns the task id', r.videoId === 'task_1' || r.taskId === 'task_1')
    const call = [...calls].reverse().find((c) => c.href.includes('/v1/videos'))
    const body = JSON.parse(call.body)
    ok('video payload pins size 720P', body.size === '720P')
    ok('video payload sends mode', body.mode === 'text')
  } catch (e) {
    ok('video create', false, e.message)
  }

  // --- error message mapping ---------------------------------------------
  // Real gateway failure bodies, captured verbatim from the live API.
  const { describe: describeError } = await import('../src/agnes/http.ts')
  const realErrors = [
    {
      name: 'upstream channel failure (top-level type, no code)',
      body: { error: { message: '分组 default 下模型 dall-e 无可用渠道（distributor）' }, type: 'AgnesAI_error' },
      status: 400,
      want: /HTTP 400 — .*dall-e.*\[AgnesAI_error\]/,
    },
    {
      name: 'channel failure with code present',
      body: { error: { message: '模型已下线', code: 'model_not_found' }, type: 'AgnesAI_error' },
      status: 404,
      want: /HTTP 404 — 模型已下线 \[model_not_found\]/,
    },
    {
      name: 'openai-style error keeps code over type',
      body: { error: { message: 'invalid api key', code: 'invalid_api_key' } },
      status: 401,
      want: /HTTP 401 — invalid api key \[invalid_api_key\]/,
    },
    {
      name: 'fastapi detail string',
      body: { detail: 'size must be 720P' },
      status: 400,
      want: /HTTP 400 — size must be 720P/,
    },
    {
      name: 'fastapi detail list',
      body: { detail: [{ msg: 'seconds must be 4~12' }] },
      status: 422,
      want: /HTTP 422 — seconds must be 4~12/,
    },
    {
      name: 'raw text (non-JSON 502 page)',
      body: { _raw: '<html>502 Bad Gateway</html>' },
      status: 502,
      want: /HTTP 502 — <html>502 Bad Gateway/,
    },
  ]
  for (const cse of realErrors) {
    const text = describeError(cse.status, cse.body)
    ok(`error mapping: ${cse.name}`, cse.want.test(text), text)
  }

  // video poll contract
  try {
    const r = await hostApi.getVideoTask('task_1', 'agnes-video-2.5-flash')
    ok('poll maps completed status', r.status === 'completed' && r.url !== null)
    const call = [...calls].reverse().find((c) => c.href.includes('/agnesapi'))
    ok('poll hits /agnesapi with model_name', call.href.includes('/agnesapi?video_id=task_1') && call.href.includes('model_name='))
  } catch (e) {
    ok('video poll', false, e.message)
  }

  // validation before spending a task
  try {
    await hostApi.generateVideo({ prompt: 'x', mode: 'text', first_frame: 'https://e/x.png' }, { wait: false })
    ok('text mode rejects media fields', false, 'no throw')
  } catch (e) {
    ok('text mode rejects media fields', /text mode cannot carry/.test(e.message), e.message)
  }
  try {
    await hostApi.generateVideo({ prompt: 'x', seconds: '99' }, { wait: false })
    const call = [...calls].reverse().find((c) => c.href.includes('/v1/videos'))
    const body = JSON.parse(call.body)
    ok('out-of-range seconds clamped to 12', body.seconds === '12', String(body.seconds))
  } catch (e) {
    ok('out-of-range seconds clamped to 12', false, e.message)
  }

  // job runner
  try {
    const job = await hostApi.jobs.createImage({ prompt: 'queued panda' })
    ok('job created with an id', typeof job.id === 'string')
    const done = await hostApi.jobs.wait(job.id)
    ok('job completes', done?.status === 'completed', done?.status)
    ok('job keeps its urls', Array.isArray(done?.urls) && done.urls.length === 1)
    const list = hostApi.jobs.list()
    ok('job list is persisted in memory', list.length >= 1)
  } catch (e) {
    ok('job runner', false, e.message)
  }

  // probe
  try {
    const p = await hostApi.probe()
    ok('probe reports the key', p.keyConfigured === true)
    ok('probe discovers models', p.imageModels.length === 1 && p.videoModels.length === 1)
  } catch (e) {
    ok('probe', false, e.message)
  }

  // --- the chat <-> panel loop -------------------------------------------
  // A tool call must land in the same store the panel reads, tagged as agent.
  try {
    const imageTool = registeredTools.find((t) => t.name === 'agnes_media_image')
    ok('image tool is callable', imageTool !== undefined)
    const before = hostApi.jobs.list().length
    await imageTool.execute({ prompt: 'agent panda' }, { signal: undefined })
    const after = hostApi.jobs.list()
    const recorded = after.find((j) => j.prompt === 'agent panda')
    // The store trims to maxHistory, so assert the record landed rather than
    // that the list grew.
    ok('tool call recorded in the panel store', recorded !== undefined,
      `before=${before} after=${after.length}`)
    ok('recorded job is tagged as agent', recorded?.source === 'agent', recorded?.source)
    ok('recorded job carries the url', (recorded?.urls.length ?? 0) === 1)
    ok('recorded job is completed', recorded?.status === 'completed', recorded?.status)
  } catch (e) {
    ok('tool call recorded in the panel store', false, e.message)
  }

  // The history tool is the reverse direction: the agent reads panel output.
  try {
    const historyTool = registeredTools.find((t) => t.name === 'agnes_media_history')
    ok('history tool is callable', historyTool !== undefined)
    const panelJob = await hostApi.jobs.createImage({ prompt: 'panel panda' })
    await hostApi.jobs.wait(panelJob.id)
    const text = await historyTool.execute({ limit: 20 }, { signal: undefined })
    ok('history lists panel results', text.includes('panel panda'))
    ok('history lists agent results', text.includes('agent panda'))
    ok('history exposes reusable urls', /- url: https:\/\//.test(text))
    ok('history exposes params', /- params: /.test(text))
    const filtered = await historyTool.execute({ source: 'panel', promptContains: 'panel' }, { signal: undefined })
    ok('history filters by source and prompt', filtered.includes('panel panda') && !filtered.includes('agent panda'))

    // A reference image is stored as an inline data URI; printing it would bury
    // the real parameters under megabytes of base64.
    const refJob = await hostApi.jobs.createImage({ prompt: 'ref panda', image: ['data:image/png;base64,' + 'A'.repeat(4096)] })
    await hostApi.jobs.wait(refJob.id)
    const withRef = await historyTool.execute({ promptContains: 'ref panda' }, { signal: undefined })
    ok('history never inlines base64', !withRef.includes('A'.repeat(64)), 'found a long base64 run')
    ok('history summarises inline references', /image=<inline png \d+KB>/.test(withRef),
      withRef.split('\n').find((l) => l.includes('params')))
  } catch (e) {
    ok('history tool', false, e.message)
  }

  // --- inlineReference (the CORS-safe path) -------------------------------
  // The CDN sends no Access-Control-Allow-Origin, so the page cannot fetch it.
  // "作为参考图" must therefore go through the Host.
  try {
    const refJob = await hostApi.jobs.createImage({ prompt: 'ref target panda' })
    await hostApi.jobs.wait(refJob.id)
    const media = await hostApi.jobs.inlineReference(refJob.id)
    ok('inlineReference returns a data URI', media.dataUri.startsWith('data:image/'), media.dataUri.slice(0, 30))
    ok('inlineReference names the file', typeof media.name === 'string' && media.name.length > 0, media.name)
    ok('inlineReference reports the kind', media.kind === 'image')

    // A real CDN URL attached the token only because the Host, not the browser,
    // made the request. Prove the Host never leaks it to a foreign origin.
    const fetchCalls = calls.filter((c) => c.headers !== undefined)
    ok('token only attached to the Agnes origin',
      fetchCalls.every((c) => c.href.includes('agnes-ai.cn') || c.href.includes('apihub.agnes-ai.com')))

    // Rejections must be errors, not silent undefined.
    let threw = null
    try { await hostApi.jobs.inlineReference('job_does_not_exist') } catch (e) { threw = e }
    ok('unknown job id is an error', threw !== null, threw?.message)

    // A video job has no still image to reuse.
    const videoJob = hostApi.jobs.list().find((j) => j.kind === 'video' && j.urls.length > 0)
    if (videoJob !== undefined) {
      let vidThrew = null
      try { await hostApi.jobs.inlineReference(videoJob.id) } catch (e) { vidThrew = e }
      ok('video job yields no reusable still', vidThrew !== null, vidThrew?.message)
    }
  } catch (e) {
    ok('inlineReference', false, e.message)
  }
}

ok('job store file written', existsSync(join(root, '.tmp-store', 'jobs.json')))

globalThis.fetch = realFetch
delete process.env.AGNES_API_KEY

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
