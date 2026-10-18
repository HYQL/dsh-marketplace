/**
 * Agnes Media Studio — browser entry point.
 *
 * Three seats, one component tree:
 *   • `sidebar.panellist` + `main` — a real workbench page beside Plugins and
 *     Schedules, for long sessions with the studio open.
 *   • `conversation.session.header.utilities` — a compact spark button that
 *     opens the quick drawer without leaving the conversation.
 *   • `shell.overlay` — that drawer, plus the session-scoped child slot that
 *     hands back the conversation's own send channel.
 *
 * Nothing here touches the composer or its send button, and no listener is
 * registered on `window`/`document` for events the shell already owns.
 *
 * @module agnes-media/client
 */

import { useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { Studio, EntryIcon, renderForChat, type Translate } from './studio.tsx'
import { installStyles } from './styles.ts'
import { NS, dictionaries, type LocaleKey } from './locales.ts'
import { api } from './api.ts'
import { EntrySwitches } from './entries.tsx'
import { getEntryPrefs, setEntryPrefs, subscribeEntryPrefs } from './entry-state.ts'
import type { EntryPrefs } from './api.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agnes-media': LocaleKey
  }
}

export const name = 'agnes-media/client'

/**
 * Services this half accesses on ctx.
 *
 * Cordis resolves `ctx.<service>` through a proxy: an undeclared service that
 * is not on an ancestor fiber's store throws
 * "cannot get property "<service>" without inject" and fails activation —
 * which fails the whole web boot. Every service touched below must be here.
 *
 * `slots` + `sessions` is the pair dsh-agnes-studio declares; `locale` is
 * declared by dsh-pocket. All three resolve in the web shell.
 */
export const inject = ['slots', 'locale', 'sessions']

const PANEL_KEY = 'agnes-media'
const OVERLAY = 'shell.overlay'
const WORKSPACE = 'agnes-media.workspace'

// --- drawer state -----------------------------------------------------------
// The drawer is opened from two places (the sidebar page header and the
// conversation header button), so its visibility lives in a tiny module store
// rather than in either component's state.

let drawerOpen = false
const drawerListeners = new Set<() => void>()

function setDrawer(next: boolean): void {
  if (drawerOpen === next) return
  drawerOpen = next
  for (const listener of drawerListeners) listener()
}

function toggleDrawer(): void {
  setDrawer(!drawerOpen)
}

function useDrawer(): boolean {
  const [open, setOpen] = useState(drawerOpen)
  useEffect(() => subscribeDrawer(() => setOpen(drawerOpen)), [])
  return open
}

function subscribeDrawer(listener: () => void): () => void {
  drawerListeners.add(listener)
  return () => { drawerListeners.delete(listener) }
}

// --- session channel --------------------------------------------------------
// One rule: the channel comes from a slot that is *guaranteed* to be told the
// session id, never from guessing which session is on screen.
//
// `conversation.session.header.utilities` is session-scoped, so its `inject`
// runs whenever a conversation is open — whether or not the drawer is open.
// That single source drives the channel for every seat (page, drawer, header).
//
// The drawer's own child slot can only run while the drawer is rendered, so it
// is a secondary source used only to keep the channel fresh while drawing.

let boundSend: ((text: string) => void) | null = null
let slotSend: ((text: string) => void) | null = null
const channelListeners = new Set<() => void>()

/**
 * Whether the drawer entry is enabled (read from the Host's stored preference).
 *
 * Kept in sync with the shared store by `applyEntries`, and read by the header
 * button through `useEntryEnabled` so a toggle re-renders it.
 */
let drawerVisible = true

function sendToChat(): ((text: string) => void) | null {
  return boundSend ?? slotSend
}

function setChannel(next: ((text: string) => void) | null): void {
  if (boundSend === next) return
  boundSend = next
  for (const listener of channelListeners) listener()
}

function setSlotSend(next: ((text: string) => void) | null): void {
  if (slotSend === next) return
  slotSend = next
  for (const listener of channelListeners) listener()
}

function subscribeChannel(listener: () => void): () => void {
  channelListeners.add(listener)
  return () => { channelListeners.delete(listener) }
}

function useSendChannel(): ((text: string) => void) | null {
  // Wrapped in an arrow: `useState` treats a bare function argument as a lazy
  // initializer and would call it instead of storing it.
  const [channel, setChannel] = useState<((text: string) => void) | null>(() => sendToChat())
  useEffect(() => subscribeChannel(() => setChannel(() => sendToChat())), [])
  return channel
}

/**
 * Look up a conversation's send channel for one session id.
 *
 * Returns null (never throws) when the binding is gone: a session can be
 * archived or closed between the resolve and the click.
 */
function sendChannelFor(ctx: ClientContext, sessionId: string): ((text: string) => void) | null {
  try {
    const binding = (ctx as ClientContext & {
      sessions?: { binding?: (id: string) => { ctx?: { get?: (n: string) => unknown } } | undefined }
    }).sessions?.binding?.(sessionId)
    const conversation = binding?.ctx?.get?.('conversation') as { send?: (text: string) => unknown } | undefined
    return typeof conversation?.send === 'function'
      ? (text: string) => { void conversation.send?.(text) }
      : null
  } catch {
    return null
  }
}

export function apply(ctx: ClientContext): void {
  try {
    run(ctx)
  } catch (error) {
    // Last-resort guarantee: activation must never fail the boot because of us.
    // eslint-disable-next-line no-console
    console.error('[agnes-media] client apply() failed, degrading:', error)
  }
}

function run(ctx: ClientContext): void {
  // Theme styles are ours alone and scoped under [data-agnes-root].
  const disposeStyles = installStyles()
  safeEffect(ctx, () => disposeStyles, 'agnes-media: styles')

  // Locale dictionaries; the panel falls back to raw keys when unavailable.
  safeEffect(ctx, () => ctx.locale?.register(NS, dictionaries) ?? (() => {}), 'agnes-media: dictionaries')

  const t: Translate = (ctx.locale?.bind(NS) as Translate | undefined) ?? ((key: string) => key)

  const slots = ctx.slots
  if (typeof slots?.inject !== 'function' || typeof slots?.register !== 'function') return

  /*
   * The two entry toggles live in the plugin's Config and arrive through
   * `probe`.
   *
   * `apply` must register synchronously: the shell boots from its return, and a
   * plugin that waits on the network before registering would leave its slots
   * empty (or worse, hold the boot). So everything is registered up front and
   * the toggles *remove* what the user turned off once the Host answers.
   *
   * Fail-open by design: if the Host never answers, both entries stay visible.
   * A UI that appears when the user asked to hide it is a lesser failure than a
   * UI that never appears at all.
   */

  // Each entry is (un)registered by a pair of closures, so a toggle can undo
  // itself without a reload. `slots.inject`'s disposer is permanent, so the
  // only way to bring an entry back is to register it again.
  const entries: Record<'page' | 'drawer', {
    on: () => void
    off: () => void
    live: () => boolean
  }> = {
    page: { on: () => {}, off: () => {}, live: () => true },
    drawer: { on: () => {}, off: () => {}, live: () => true },
  }

  // 1. The workbench page. `sidebar.panellist` owns the row and the shell
  //    selects the matching `main` key — no manual navigation call needed.
  let offSidebarRow: (() => void) | null = slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_KEY,
    order: 20,
    label: () => t('entry.label'),
    locale: NS,
  }, (owner: { size?: number; active?: boolean }) => EntryIcon({ size: owner?.size ?? 16 })))
  let offPage: (() => void) | null = slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_KEY,
    locale: NS,
  }, () => StudioPage({ t })))
  entries.page = {
    on: () => {
      if (offSidebarRow !== null || offPage !== null) return
      offSidebarRow = slots.inject('sidebar.panellist', () => slots.register({
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: 20,
        label: () => t('entry.label'),
        locale: NS,
      }, (owner: { size?: number; active?: boolean }) => EntryIcon({ size: owner?.size ?? 16 })))
      offPage = slots.inject('main', () => slots.register({
        name: 'main',
        key: PANEL_KEY,
        locale: NS,
      }, () => StudioPage({ t })))
    },
    off: () => {
      if (typeof offSidebarRow === 'function') offSidebarRow()
      if (typeof offPage === 'function') offPage()
      offSidebarRow = null
      offPage = null
    },
    live: () => offSidebarRow !== null || offPage !== null,
  }
  safeEffect(ctx, () => () => {
    if (typeof offSidebarRow === 'function') offSidebarRow()
    if (typeof offPage === 'function') offPage()
  }, 'agnes-media: sidebar row')

  // 2. Quick access from a conversation header.
  //
  // This registration is session-scoped, so its `inject` runs whenever a
  // conversation is open — whether or not the drawer is open. It is therefore
  // the plugin's authoritative source of "which conversation am I in", and it
  // publishes the send channel for every seat, including the workbench page.
  //
  // It is never removed: "发送到对话" depends on the channel it publishes, not
  // on the button. Only the button's rendering is gated.
  const offHeader = slots.inject('conversation.session.header.utilities', () => slots.register({
    name: 'conversation.session.header.utilities',
    id: 'agnes-media-quick',
    order: 20,
    locale: NS,
    inject: (sessionId?: string) => {
      setChannel(typeof sessionId === 'string' && sessionId.length > 0
        ? sendChannelFor(ctx, sessionId)
        : null)
      return {}
    },
  /*
   * The component always renders `QuickButton`, which decides for itself
   * whether to draw anything. Registering a conditional component here instead
   * would mean the registration's lifetime follows a UI toggle, and the
   * session channel this slot publishes would vanish with it.
   */
  }, () => QuickButton({ t })))
  safeEffect(ctx, () => offHeader, 'agnes-media: header button')

  // 3. The drawer, in the frame-wide overlay layer.
  let offDrawer: (() => void) | null = slots.inject(OVERLAY, () => slots.register({
    name: OVERLAY,
    id: 'agnes-media-drawer',
    order: 90,
    children: { [WORKSPACE]: { kind: 'single', scope: 'session' } },
  }, (props: { renderSlot?: (key: string, data: unknown) => unknown }) => DrawerSeat({ t, props })))

  // The drawer's child slot is a secondary source: it can only run while the
  // drawer is rendered, so it merely refreshes the channel while drawing.
  let offWorkspace: (() => void) | null = null
  const openWorkspace = (): void => {
    const disposer = slots.register({
      name: WORKSPACE,
      id: 'agnes-media-workspace',
      inject: (sessionId?: string) => {
        setSlotSend(typeof sessionId === 'string' && sessionId.length > 0
          ? sendChannelFor(ctx, sessionId)
          : null)
        return {}
      },
    }, () => null)
    offWorkspace = typeof disposer === 'function' ? (disposer as () => void) : null
  }
  openWorkspace()

  entries.drawer = {
    on: () => {
      if (offDrawer !== null) return
      offDrawer = slots.inject(OVERLAY, () => slots.register({
        name: OVERLAY,
        id: 'agnes-media-drawer',
        order: 90,
        children: { [WORKSPACE]: { kind: 'single', scope: 'session' } },
      }, (props: { renderSlot?: (key: string, data: unknown) => unknown }) => DrawerSeat({ t, props })))
      if (offWorkspace === null) openWorkspace()
    },
    off: () => {
      if (typeof offDrawer === 'function') offDrawer()
      offDrawer = null
      if (typeof offWorkspace === 'function') offWorkspace()
      offWorkspace = null
      setSlotSend(null)
    },
    live: () => offDrawer !== null,
  }
  safeEffect(ctx, () => (typeof offWorkspace === 'function' ? offWorkspace : () => {}), 'agnes-media: workspace slot')

  // 4. The two entry switches on the plugin's detail page.
  //
  // `plugins.detail.section` is the seat the Plugins page reserves for a
  // bundle's own configuration. This is the only place the user asked for the
  // switches to live, and it writes straight to the Host's preference store.
  safeEffect(ctx, () => slots.inject('plugins.detail.section', () => slots.register({
    name: 'plugins.detail.section',
    id: 'agnes-media-entries',
    order: 10,
    label: () => t('entries.title'),
    locale: NS,
  }, () => EntrySwitches({ t }))), 'agnes-media: entry switches')

  /*
   * Reconcile the two entries with the Host's stored state.
   *
   * Driven by the shared store, not by a poll: a switch in the plugin detail
   * page publishes synchronously, so the entry appears or disappears in the same
   * tick as the click. (A poll cannot do this — one that stops after the first
   * success never sees a later change, and one that runs forever still adds a
   * full interval of latency.)
   *
   * `entries.page.on()/.off()` are idempotent and reversible, so this is safe to
   * run on every change and at boot.
   */
  const applyEntries = (next: EntryPrefs): void => {
    drawerVisible = next.drawerEnabled
    if (next.pageEnabled) entries.page.on()
    else entries.page.off()
    if (next.drawerEnabled) entries.drawer.on()
    else entries.drawer.off()
  }

  safeEffect(ctx, () => subscribeEntryPrefs(() => {
    const next = getEntryPrefs()
    if (next !== null) applyEntries(next)
  }), 'agnes-media: entry sync')

  // Boot state. Fail-open: a Host that never answers leaves both entries on.
  void api.entries()
    .then((next) => setEntryPrefs(next))
    .catch(() => { /* fail-open: everything stays registered */ })
}

function safeEffect(ctx: ClientContext, callback: () => unknown, label: string): void {
  const effect = (ctx as { effect?: unknown }).effect
  if (typeof effect !== 'function') return
  try {
    (effect as (cb: () => unknown, label: string) => unknown).call(ctx, () => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : undefined
    }, label)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[agnes-media] ${label} failed:`, error)
  }
}

// --- seats ------------------------------------------------------------------

function StudioPage(props: { t: Translate }): React.ReactElement {
  const send = useSendChannel()
  return (
    <div data-agnes-root="" className="ag-page">
      <div className="ag-page-inner">
        <Studio t={props.t} variant="page" sendToChat={send ?? undefined} />
      </div>
    </div>
  )
}

function QuickButton(props: { t: Translate }): React.ReactElement | null {
  const open = useDrawer()
  const enabled = useEntryEnabled()
  // The registration itself stays alive — it carries the session channel that
  // "发送到对话" needs — so only the button is hidden.
  if (!enabled) return null
  return (
    <button
      type="button"
      className="ag-icon-btn"
      data-agnes-root=""
      aria-pressed={open}
      aria-label={props.t('entry.title')}
      title={props.t('entry.title')}
      onClick={() => toggleDrawer()}
    >
      <EntryIcon size={16} />
    </button>
  )
}

/** True while the in-chat drawer entry is enabled; re-renders on every change. */
function useEntryEnabled(): boolean {
  const [enabled, setEnabled] = useState(() => getEntryPrefs()?.drawerEnabled ?? true)
  useEffect(() => subscribeEntryPrefs(() => setEnabled(() => getEntryPrefs()?.drawerEnabled ?? true)), [])
  return enabled
}
function DrawerSeat(props: {
  t: Translate
  props: { renderSlot?: (key: string, data: unknown) => unknown }
}): React.ReactElement | null {
  const open = useDrawer()
  const send = useSendChannel()

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Touch the child slot on every render so its `inject` runs for the current
  // session; the returned value is unused (it only carries the send channel).
  useEffect(() => { void props.props.renderSlot?.(WORKSPACE, {}) })

  if (!open) return null
  return (
    <div data-agnes-root="">
      <div className="ag-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />
      <aside className="ag-drawer" role="dialog" aria-modal="true" aria-label={props.t('panel.title')}>
        <Studio
          t={props.t}
          variant="drawer"
          onClose={() => setDrawer(false)}
          sendToChat={send ?? undefined}
        />
      </aside>
    </div>
  )
}

export { renderForChat }
