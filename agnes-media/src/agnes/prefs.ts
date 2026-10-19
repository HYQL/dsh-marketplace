/**
 * Entry-toggle preferences, persisted on the Host.
 *
 * Why not the bundle's `config`: that lives in `cordis.patch.yml`, so changing
 * it means editing YAML and restarting. The user asked for switches in the UI,
 * and a switch has to take effect here and now — so the value is stored next to
 * the job store and read on boot.
 *
 * The patch still wins when it says something: `pageEnabled: false` in the
 * patch is an administrator's decision that the UI switch must not override.
 * An absent patch value defaults to true and the stored preference applies.
 *
 * @module agnes-media/agnes/prefs
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

interface PrefFile {
  version: 1
  pageEnabled?: boolean
  drawerEnabled?: boolean
}

export interface EntryPrefs {
  pageEnabled: boolean
  drawerEnabled: boolean
}

/** Both entries are on unless the patch or the stored file says otherwise. */
const DEFAULTS: EntryPrefs = { pageEnabled: true, drawerEnabled: true }

export class PrefStore {
  readonly #path: string
  #value: EntryPrefs = { ...DEFAULTS }
  /** Reads already in flight; `settled()` awaits them. */
  #pending: Promise<void> = Promise.resolve()

  constructor(dir: string) {
    this.#path = join(dir, 'entries.json')
  }

  load(): Promise<void> {
    const read = (async (): Promise<void> => {
      try {
        const parsed = JSON.parse(await readFile(this.#path, 'utf8')) as PrefFile
        if (typeof parsed?.pageEnabled === 'boolean') this.#value.pageEnabled = parsed.pageEnabled
        if (typeof parsed?.drawerEnabled === 'boolean') this.#value.drawerEnabled = parsed.drawerEnabled
      } catch {
        // No file (or unreadable): keep the defaults.
      }
    })()
    this.#pending = read
    return read
  }

  /**
   * Resolve once every read started so far has landed.
   *
   * `apply()` cannot await `load()` (activation is synchronous), so the stored
   * value is not known at the moment the route handler starts serving. The
   * entries endpoint awaits this first; otherwise the first answer after a
   * restart is the compiled-in default instead of what the user chose.
   */
  async settled(): Promise<void> {
    await this.#pending
  }

  get(): EntryPrefs {
    return { ...this.#value }
  }

  /**
   * Merge a patch override into the stored value.
   *
   * A patch that omits a key (or carries `null`) leaves the stored preference in
   * force; a patch that sets a boolean wins, so an administrator can pin an
   * entry. The resolved config always has both keys, so `null` — not "never
   * pass the object" — is what "the user decides" looks like here.
   */
  applyPatch(patch: { pageEnabled?: boolean | null; drawerEnabled?: boolean | null }): void {
    if (typeof patch.pageEnabled === 'boolean') this.#value.pageEnabled = patch.pageEnabled
    if (typeof patch.drawerEnabled === 'boolean') this.#value.drawerEnabled = patch.drawerEnabled
  }

  async set(next: Partial<EntryPrefs>): Promise<EntryPrefs> {
    if (typeof next.pageEnabled === 'boolean') this.#value.pageEnabled = next.pageEnabled
    if (typeof next.drawerEnabled === 'boolean') this.#value.drawerEnabled = next.drawerEnabled
    await this.#persist()
    return this.get()
  }

  async #persist(): Promise<void> {
    const body: PrefFile = { version: 1, ...this.#value }
    try {
      await mkdir(dirname(this.#path), { recursive: true })
      const tmp = `${this.#path}.${process.pid}.tmp`
      await writeFile(tmp, JSON.stringify(body), 'utf8')
      await rename(tmp, this.#path)
    } catch {
      // A failed write must not fail the toggle request; the value stays in
      // memory for this process.
    }
  }
}
