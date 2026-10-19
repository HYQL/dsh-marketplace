/**
 * Agnes video generation (asynchronous).
 *
 * Contract (verified against the live gateway, 2026-10):
 *   create  POST {base}/v1/videos                     → { id, video_id, task_id, status }
 *   poll    GET  {base}/agnesapi?video_id=<id>[&model_name=<model>]
 *
 * `model_name` is required for keyframe/reference tasks and harmless for text
 * tasks, so this module always sends it. The `/v1/videos/{id}` endpoint exists
 * too, but it reports `queued`/`in_progress` while `/agnesapi` reports
 * `pending`/`processing`; only `/agnesapi` is the documented poll contract, so
 * it is the single poll path here (no probing, no 404 fallback guessing).
 *
 * Mode rules enforced by the gateway (400, no charge):
 *   text      → no media fields at all
 *   keyframe  → first_frame and/or last_frame; no images/audios
 *   reference → images (≤5) and/or audios (≤3); no first/last frame
 *
 * @module agnes-media/agnes/video
 */

import type { AgnesConfig, AgnesCredentials, VideoMode, VideoParams, VideoTask, VideoTaskStatus } from '../types.ts'
import { AgnesHttpError, agnesGet, agnesPost } from './http.ts'

export const VIDEO_SECONDS = ['4', '5', '6', '7', '8', '9', '10', '11', '12'] as const
export const MAX_REFERENCE_IMAGES = 5
export const MAX_REFERENCE_AUDIOS = 3

export function videoCreateEndpoint(creds: AgnesCredentials): string {
  return `${creds.videoBaseUrl.replace(/\/+$/, '')}/v1/videos`
}

export function videoPollEndpoint(creds: AgnesCredentials, videoId: string, model?: string | null): string {
  const base = `${creds.videoBaseUrl.replace(/\/+$/, '')}/agnesapi?video_id=${encodeURIComponent(videoId)}`
  return typeof model === 'string' && model.length > 0
    ? `${base}&model_name=${encodeURIComponent(model)}`
    : base
}

export class AgnesValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgnesValidationError'
  }
}

/** Normalize + validate a request into the exact wire payload. */
export function buildVideoPayload(params: VideoParams): Record<string, unknown> {
  const mode: VideoMode = params.mode ?? 'text'
  const seconds = String(params.seconds ?? '5')
  const secondsNum = Number.parseInt(seconds, 10)
  if (!Number.isFinite(secondsNum) || secondsNum < 4 || secondsNum > 12) {
    throw new AgnesValidationError(`seconds must be 4–12 (got "${seconds}")`)
  }

  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    mode,
    seconds: String(secondsNum),
    // Flash accepts only 720P; passing anything else is a 400.
    size: '720P',
  }
  if (params.aspect_ratio !== undefined && params.aspect_ratio.length > 0) payload.aspect_ratio = params.aspect_ratio
  if (params.seed !== undefined) payload.seed = params.seed
  if (params.negative_prompt !== undefined && params.negative_prompt.length > 0) {
    payload.negative_prompt = params.negative_prompt
  }

  const images = (params.images ?? params.reference_images ?? []).filter((u) => typeof u === 'string' && u.length > 0)
  const audios = (params.audios ?? []).filter((u) => typeof u === 'string' && u.length > 0)

  if (mode === 'keyframe') {
    if (params.first_frame === undefined && params.last_frame === undefined) {
      throw new AgnesValidationError('keyframe mode needs first_frame or last_frame')
    }
    if (images.length > 0 || audios.length > 0) {
      throw new AgnesValidationError('keyframe mode cannot carry images/audios')
    }
    if (params.first_frame !== undefined) payload.first_frame = params.first_frame
    if (params.last_frame !== undefined) payload.last_frame = params.last_frame
  } else if (mode === 'reference') {
    if (images.length === 0 && audios.length === 0) {
      throw new AgnesValidationError('reference mode needs images or audios')
    }
    if (params.first_frame !== undefined || params.last_frame !== undefined) {
      throw new AgnesValidationError('reference mode cannot carry first_frame/last_frame')
    }
    if (images.length > MAX_REFERENCE_IMAGES) {
      throw new AgnesValidationError(`reference images must not exceed ${MAX_REFERENCE_IMAGES}`)
    }
    if (audios.length > MAX_REFERENCE_AUDIOS) {
      throw new AgnesValidationError(`reference audios must not exceed ${MAX_REFERENCE_AUDIOS}`)
    }
    if (images.length > 0) payload.images = images
    if (audios.length > 0) payload.audios = audios
  } else if (images.length > 0 || audios.length > 0
    || params.first_frame !== undefined || params.last_frame !== undefined) {
    throw new AgnesValidationError('text mode cannot carry media fields')
  }

  return payload
}

export async function createVideoTask(
  params: VideoParams,
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<VideoTask> {
  return agnesPost<VideoTask>(videoCreateEndpoint(creds), buildVideoPayload(params), creds, config, signal)
}

/** Fetch a task's current state through the documented poll contract. */
export async function getVideoTask(
  videoId: string,
  creds: AgnesCredentials,
  config: AgnesConfig,
  model?: string | null,
  signal?: AbortSignal,
): Promise<VideoTask> {
  try {
    return await agnesGet<VideoTask>(videoPollEndpoint(creds, videoId, model), creds, config, signal)
  } catch (e) {
    // A model-name mismatch answers 400/404 on some deployments; retry bare.
    if (e instanceof AgnesHttpError && (e.status === 400 || e.status === 404)
      && typeof model === 'string' && model.length > 0) {
      return agnesGet<VideoTask>(videoPollEndpoint(creds, videoId, null), creds, config, signal)
    }
    throw e
  }
}

export interface PollOutcome {
  readonly task: VideoTask
  readonly timedOut: boolean
}

export interface PollOptions {
  readonly onProgress?: (task: VideoTask) => void
  /** Cancel polling without failing the task server-side. */
  readonly signal?: AbortSignal
}

/** Poll until the task settles or the deadline passes; honours abort. */
export async function pollVideoTask(
  videoId: string,
  creds: AgnesCredentials,
  config: AgnesConfig,
  model: string | null,
  options: PollOptions = {},
): Promise<PollOutcome> {
  const { onProgress, signal } = options
  const deadline = Date.now() + config.pollTimeoutMs
  let interval = config.pollIntervalMs
  for (;;) {
    if (signal?.aborted === true) throw new Error('agnes-media: video poll aborted')
    const task = await getVideoTask(videoId, creds, config, model, signal)
    onProgress?.(task)
    const status = normalizeStatus(task.status)
    if (status === 'completed' || status === 'failed') return { task, timedOut: false }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { task, timedOut: true }
    await sleep(Math.min(interval, remaining), signal)
    // Poll no faster than the configured interval; back off gently so a long
    // render does not hammer the free tier into 429s.
    interval = Math.min(interval + 3_000, 30_000)
  }
}

/**
 * The gateway reports `pending`/`processing` on `/agnesapi` and
 * `queued`/`in_progress` on `/v1/videos`; both vocabularies are folded here.
 */
export function normalizeStatus(s: string | undefined): VideoTaskStatus {
  switch (s) {
    case 'completed':
    case 'succeeded':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'canceled':
      return 'failed'
    case 'queued':
    case 'pending':
    case 'created':
      return 'queued'
    default:
      return 'in_progress'
  }
}

/** Human progress for a task, 0..100. */
export function progressOf(task: VideoTask): number {
  const raw = typeof task.progress === 'number' ? task.progress : 0
  if (!Number.isFinite(raw)) return 0
  return Math.min(100, Math.max(0, Math.round(raw)))
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) { resolve(); return }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
}
