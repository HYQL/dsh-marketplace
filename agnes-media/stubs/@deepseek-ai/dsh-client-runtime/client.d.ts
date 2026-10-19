export interface Translate {
  (key: string): string
}
export interface LocaleService {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): Translate
}

/**
 * Registration options, mirroring the live shell (`dsh-client-ui-slots`).
 *
 * The three kind-specific keys are `id` (list), `key` (keyed) and `select`
 * (chain), so they are all optional here: a keyed slot takes `key`, and a stub
 * that insisted on `id` alone is what let a keyed cell be written against the
 * wrong shape. `registrant` is the name the ledger displays for the cell.
 */
export interface SlotRegistration {
  name: string
  id?: string
  key?: string
  locale?: string
  order?: number
  priority?: number
  label?: string | (() => string)
  children?: Record<string, unknown>
  inject?: (sessionId?: string) => Record<string, unknown>
  registrant?: string
}

export interface SlotsService {
  inject(key: string, cb: () => unknown): () => void
  register(spec: SlotRegistration, component: unknown): unknown
}
export interface ClientContext {
  locale: LocaleService
  slots: SlotsService
  sessions?: unknown
  effect(cb: () => void | (() => void), label: string): () => void
  get(name: string): unknown | undefined
  on(name: string, listener: (...args: never[]) => void): () => void
  provide(name: string, value: unknown): () => void
}
