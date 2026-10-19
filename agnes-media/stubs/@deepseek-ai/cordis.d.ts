// Minimal stand-ins for the DSH packages this plugin compiles against.
// Real types come from the host profile at runtime.
export interface Context {
  tools: { register(tool: unknown): () => void }
  provide(name: string, value: unknown): () => void
  inject(deps: string[], cb: (ctx: Context) => void): void
  on(event: string, listener: () => void): void
  effect(cb: () => void | (() => void), label?: string): () => void
  get(name: string): unknown | undefined
}
