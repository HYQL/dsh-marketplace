/**
 * Agnes HTTP transport — fetch with timeout, retry, and typed errors.
 *
 * Two error envelopes exist on this gateway and both are surfaced verbatim:
 *   • OpenAI style: `{ "error": { "message": "...", "code": "..." } }`
 *   • FastAPI validation style: `{ "detail": "size must be 720P" }`
 *
 * Retry policy: 5xx and network failures back off exponentially; 429 honours
 * `Retry-After` (Agnes throttles task polling on the free tier, so a 429 is a
 * "wait", not a failure). 4xx other than 429 is final.
 *
 * @module agnes-media/agnes/http
 */

import type { AgnesApiError, AgnesConfig, AgnesCredentials } from '../types.ts'

export class AgnesHttpError extends Error {
  readonly status: number
  readonly statusText: string
  readonly body: unknown
  readonly retryAfterMs: number | null
  constructor(status: number, statusText: string, body: unknown, message?: string, retryAfterMs: number | null = null) {
    super(message ?? `agnes-media: HTTP ${status} ${statusText}`)
    this.name = 'AgnesHttpError'
    this.status = status
    this.statusText = statusText
    this.body = body
    this.retryAfterMs = retryAfterMs
  }
  toApiError(): AgnesApiError {
    return { status: this.status, statusText: this.statusText, body: this.body, message: this.message }
  }
}

export async function agnesPost<T>(
  url: string,
  body: unknown,
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>('POST', url, creds, config, signal, body)
}

export async function agnesGet<T>(
  url: string,
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<T> {
  return request<T>('GET', url, creds, config, signal, undefined)
}

/**
 * Agnes throttles the free tier per minute and answers 429 without a
 * `Retry-After` header. A 1–2 s backoff burns every attempt inside the same
 * window, so 429 waits on its own ladder: 6 s, 15 s, 30 s (capped).
 */
const RATE_LIMIT_BACKOFF_MS = [6_000, 15_000, 30_000] as const

async function request<T>(
  method: 'POST' | 'GET',
  url: string,
  creds: AgnesCredentials,
  config: AgnesConfig,
  callerSignal: AbortSignal | undefined,
  body: unknown,
): Promise<T> {
  const attempts = Math.max(1, config.maxRetries + 1)
  let lastError: unknown = null
  let rateLimitHits = 0
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const hinted = lastError instanceof AgnesHttpError ? lastError.retryAfterMs : null
      let wait = config.retryBackoffMs * 2 ** (attempt - 1)
      if (lastError instanceof AgnesHttpError && lastError.status === 429) {
        const ladder = RATE_LIMIT_BACKOFF_MS[Math.min(rateLimitHits, RATE_LIMIT_BACKOFF_MS.length - 1)]
        wait = hinted ?? ladder
      } else if (hinted !== null) {
        wait = Math.min(hinted, 30_000)
      }
      await sleep(wait, callerSignal)
    }
    try {
      return await once<T>(method, url, body, creds, config, callerSignal)
    } catch (e) {
      lastError = e
      if (e instanceof AgnesHttpError && e.status === 429) rateLimitHits++
      if (!isRetryable(e, callerSignal)) break
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`agnes-media: request failed (${String(lastError)})`)
}

async function once<T>(
  method: 'POST' | 'GET',
  url: string,
  body: unknown,
  creds: AgnesCredentials,
  config: AgnesConfig,
  callerSignal: AbortSignal | undefined,
): Promise<T> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  callerSignal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${creds.apiKey}`,
      'Accept': 'application/json',
    }
    if (method === 'POST') headers['Content-Type'] = 'application/json'
    const init: RequestInit = { method, headers, signal: controller.signal }
    if (method === 'POST' && body !== undefined) init.body = JSON.stringify(body)

    const res = await fetch(url, init)
    const text = await res.text()
    const parsed = parseBody(text)
    if (!res.ok) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
      throw new AgnesHttpError(res.status, res.statusText, parsed, describe(res.status, parsed), retryAfter)
    }
    return parsed as T
  } finally {
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onAbort)
  }
}

function parseRetryAfter(raw: string | null): number | null {
  if (raw === null || raw.length === 0) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const at = Date.parse(raw)
  if (Number.isFinite(at)) return Math.max(0, at - Date.now())
  return null
}

function parseBody(text: string): unknown {
  const t = text.trim()
  if (t.length === 0) return null
  try {
    return JSON.parse(t)
  } catch {
    return { _raw: t.slice(0, 2_000) }
  }
}

/**
 * Best-effort human message from either error envelope.
 *
 * Two envelopes exist and the discriminator moves between them:
 *   • OpenAI style: `{ error: { message, code } }`
 *   • FastAPI validation style: `{ detail }` (string or list)
 *
 * `type` is accepted in BOTH positions — some deployments nest it inside
 * `error`, others put it at the top level (the live gateway does the latter for
 * "no available channel", where it is the only discriminator). Dropping it makes
 * an upstream channel failure look like a generic 400.
 */
export function describe(status: number, body: unknown): string {
  const b = body as {
    error?: { message?: string; code?: string; type?: string }
    detail?: unknown
    type?: unknown
  } | null
  const kind = typeof b?.error?.type === 'string' && b.error.type.length > 0
    ? b.error.type
    : (typeof b?.type === 'string' && b.type.length > 0 ? b.type : null)
  const err = b?.error
  if (err !== undefined && err !== null && typeof err.message === 'string' && err.message.length > 0) {
    const code = typeof err.code === 'string' && err.code.length > 0 ? err.code : kind
    return `HTTP ${status} — ${err.message}${code !== null ? ` [${code}]` : ''}`
  }
  const detail = b?.detail
  if (typeof detail === 'string' && detail.length > 0) {
    return `HTTP ${status} — ${detail}${kind !== null ? ` [${kind}]` : ''}`
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: unknown } | undefined
    if (first !== undefined && typeof first.msg === 'string') {
      return `HTTP ${status} — ${first.msg}${kind !== null ? ` [${kind}]` : ''}`
    }
  }
  const raw = (body as { _raw?: unknown } | null)?._raw
  if (typeof raw === 'string' && raw.length > 0) {
    return `HTTP ${status} — ${raw.slice(0, 300)}${kind !== null ? ` [${kind}]` : ''}`
  }
  return kind !== null ? `HTTP ${status} [${kind}]` : `HTTP ${status}`
}

function isRetryable(error: unknown, callerSignal: AbortSignal | undefined): boolean {
  if (callerSignal?.aborted) return false
  if (error instanceof AgnesHttpError) {
    if (error.status === 429) return true
    return error.status >= 500 && error.status <= 599
  }
  // Network-level failure (DNS, reset, TLS). An aborted request is not retried.
  if (error instanceof TypeError) return true
  if (error instanceof Error && error.name === 'AbortError') return false
  return false
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) { resolve(); return }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
}
