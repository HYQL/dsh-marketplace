/**
 * Where the entry switches sit on the Plugins page, and how they stay there.
 *
 * ## The contract this file is written against (read from the shell)
 *
 * `slots.register` is strict, and the strictness is the whole story:
 *
 *   • a slot that no parent entry has declared is **not registerable** — it
 *     throws `slot "<name>" is not declared (a parent entry's children table
 *     must declare it)`. A cell can therefore only be mounted from inside
 *     `slots.inject('<name>', () => …)`, whose callback the shell invokes when
 *     the page finally declares the slot. That is what `inject` is for.
 *   • a second cell under the same keyed key at the same priority **throws** —
 *     `keyed slot "…" already has an entry for key "…" (registered by …)`.
 *     Nothing replaces anyone silently, so a cell can never be stolen; it can
 *     only fail to be registered.
 *   • an entry may carry `registrant`, which the ledger exposes for display and
 *     diagnostics. It is *not* an identity to match a plugin on.
 *
 * The failure mode is therefore never "our cell got taken". It is "our cell was
 * never registered", and every cause is knowable in advance:
 *
 *   1. the page had not been mounted when we called `register` (undeclared);
 *   2. the key is not the package name of any page that exists;
 *   3. a previous attempt of ours left a cell at that key, and registering it
 *      again throws.
 *
 * ## The rule
 *
 * Register once, from inside `inject`, under every key a page can dispatch, and
 * treat "already has an entry for key" as *success* — the only cell that error
 * can name at our keys is our own. Nothing is ever withdrawn: a live cell is
 * exactly what the page's `configured === ledger.bundles.has(pkg.name)` test
 * wants, and the disposer the shell returns is kept only so deactivation is
 * clean.
 *
 * @module agnes-media/client/seats
 */

/**
 * The bundle page the plugin's own row lives on.
 *
 * The plugin declares a bundle patch that inserts its one row, and the profile
 * selects it as a bundle, so the Plugins page gives it a real `PackageDetail`
 * with `configured === ledger.bundles.has('agnes-media')`. That page carries the
 * plugin's icon, description and row — it is the page a user opens — so it is
 * where the switches belong.
 */
export const OWN_BUNDLE = 'agnes-media'

/** The row the plugin's patch inserts. */
export const ROW_ID = 'agnes-media-studio'

/**
 * The optional companion bundle.
 *
 * It exists only to give the plugin a second page whose configuration section
 * is its own. Its patch declares no rows, so it is a container and nothing else.
 */
export const BUNDLE_KEY = '@local/agnes-media-bundle'

const BUNDLE_SLOT = 'plugins.bundle.config'

/**
 * The minimum of the client slot service this file needs.
 *
 * Declared structurally rather than imported so the shape cannot drift with a
 * package version; every member below is feature-detected at use.
 */
export interface SlotsLike {
  inject(name: string, callback: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
  entries?(name: string): ReadonlyArray<{ readonly options?: { readonly key?: string } }>
}

/** What the ledger says about our keys. */
export interface SeatReport {
  /** Keys whose cell the shell holds. */
  readonly holding: readonly string[]
  /** Keys with no live cell (the page is not mounted, or refused the cell). */
  readonly missing: readonly string[]
}

export interface SeatsOptions {
  /** The live slot service. */
  readonly slots: SlotsLike
  /** Keys to mount, most preferred first. */
  readonly keys: readonly string[]
  /** Locale namespace for the cell. */
  readonly locale: string
  /** Our name as the ledger records it. */
  readonly registrant: string
  /** Draws the cell for one key (and, when the page passes them, its props). */
  readonly render: (key: string, props: unknown) => unknown
  /** Diagnostic sink; must never throw. */
  readonly log?: (line: string, ...rest: unknown[]) => void
}

/**
 * Mount the switches under every key a page can dispatch.
 *
 * `mount` is called once, synchronously, from the plugin's activation — the same
 * shape the reference plugin uses. It registers an `inject` per key, so cells
 * appear when the page declares its slot and never before.
 */
export function createSeats(options: SeatsOptions): {
  mount: () => void
  report: () => SeatReport
  dispose: () => void
} {
  const { slots, keys, locale, registrant, render, log } = options

  const disposers: Array<() => void> = []
  /** Keys whose cell an earlier attempt already placed (success, then or now). */
  const settled = new Set<string>()
  let disposed = false

  /** Mount one cell; returns its disposer, or null when it was not placed. */
  const occupy = (key: string): (() => void) | null => {
    try {
      const seat = slots.register({
        name: BUNDLE_SLOT,
        key,
        locale,
        registrant,
      }, (props: unknown) => render(key, props))
      settled.add(key)
      return typeof seat === 'function' ? () => { (seat as () => void)() } : () => {}
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // The only cell that can already hold this key is ours: this plugin
      // registers at exactly these keys and nowhere else. Second pass, same
      // outcome — success.
      if (/already has an entry for key/i.test(message)) {
        settled.add(key)
        return () => {}
      }
      // Not declared yet: `inject` should prevent this, and if it happens the
      // next mount (a remount of the page) will place the cell.
      if (/is not declared/i.test(message)) return null
      log?.(`entry switches refused the seat "${key}":`, error)
      return null
    }
  }

  const mount = (): void => {
    if (disposed) return
    for (const key of keys) {
      // One `inject` per key, each guarded: the page declares the slot once and
      // then runs every pending callback, and a failure on one key must not cost
      // the others.
      try {
        const dispose = slots.inject(BUNDLE_SLOT, () => {
          const seat = occupy(key)
          if (seat !== null) disposers.push(seat)
          return () => { /* the cell lives as long as the page does */ }
        })
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
      } catch (error) {
        log?.(`cannot inject into ${BUNDLE_SLOT} for key "${key}":`, error)
      }
    }
  }

  /**
   * What the page's own ledger says.
   *
   * Read from `entries(BUNDLE_SLOT)` because that is the list the page projects
   * into `configured`; a cell we believe in but that is not in this list draws
   * nothing at all.
   */
  const report = (): SeatReport => {
    let present = new Set<string>()
    try {
      present = new Set((slots.entries?.(BUNDLE_SLOT) ?? [])
        .map((entry) => entry.options?.key)
        .filter((key): key is string => typeof key === 'string'))
    } catch {
      // Undeclared slot: nothing is on the page yet.
    }
    return {
      holding: keys.filter((key) => present.has(key)),
      missing: keys.filter((key) => !present.has(key)),
    }
  }

  return {
    mount,
    report,
    dispose: () => {
      disposed = true
      for (const dispose of disposers.splice(0).reverse()) {
        try { dispose() } catch { /* the slot may already be gone */ }
      }
      settled.clear()
    },
  }
}

/**
 * Every key the switches can be drawn under, most preferred first.
 *
 * `plugins.bundle.config` is drawn between a bundle page's description and its
 * rows, so the bundle cell is the one a user sees without a click. The row
 * cells exist because the same page offers a "configure" control on every
 * declared row, and that control opens `plugins.row.config` — a page that
 * renders nothing there would be worse than no control at all.
 *
 * @param bundles - bundle package names the Host reports (may be empty).
 * @returns keys, ordered, without duplicates.
 */
export function candidateKeys(bundles: readonly string[]): string[] {
  const keys: string[] = []
  const add = (key: string): void => { if (!keys.includes(key)) keys.push(key) }

  // 0. The page the plugin's row lives on — the one that always exists, because
  //    the plugin only loads at all when its own patch is selected.
  add(OWN_BUNDLE)
  add(`${OWN_BUNDLE}#${ROW_ID}`)

  // 1. The companion bundle's page, when installed.
  add(BUNDLE_KEY)
  add(`${BUNDLE_KEY}#${ROW_ID}`)

  // 2. Anything else that depends on this plugin (a rename, or a wrapper
  //    bundle). Naming it here is how the section survives that refactor.
  for (const name of bundles) add(name)
  for (const name of bundles) add(`${name}#${ROW_ID}`)

  return keys
}
