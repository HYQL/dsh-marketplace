/**
 * Shared state for the two entry toggles.
 *
 * The switches live in the plugin detail page; the slots they control are
 * registered by the plugin's entry point. Those are two different components in
 * two different parts of the shell, so they need a shared store — and a store
 * that *notifies*, because "点击开关立刻生效" cannot be met by polling:
 *
 *   • a poll that stops after the first success never sees a later change;
 *   • a poll that runs forever wastes a request every few seconds and still
 *     adds up to one interval of latency.
 *
 * A subscription gives the change to both sides in the same tick.
 *
 * @module agnes-media/client/entry-state
 */

import type { EntryPrefs } from './api.ts'

/** Both on, matching the Host's defaults. Used until the Host answers. */
export const DEFAULT_ENTRIES: EntryPrefs = { pageEnabled: true, drawerEnabled: true }

let cache: EntryPrefs | null = null
const listeners = new Set<() => void>()

export function getEntryPrefs(): EntryPrefs | null {
  return cache
}

/** Publish a new value; no-op when nothing actually changed. */
export function setEntryPrefs(next: EntryPrefs): void {
  if (cache !== null
    && cache.pageEnabled === next.pageEnabled
    && cache.drawerEnabled === next.drawerEnabled) {
    return
  }
  cache = next
  for (const listener of listeners) listener()
}

export function subscribeEntryPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
