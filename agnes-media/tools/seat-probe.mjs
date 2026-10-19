/**
 * Reproduces "重启后插件详情页入口的开关不见了" against the built client bundle.
 *
 * The failure is silent: the Plugins page draws its configuration section only
 * when
 *
 *     configured === ledger.bundles.has(pkg.name)
 *
 * i.e. when a cell is registered under the open bundle's package name. Nothing
 * is drawn and nothing is logged when that is false.
 *
 * This probe mounts the real client half over a slot registry that behaves like
 * the shipped one — and the shipped one is strict in two ways a fake registry
 * must get right, or the probe tests nothing:
 *
 *   • `register` into a slot no parent has declared THROWS;
 *   • `register` of a second cell under the same keyed key THROWS (there is no
 *     last-one-wins replacement).
 *
 * The order below mirrors a real start: the plugin activates first, the Plugins
 * page mounts later, and the page is what declares the slot.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientSource = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

// --- a slot registry with the shipped semantics -----------------------------

/** name → { entries: [{options, component, registrant}] } — declared slots only. */
const records = new Map()
const pending = new Map()
const listeners = new Map()
let version = 0

const notify = (name) => {
  version += 1
  for (const listener of listeners.get(name) ?? []) listener()
}

const slots = {
  inject(name, callback) {
    if (records.has(name)) {
      // Already declared: the shell runs the callback at once.
      callback()
      return () => {}
    }
    const list = pending.get(name) ?? []
    list.push(callback)
    pending.set(name, list)
    return () => {
      const i = list.indexOf(callback)
      if (i >= 0) list.splice(i, 1)
    }
  },

  /** The page mounts: it declares its slots, then runs every pending inject. */
  declare(name) {
    if (records.has(name)) throw new Error(`slot "${name}" is already declared`)
    records.set(name, { entries: [], declaredBy: 'an entry in "main" (Kb)' })
    const callbacks = pending.get(name) ?? []
    pending.set(name, [])
    for (const callback of callbacks) callback()
    notify(name)
  },

  register(options, component) {
    const record = records.get(options.name)
    if (record === undefined) {
      throw new Error(`slot "${options.name}" is not declared (a parent entry's children table must declare it)`)
    }
    const priority = options.priority ?? 0
    const clash = record.entries.find((entry) =>
      entry.options.key === options.key && (entry.options.priority ?? 0) === priority)
    if (clash !== undefined) {
      // Exactly the shipped message, which is how the client recognises "ours".
      throw new Error(`keyed slot "${options.name}" already has an entry for key "${options.key}"`
        + ` (registered by ${clash.registrant})`)
    }
    const entry = { options, component, registrant }
    record.entries.push(entry)
    notify(options.name)
    return () => {
      const i = record.entries.indexOf(entry)
      if (i >= 0) record.entries.splice(i, 1)
      notify(options.name)
    }
  },

  entries(name) {
    const record = records.get(name)
    if (record === undefined) throw new Error(`slot "${name}" is not declared`)
    return record.entries
  },

  getVersion() { return version },
  subscribe(name, listener) {
    const list = listeners.get(name) ?? []
    list.push(listener)
    listeners.set(name, list)
    return () => { const i = list.indexOf(listener); if (i >= 0) list.splice(i, 1) }
  },
}

/** Whose name the next registration carries, like the shell's module scope. */
let registrant = 'agnes-media/client'

// --- the shell the client bundle expects ------------------------------------

const React = {
  // Like React: a function component is invoked with props, not stored as the
  // element's type. Without this the child components never run and the tree
  // says nothing about what the cell draws.
  createElement: (type, props, ...children) => {
    const resolved = { ...(props ?? {}), ...(children.length > 0 ? { children } : {}) }
    if (typeof type === 'function') return type(resolved)
    return { type, props: resolved }
  },
  Fragment: 'fragment',
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useMemo: (fn) => fn(),
}
const jsxRuntime = {
  jsx: (type, props) => React.createElement(type, props),
  jsxs: (type, props) => React.createElement(type, props),
  Fragment: React.Fragment,
}
const modules = {
  react: React,
  'react/jsx-runtime': jsxRuntime,
  '@deepseek-ai/dsh-client-ui-slots': { resolveSlotLabel: (label) => typeof label === 'function' ? '' : label },
  '@deepseek-ai/dsh-client-ui-primitives': {},
  '@deepseek-ai/dsh-client-store': {},
}

let booted = null
globalThis.window = {
  __ModuleLoader__: {
    load: ({ id, factory }) => { booted = { id, exports: factory((name) => modules[name] ?? {}) } },
  },
}
// The api module talks to the Host; only the seat machinery is under test.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, value: [] }) })

new Function('window', clientSource)(globalThis.window)
if (booted === null) { console.error('client bundle did not register'); process.exit(1) }
console.log('loaded', booted.id)

const { apply } = booted.exports
let failures = 0
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) failures += 1
}

const OWN = 'agnes-media'

/** The page's own condition, verbatim. */
const pageWouldDraw = (bundleName) => {
  try {
    return slots.entries('plugins.bundle.config').some((entry) => entry.options.key === bundleName)
  } catch {
    return false
  }
}

const ctx = {
  slots,
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
    subscribe: () => () => {},
    getSnapshot: () => ({ revision: 0 }),
  },
  effect: (cb) => { const disposer = cb(); return () => { if (typeof disposer === 'function') disposer() } },
  on: () => () => {},
  get: () => undefined,
}

// The page mounts: it declares its slots, then runs every pending inject.
// The drawer's own child slot comes from a cell that already exists at
// activation, so declare the drawer seat first, exactly as `shell.overlay`
// is declared by the shell before any plugin activates.
slots.declare('shell.overlay')
for (const name of ['sidebar.panellist', 'main', 'conversation.session.header.utilities']) slots.declare(name)

// 1. Activation, before the Plugins page exists. Nothing may be registered and
//    nothing may throw: the cells are queued on `inject`.
apply(ctx)
check('activation before the page exists registers nothing', !pageWouldDraw(OWN))

// 2. The page mounts and declares its slot. The shell now runs our injects.
slots.declare('plugins.bundle.config')

check(`switches mounted on the plugin's own page ("${OWN}")`, pageWouldDraw(OWN))
check('a row page is covered too',
  slots.entries('plugins.bundle.config').some((e) => e.options.key === `${OWN}#agnes-media-studio`))

// 3. Each key has exactly one occupant. A second one is impossible — the shell
//    throws — so a duplicate would have shown up as a lost cell above, not here.
check('every cell has exactly one occupant',
  slots.entries('plugins.bundle.config').filter((e) => e.options.key === OWN).length === 1)

// 4. The page renders the cell: the component is callable and draws the two
//    switches with role="switch". The hooks in the harness return their initial
//    value, so this is the same tree React would build for a first render.
{
  const cell = slots.entries('plugins.bundle.config').find((e) => e.options.key === OWN)
  let drawn = null
  try {
    drawn = cell?.component({ view: 'page' })
  } catch (error) {
    console.log('   render threw:', error && error.message)
  }
  // React builds the element tree; the harness returns it, so stringify it.
  const text = JSON.stringify(drawn ?? null)
  console.log('   rendered:', text.slice(0, 200))
  check('the cell renders a switch control', text.includes('switch'))
  check('the cell renders both entry switches', (text.match(/switch/g) ?? []).length >= 2)
}

console.log(failures === 0
  ? 'RESULT: entry switches are mounted on the plugin page'
  : `RESULT: ${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
