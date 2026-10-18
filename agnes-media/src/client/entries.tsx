/**
 * The plugin detail page's entry switches.
 *
 * Rendered into `plugins.detail.section`, which the Plugins page reserves for
 * a bundle's own configuration. Two switches, each wired straight to the Host's
 * preference store, so a change takes effect in the same tick as the click.
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
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
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

      {error !== null ? <p className="ag-entries-error">{error}</p> : null}
      <p className="ag-entries-note">{t('entries.note')}</p>
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
