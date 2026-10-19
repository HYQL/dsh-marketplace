/**
 * The two entry switches — the bundle page's configuration section.
 *
 * Two controls, one per entry point:
 *
 *   • **侧栏工作台** — the workbench page beside Plugins. The user's off switch
 *     for it — and, because the sidebar row is what opens this page, the only
 *     place it is ever drawn is the page it hides. It must therefore mount and
 *     toggle even while that entry is removed, which is why the component lives
 *     on `plugins.bundle.config` (a root seat on the bundle page) rather than
 *     inside the entry itself.
 *   • **会话内抽屉** — the ✨ button in a conversation header.
 *
 * Each switch is wired straight to the Host's preference store, so a change
 * takes effect in the same tick as the click, and survives a reload or restart.
 *
 * The page renders `view: 'page'` for that seat, so the section draws its own
 * heading and hands the host nothing to save: there is no draft here, every
 * click is already persisted.
 *
 * The controls are hand-written rather than imported from a Harness UI package:
 * those packages change without notice and a throwing component would blank the
 * whole section. Only `--dsw-alias-*` tokens carry colour.
 *
 * @module agnes-media/client/entries
 */

import { useCallback, useEffect, useState } from 'react'
import { api, type EntryPrefs } from './api.ts'
import { getEntryPrefs, setEntryPrefs, subscribeEntryPrefs } from './entry-state.ts'
import type { Translate } from './studio.tsx'

interface EntrySwitchProps {
  t: Translate
  /** The bundle page this cell was mounted under, for the support log line. */
  seat?: string
  /**
   * The page's props for this cell (`view`, and for a keyed cell its `form`).
   *
   * Accepted and deliberately unused: this section saves every click itself, so
   * it has no draft to hand back. Naming the props keeps the signature honest
   * against the slot contract rather than silently ignoring an argument.
   */
  hostProps?: unknown
}

interface RowProps {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange(next: boolean): void
}

export function EntrySwitches(props: EntrySwitchProps): React.ReactElement {
  const { t } = props
  const [prefs, setPrefs] = useState<EntryPrefs | null>(() => getEntryPrefs())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Follow the shared store, so this panel and the entry points never disagree.
  useEffect(() => subscribeEntryPrefs(() => setPrefs(() => getEntryPrefs())), [])

  useEffect(() => {
    let alive = true
    void api.entries()
      .then((value) => { if (alive) { setEntryPrefs(value); setError(null) } })
      .catch((e: unknown) => {
        // An unreachable Host must not lock the controls: the switches fall back
        // to the shipped default (both on) and stay clickable, so the page is
        // usable the moment the route answers again instead of showing two dead
        // toggles under an "HTTP 404".
        if (!alive) return
        if (getEntryPrefs() === null) setEntryPrefs({ pageEnabled: true, drawerEnabled: true })
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => { alive = false }
  }, [])

  const toggle = useCallback(async (key: keyof EntryPrefs, next: boolean): Promise<void> => {
    const current = prefs ?? getEntryPrefs()
    if (current === null || saving) return
    const previous = current
    // Optimistic: publish immediately so the entry appears or disappears in the
    // same tick as the click. The Host confirms afterwards.
    setEntryPrefs({ ...previous, [key]: next })
    setSaving(true)
    setError(null)
    try {
      setEntryPrefs(await api.setEntries({ [key]: next }))
    } catch (e) {
      setEntryPrefs(previous)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [prefs, saving])

  return (
    <section data-agnes-root="" className="ag-entries">
      <h3 className="ag-entries-title">{t('entries.title')}</h3>

      <Row
        label={t('entries.page')}
        hint={t('entries.page.hint')}
        checked={prefs?.pageEnabled ?? true}
        disabled={prefs === null || saving}
        onChange={(next) => void toggle('pageEnabled', next)}
      />
      <Row
        label={t('entries.drawer')}
        hint={t('entries.drawer.hint')}
        checked={prefs?.drawerEnabled ?? true}
        disabled={prefs === null || saving}
        onChange={(next) => void toggle('drawerEnabled', next)}
      />

      {error !== null ? <p className="ag-entries-error">{t('entries.hostDown')}</p> : null}
      {prefs !== null && !prefs.pageEnabled
        ? <p className="ag-entries-note">{t('entries.noPage')}</p>
        : null}
    </section>
  )
}

function Row(props: RowProps): React.ReactElement {
  const { label, hint, checked, disabled, onChange } = props
  return (
    <label className="ag-entry-row">
      <span className="ag-entry-text">
        <span className="ag-entry-label">{label}</span>
        <span className="ag-entry-hint">{hint}</span>
      </span>
      {/*
        role="switch" with aria-checked is the accessible pattern the host's own
        toggles use; the visual track is drawn from tokens.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="ag-switch"
        data-checked={checked ? 'true' : 'false'}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="ag-switch-thumb" />
      </button>
    </label>
  )
}
