export interface ToolSpec {
  name: string
  description: string
  parameters: unknown
  output: unknown
  execute(args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<string>
}
export function defineTool<T extends ToolSpec>(spec: T): T
