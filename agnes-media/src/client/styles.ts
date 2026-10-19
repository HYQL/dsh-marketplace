/**
 * Theme-aware styling for the Agnes panel.
 *
 * Rules this file follows:
 *   • Only `--dsw-alias-*` theme tokens carry colour; every other colour is
 *     derived from a token with `color-mix`, so light/dark switching needs no
 *     extra rule here.
 *   • EVERY selector is prefixed with `[data-agnes-root]`, so the shell is never
 *     restyled and no global class name is emitted.
 *   • The stylesheet is inserted once and removed by its disposer.
 *
 * @module agnes-media/client/styles
 */

const STYLE_ID = 'agnes-media-styles'

const CSS = `
[data-agnes-root] {
  --ag-bg: var(--dsw-alias-bg-layer-1, #1e1e20);
  --ag-bg-soft: var(--dsw-alias-bg-layer-2, #26262a);
  --ag-overlay: var(--dsw-alias-bg-overlay, #2a2a2e);
  --ag-fg: var(--dsw-alias-label-primary, #f2f2f5);
  --ag-fg-soft: var(--dsw-alias-label-secondary, #a8a8b3);
  --ag-border: var(--dsw-alias-border-l1, rgba(255,255,255,.10));
  --ag-border-strong: var(--dsw-alias-border-l2, rgba(255,255,255,.18));
  --ag-accent: var(--dsw-alias-brand-primary, #6ea8fe);
  --ag-accent-soft: color-mix(in srgb, var(--ag-accent) 16%, transparent);
  --ag-accent-line: color-mix(in srgb, var(--ag-accent) 45%, transparent);
  /*
   * Text that sits ON the accent fill. The app's base background is the
   * complement of the accent in every theme — near-white on a light theme's
   * saturated blue, near-black on a dark theme's pastel blue — so it is the one
   * token that always contrasts. A literal #fff fails in dark mode, where the
   * brand colour is light.
   */
  --ag-on-accent: var(--dsw-alias-bg-base, #0b1220);
  --ag-error: var(--dsw-alias-state-error-primary, #f87171);
  --ag-success: var(--dsw-alias-state-success-primary, #34d399);
  --ag-warn: var(--dsw-alias-state-warn-primary, #fbbf24);
  --ag-idle: var(--dsw-alias-state-idle-primary, #6b7280);
  --ag-radius: 10px;
  --ag-radius-sm: 7px;
  --ag-shadow: 0 18px 48px -12px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.18);
  color-scheme: light dark;
}

/* ---------- studio shell ---------- */
[data-agnes-root] .ag-studio { display: flex; flex-direction: column; min-height: 0; height: 100%; width: 100% }
[data-agnes-root] .ag-studio-drawer { flex: 1 }
[data-agnes-root] .ag-studio-page { max-width: 760px; margin: 0 auto; height: auto; min-height: 100% }
[data-agnes-root].ag-page {
  height: 100%; overflow-y: auto; background: var(--dsw-alias-bg-base, transparent);
  color: var(--ag-fg); padding: 22px 20px 28px; box-sizing: border-box;
}
[data-agnes-root] .ag-page-inner { max-width: 760px; margin: 0 auto }
[data-agnes-root] .ag-studio-page .ag-body { overflow: visible; padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-head { padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-tabs { padding-left: 0 }
[data-agnes-root] .ag-studio-page .ag-foot { padding-left: 0; padding-right: 0 }
[data-agnes-root] .ag-studio-page .ag-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)) }

/* ---------- drawer ---------- */
[data-agnes-root] .ag-scrim {
  position: fixed; inset: 0; z-index: 9997;
  background: color-mix(in srgb, #000 32%, transparent);
  backdrop-filter: blur(1.5px);
  animation: ag-fade .14s ease-out;
}
[data-agnes-root] .ag-drawer {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 9998;
  width: min(432px, 100vw);
  display: flex; flex-direction: column;
  background: var(--ag-bg);
  color: var(--ag-fg);
  border-left: 1px solid var(--ag-border-strong);
  box-shadow: var(--ag-shadow);
  font-size: 13px; line-height: 1.45;
  animation: ag-slide .18s cubic-bezier(.2,.7,.3,1);
}
[data-agnes-root] .ag-drawer > .ag-studio { flex: 1; min-height: 0 }
@keyframes ag-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes ag-slide { from { transform: translateX(16px); opacity: .4 } to { transform: none; opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  [data-agnes-root] .ag-drawer, [data-agnes-root] .ag-scrim { animation: none }
}

/* ---------- header ---------- */
[data-agnes-root] .ag-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--ag-border);
}
[data-agnes-root] .ag-head-icon {
  width: 30px; height: 30px; border-radius: 9px; flex: 0 0 30px;
  display: grid; place-items: center;
  background: var(--ag-accent-soft); color: var(--ag-accent);
}
[data-agnes-root] .ag-head-text { display: flex; flex-direction: column; min-width: 0; flex: 1 }
[data-agnes-root] .ag-head-title { font-size: 13px; font-weight: 600; letter-spacing: .01em }
[data-agnes-root] .ag-head-sub { font-size: 11px; color: var(--ag-fg-soft); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
[data-agnes-root] .ag-icon-btn,
[data-agnes-root].ag-icon-btn {
  appearance: none; border: 1px solid transparent; background: transparent;
  color: var(--ag-fg-soft); cursor: pointer; border-radius: var(--ag-radius-sm);
  width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 28px;
  padding: 0;
}
[data-agnes-root] .ag-icon-btn:hover,
[data-agnes-root].ag-icon-btn:hover { color: var(--ag-fg); background: var(--ag-bg-soft); border-color: var(--ag-border) }
[data-agnes-root] .ag-icon-btn:focus-visible,
[data-agnes-root].ag-icon-btn:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 1px }

/* ---------- tabs ---------- */
[data-agnes-root] .ag-tabs { display: flex; gap: 2px; padding: 8px 12px 0 }
[data-agnes-root] .ag-tab {
  appearance: none; border: none; background: transparent; cursor: pointer;
  color: var(--ag-fg-soft); font: inherit; font-size: 12px;
  padding: 6px 12px 8px; border-radius: 8px 8px 0 0; position: relative;
  display: inline-flex; align-items: center; gap: 6px;
}
[data-agnes-root] .ag-tab:hover { color: var(--ag-fg) }
[data-agnes-root] .ag-tab[data-active="true"] { color: var(--ag-fg); font-weight: 600 }
[data-agnes-root] .ag-tab[data-active="true"]::after {
  content: ''; position: absolute; left: 10px; right: 10px; bottom: 0; height: 2px;
  border-radius: 2px; background: var(--ag-accent);
}
[data-agnes-root] .ag-tab-badge {
  font-size: 10px; padding: 0 5px; border-radius: 8px; line-height: 15px;
  background: var(--ag-accent-soft); color: var(--ag-accent);
}

/* ---------- body ---------- */
[data-agnes-root] .ag-body { flex: 1; overflow-y: auto; padding: 12px 14px 18px; display: flex; flex-direction: column; gap: 12px }
[data-agnes-root] .ag-body::-webkit-scrollbar { width: 10px }
[data-agnes-root] .ag-body::-webkit-scrollbar-thumb {
  background-color: color-mix(in srgb, var(--ag-fg-soft) 34%, transparent);
  border: 3px solid transparent; background-clip: padding-box; border-radius: 8px;
}

[data-agnes-root] .ag-field { display: flex; flex-direction: column; gap: 6px }
[data-agnes-root] .ag-label { font-size: 11px; color: var(--ag-fg-soft); font-weight: 500; letter-spacing: .02em }
[data-agnes-root] .ag-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px }
[data-agnes-root] .ag-value { font-size: 11px; color: var(--ag-fg-soft); font-variant-numeric: tabular-nums }

[data-agnes-root] .ag-textarea,
[data-agnes-root] .ag-input {
  width: 100%; box-sizing: border-box; font: inherit; font-size: 13px;
  color: var(--ag-fg); background: var(--ag-bg-soft);
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius-sm);
  padding: 8px 10px; transition: border-color .12s, box-shadow .12s;
}
[data-agnes-root] .ag-textarea { min-height: 88px; resize: vertical; line-height: 1.5 }
[data-agnes-root] .ag-input { padding: 6px 8px; font-size: 12px }
[data-agnes-root] .ag-textarea::placeholder,
[data-agnes-root] .ag-input::placeholder { color: color-mix(in srgb, var(--ag-fg-soft) 72%, transparent) }
[data-agnes-root] .ag-textarea:focus,
[data-agnes-root] .ag-input:focus {
  outline: none; border-color: var(--ag-accent);
  box-shadow: 0 0 0 3px var(--ag-accent-soft);
}
[data-agnes-root] .ag-textarea:disabled,
[data-agnes-root] .ag-input:disabled { opacity: .55; cursor: not-allowed }

/* ---------- chips ---------- */
[data-agnes-root] .ag-chips { display: flex; flex-wrap: wrap; gap: 6px }
[data-agnes-root] .ag-chip {
  appearance: none; cursor: pointer; font: inherit; font-size: 11.5px;
  padding: 5px 10px; border-radius: 999px;
  border: 1px solid var(--ag-border); background: transparent; color: var(--ag-fg-soft);
  transition: color .12s, border-color .12s, background .12s;
}
[data-agnes-root] .ag-chip:hover:not(:disabled) { color: var(--ag-fg); border-color: var(--ag-border-strong) }
[data-agnes-root] .ag-chip[data-active="true"] {
  color: var(--ag-accent); border-color: var(--ag-accent-line); background: var(--ag-accent-soft);
}
[data-agnes-root] .ag-chip:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-chip-ratio { display: inline-flex; align-items: center; gap: 6px }
[data-agnes-root] .ag-ratio-box {
  display: inline-block; border: 1.5px solid currentColor; border-radius: 2px; opacity: .85;
}

/* ---------- segmented ---------- */
[data-agnes-root] .ag-seg { display: flex; padding: 2px; gap: 2px; background: var(--ag-bg-soft);
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius-sm) }
[data-agnes-root] .ag-seg-item {
  flex: 1; appearance: none; border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 11.5px; color: var(--ag-fg-soft); padding: 5px 6px; border-radius: 5px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
[data-agnes-root] .ag-seg-item:hover:not([data-active="true"]) { color: var(--ag-fg) }
[data-agnes-root] .ag-seg-item[data-active="true"] { background: var(--ag-bg); color: var(--ag-fg); box-shadow: 0 1px 2px rgba(0,0,0,.12); font-weight: 500 }
[data-agnes-root] .ag-seg-item:disabled { opacity: .5; cursor: not-allowed }

/* ---------- advanced ---------- */
[data-agnes-root] .ag-disclosure {
  appearance: none; border: none; background: transparent; cursor: pointer; padding: 2px 0;
  display: flex; align-items: center; gap: 5px; font: inherit; font-size: 11.5px; color: var(--ag-fg-soft);
}
[data-agnes-root] .ag-disclosure:hover { color: var(--ag-fg) }
[data-agnes-root] .ag-advanced { display: flex; flex-direction: column; gap: 10px; padding: 10px;
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius) }

/* ---------- actions ---------- */
[data-agnes-root] .ag-actions { display: flex; align-items: center; gap: 8px }
[data-agnes-root] .ag-btn {
  appearance: none; font: inherit; font-size: 12.5px; cursor: pointer;
  border-radius: var(--ag-radius-sm); padding: 7px 14px; border: 1px solid var(--ag-border-strong);
  background: transparent; color: var(--ag-fg);
}
[data-agnes-root] .ag-btn:hover:not(:disabled) { background: var(--ag-bg-soft) }
[data-agnes-root] .ag-btn-primary {
  border-color: transparent; background: var(--ag-accent);
  color: var(--ag-on-accent); font-weight: 600; min-width: 108px;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px;
}
[data-agnes-root] .ag-btn-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ag-accent) 88%, var(--ag-on-accent));
}
/*
 * Disabled state for the primary action.
 *
 * A blanket opacity on a filled button drags the label toward the surface
 * behind it, so in dark mode the label and the fill converge on the same grey
 * and the text disappears. The disabled button therefore keeps an opaque
 * surface and gets its own legible label colour instead of being faded.
 *
 * The data-busy marker is the "generating…" state: it is disabled for input
 * purposes but it is live work, so it keeps the accent fill and the on-accent
 * label.
 */
[data-agnes-root] .ag-btn:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-btn-primary:disabled,
[data-agnes-root] .ag-btn-primary[aria-disabled="true"] {
  opacity: 1;
  background: var(--ag-bg-soft);
  border-color: var(--ag-border-strong);
  color: var(--ag-fg);
}
[data-agnes-root] .ag-btn-primary[data-busy="true"]:disabled {
  background: var(--ag-accent);
  border-color: transparent;
  color: var(--ag-on-accent);
  cursor: progress;
}
[data-agnes-root] .ag-btn-sm { padding: 4px 9px; font-size: 11.5px }

/* ---------- status ---------- */
[data-agnes-root] .ag-status { display: flex; align-items: center; gap: 7px; font-size: 11.5px; color: var(--ag-fg-soft); min-height: 18px }
[data-agnes-root] .ag-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ag-idle); flex: 0 0 7px }
[data-agnes-root] .ag-dot[data-tone="accent"] { background: var(--ag-accent) }
[data-agnes-root] .ag-dot[data-tone="success"] { background: var(--ag-success) }
[data-agnes-root] .ag-dot[data-tone="error"] { background: var(--ag-error) }
[data-agnes-root] .ag-dot[data-tone="warn"] { background: var(--ag-warn) }
[data-agnes-root] .ag-dot[data-pulse="true"] { animation: ag-pulse 1.4s ease-in-out infinite }
@keyframes ag-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

[data-agnes-root] .ag-alert {
  font-size: 12px; padding: 8px 10px; border-radius: var(--ag-radius-sm);
  border: 1px solid color-mix(in srgb, var(--ag-error) 40%, transparent);
  background: color-mix(in srgb, var(--ag-error) 12%, transparent);
  color: var(--ag-fg); white-space: pre-wrap; word-break: break-word;
}
[data-agnes-root] .ag-alert[data-tone="warn"] {
  border-color: color-mix(in srgb, var(--ag-warn) 40%, transparent);
  background: color-mix(in srgb, var(--ag-warn) 12%, transparent);
}

/* ---------- progress ---------- */
[data-agnes-root] .ag-progress { height: 3px; border-radius: 3px; background: var(--ag-bg-soft); overflow: hidden }
[data-agnes-root] .ag-progress-bar { height: 100%; background: var(--ag-accent); transition: width .4s ease }

/* ---------- history ---------- */
[data-agnes-root] .ag-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px }
[data-agnes-root] .ag-section-title { font-size: 11px; color: var(--ag-fg-soft); font-weight: 600; letter-spacing: .04em; text-transform: uppercase }
[data-agnes-root] .ag-empty {
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius);
  padding: 20px 14px; text-align: center; color: var(--ag-fg-soft); font-size: 12px;
  display: flex; flex-direction: column; gap: 4px;
}
[data-agnes-root] .ag-empty small { font-size: 11px; opacity: .8 }

[data-agnes-root] .ag-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px }
[data-agnes-root] .ag-card {
  border: 1px solid var(--ag-border); border-radius: var(--ag-radius); overflow: hidden;
  background: var(--ag-bg-soft); display: flex; flex-direction: column;
}
[data-agnes-root] .ag-card[data-status="failed"] { border-color: color-mix(in srgb, var(--ag-error) 45%, transparent) }
[data-agnes-root] .ag-thumb {
  position: relative; aspect-ratio: 16 / 10; background: var(--ag-bg);
  display: grid; place-items: center; overflow: hidden;
}
[data-agnes-root] .ag-thumb img,
[data-agnes-root] .ag-thumb video { width: 100%; height: 100%; object-fit: cover; display: block }
[data-agnes-root] .ag-thumb-icon { color: var(--ag-fg-soft); opacity: .55 }
[data-agnes-root] .ag-thumb-badge {
  position: absolute; left: 6px; top: 6px; font-size: 10px; line-height: 16px;
  padding: 0 6px; border-radius: 999px; background: color-mix(in srgb, #000 55%, transparent);
  color: #fff; backdrop-filter: blur(3px);
}
/* A second badge sits opposite the kind badge, so both stay readable. */
[data-agnes-root] .ag-thumb-badge[data-kind="agent"] {
  left: auto; right: 6px;
  background: color-mix(in srgb, var(--ag-accent) 78%, #000);
}
[data-agnes-root] .ag-card-body { padding: 7px 8px 8px; display: flex; flex-direction: column; gap: 5px; min-width: 0 }
[data-agnes-root] .ag-card-prompt {
  font-size: 11.5px; color: var(--ag-fg); display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
[data-agnes-root] .ag-card-meta { font-size: 10.5px; color: var(--ag-fg-soft); display: flex; gap: 6px; align-items: center; flex-wrap: wrap }
[data-agnes-root] .ag-card-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px }
[data-agnes-root] .ag-link-btn {
  appearance: none; border: none; background: transparent; cursor: pointer;
  font: inherit; font-size: 10.5px; padding: 2px 4px; border-radius: 4px; color: var(--ag-accent);
  text-decoration: none;
}
[data-agnes-root] .ag-link-btn:hover { background: var(--ag-accent-soft) }
[data-agnes-root] .ag-link-btn[data-tone="muted"] { color: var(--ag-fg-soft) }

[data-agnes-root] .ag-foot {
  padding: 8px 14px 10px; border-top: 1px solid var(--ag-border);
  font-size: 10.5px; color: var(--ag-fg-soft);
  display: flex; justify-content: space-between; gap: 8px; align-items: center;
}
[data-agnes-root] .ag-foot code { font-size: 10px; opacity: .8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60% }

/* ---------- reference images (image-to-image) ---------- */
[data-agnes-root] .ag-refs { display: flex; flex-wrap: wrap; gap: 6px }
[data-agnes-root] .ag-ref {
  position: relative; width: 56px; height: 56px; border-radius: 6px; overflow: hidden;
  border: 1px solid var(--ag-border); background: var(--ag-bg);
}
[data-agnes-root] .ag-ref img { width: 100%; height: 100%; object-fit: cover; display: block }
[data-agnes-root] .ag-ref-x {
  position: absolute; right: 2px; top: 2px; width: 16px; height: 16px; padding: 0;
  border: none; border-radius: 50%; cursor: pointer; font-size: 9px; line-height: 1;
  display: grid; place-items: center;
  background: color-mix(in srgb, #000 68%, transparent); color: #fff;
}
[data-agnes-root] .ag-ref-x:hover { background: var(--ag-error) }
[data-agnes-root] .ag-ref-x:disabled { opacity: .45; cursor: not-allowed }
[data-agnes-root] .ag-drop {
  border: 1px dashed var(--ag-border-strong); border-radius: var(--ag-radius-sm);
  padding: 10px; text-align: center; font-size: 11.5px; color: var(--ag-fg-soft); cursor: pointer;
}
[data-agnes-root] .ag-drop:hover,
[data-agnes-root] .ag-drop[data-over="true"] {
  border-color: var(--ag-accent); color: var(--ag-accent); background: var(--ag-accent-soft);
}
[data-agnes-root] .ag-drop:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 1px }

/* ---------- entry switches (bundle page section) ---------- */
[data-agnes-root] .ag-entries { display: flex; flex-direction: column; gap: 4px }
[data-agnes-root] .ag-entries-title {
  margin: 0 0 6px; font-size: 12px; font-weight: 600;
  color: var(--ag-fg); letter-spacing: .02em;
}
[data-agnes-root] .ag-entry-row {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 9px 0; border-bottom: 1px solid var(--ag-border);
}
[data-agnes-root] .ag-entry-row:last-of-type { border-bottom: none }
[data-agnes-root] .ag-entry-text { display: flex; flex-direction: column; gap: 2px; min-width: 0 }
[data-agnes-root] .ag-entry-label { font-size: 12.5px; color: var(--ag-fg) }
[data-agnes-root] .ag-entry-hint { font-size: 11px; color: var(--ag-fg-soft) }
[data-agnes-root] .ag-switch {
  appearance: none; border: none; cursor: pointer; flex: 0 0 38px;
  width: 38px; height: 22px; padding: 0; border-radius: 999px;
  background: var(--ag-bg-soft); border: 1px solid var(--ag-border-strong);
  position: relative; transition: background .14s, border-color .14s;
}
[data-agnes-root] .ag-switch-thumb {
  position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: var(--ag-fg-soft);
  transition: transform .14s, background .14s;
}
[data-agnes-root] .ag-switch[data-checked="true"] {
  background: var(--ag-accent); border-color: var(--ag-accent);
}
[data-agnes-root] .ag-switch[data-checked="true"] .ag-switch-thumb {
  transform: translateX(16px); background: var(--ag-on-accent);
}
[data-agnes-root] .ag-switch:disabled { opacity: .5; cursor: not-allowed }
[data-agnes-root] .ag-switch:focus-visible { outline: 2px solid var(--ag-accent); outline-offset: 2px }
[data-agnes-root] .ag-entries-note { margin: 6px 0 0; font-size: 11px; color: var(--ag-fg-soft) }
[data-agnes-root] .ag-entries-error { margin: 6px 0 0; font-size: 11.5px; color: var(--ag-error) }
`

/** Insert once; returns a disposer. */
export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
  return () => { el.remove() }
}
