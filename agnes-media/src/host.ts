/**
 * Agnes Media Studio — host half.
 *
 * Registers agent tools, owns the job runner (so a render survives a page
 * reload), and serves the browser panel over a prefix route. The client never
 * talks to Agnes directly: the API key stays in the host process.
 *
 * @module agnes-media/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {
  AgnesConfig,
  AgnesCredentials,
  AgnesMediaApi,
  ImageParams,
  ImageResult,
  Job,
  JobView,
  ProbeInfo,
  VideoParams,
  VideoResult,
  VideoTask,
  VideoTaskStatus,
} from './types.ts'
import { DEFAULT_CONFIG, resolveConfig } from './config.ts'
import { AgnesCredentialError, probeApiKey, resolveCredentials, type CredentialsLike } from './agnes/registry.ts'
import { generateImage } from './agnes/image.ts'
import { createVideoTask, getVideoTask, normalizeStatus, pollVideoTask, progressOf } from './agnes/video.ts'
import { listImageModels, listVideoModels } from './agnes/models.ts'
import { downloadUrl, expandHome, imageExt, isAgnesOrigin, pruneDownloads, resolveDownloadDir, videoExt } from './agnes/download.ts'
import { JobStore } from './agnes/jobs.ts'
import { PrefStore } from './agnes/prefs.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    agnesMedia?: AgnesMediaApi
  }
}

export const name = 'agnes-media'
export const version = '2.0.0'

/**
 * Services this half accesses on ctx.
 *
 * Cordis resolves `ctx.<service>` through a proxy: an undeclared service that
 * is not on an ancestor fiber's store throws
 * "cannot get property "<service>" without inject" and fails activation —
 * which fails the whole web boot. Every service touched below must be here.
 *
 * `credentials` is optional by contract (a profile without the credentials
 * service still resolves keys from the environment), so it is read with
 * `ctx.get('credentials')` rather than injected.
 */
export const inject = ['tools', 'webServer']
export const provide = ['agnesMedia']

/** Route prefix the browser panel calls. */
const API_PREFIX = '/agnes-media-studio/api'

/**
 * Ceiling for a media payload handed back to the browser as a data URI.
 *
 * The browser request body is capped at 32 MiB and base64 inflates by ~4/3, so
 * a reference image has to stay well under 24 MB even before that. A finished
 * Agnes image is a few MB at most, so this only rejects something unexpected.
 */
const MAX_INLINE_BYTES = 16 * 1024 * 1024

interface WebServerLike {
  register(spec: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingLike, res: ServerResponseLike) => Promise<void> | void
  }): () => void
}
interface IncomingLike {
  method?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  on(event: string, listener: (chunk: unknown) => void): unknown
}
interface ServerResponseLike {
  setHeader(name: string, value: string): void
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

export function apply(ctx: Context, config: unknown = DEFAULT_CONFIG): void {
  // Nothing here may throw. An exception during activation fails the entry's
  // fiber (state FAILED), which the web shell's boot check reports as
  // "<entry>: failed" and then fails the ENTIRE boot — stripping every
  // third-party bundle as recovery.
  try {
    applyInner(ctx, config)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[agnes-media] host apply() failed, degrading:', error)
  }
}

function applyInner(ctx: Context, config: unknown = DEFAULT_CONFIG): void {
  const cfg = resolveConfig(config)
  const downloadDir = resolveDownloadDir(cfg.downloadDir)
  const storeDir = cfg.storeDir !== null ? expandHome(cfg.storeDir) : resolveDownloadDir('~/.dsh/agnes-media')
  const store = storeDir !== null ? new JobStore(storeDir, cfg.maxHistory) : null
  void store?.load()

  // Entry toggles: the stored preference is what the detail-page switches edit.
  // The patch's explicit values are applied on top, so an administrator can pin
  // an entry the UI cannot override.
  const prefs = storeDir !== null ? new PrefStore(storeDir) : null
  prefs?.applyPatch(cfg)
  void prefs?.load()

  const credentials = readCredentials(ctx)
  const storeKey = (): string | null => storeDir
  // The bundle page key is a bundle *package name*, so the browser needs the
  // list this profile selects. The store lives under the DSH home
  // (`~/.dsh/agnes-media`), whose `profiles/` directory holds every profile
  // manifest; the one that lists this plugin is the one in force.
  const profileDir = resolveProfileDir(storeDir)

  let credsPromise: Promise<AgnesCredentials> | null = null
  const getCreds = (): Promise<AgnesCredentials> => {
    if (credsPromise === null) {
      credsPromise = resolveCredentials(cfg, credentials).catch((e) => {
        credsPromise = null
        throw e
      })
    }
    return credsPromise
  }

  // --- job runner -----------------------------------------------------------

  const running = new Map<string, AbortController>()
  /** Pending automatic rate-limit retries, cleared on dispose. */
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const RATE_LIMIT_RETRY_MS = [15_000, 45_000, 90_000] as const

  const view = (job: Job): JobView => ({
    ...job,
    ageSeconds: Math.max(0, Math.round((Date.now() - job.createdAt) / 1000)),
  })

  const runImageJob = async (job: Job, params: Partial<ImageParams>, signal: AbortSignal): Promise<void> => {
    store?.update(job.id, { status: 'running', phase: 'submitting', progress: 10 })
    const result = await api.generateImage({ ...params, prompt: params.prompt ?? job.prompt }, signal)
    const urls = result.images.map((i) => i.url).filter((u): u is string => typeof u === 'string' && u.length > 0)
    const downloads = result.downloads.filter((p): p is string => typeof p === 'string' && p.length > 0)
    if (urls.length === 0 && downloads.length === 0) throw new Error('gateway returned no image')
    store?.update(job.id, {
      status: 'completed',
      phase: 'done',
      progress: 100,
      urls,
      downloads,
      error: null,
      finishedAt: Date.now(),
    })
  }

  const runVideoJob = async (
    job: Job,
    params: Partial<VideoParams>,
    signal: AbortSignal,
    resumeVideoId?: string,
  ): Promise<void> => {
    const model = params.model ?? cfg.videoModel
    store?.update(job.id, { status: 'running', phase: 'submitting', progress: 5 })
    let videoId = resumeVideoId ?? null
    if (videoId === null) {
      const task = await api.generateVideo({ ...params, prompt: params.prompt ?? job.prompt }, { wait: false }, signal)
      videoId = task.videoId ?? task.taskId ?? null
      if (videoId === null) {
        if (task.status === 'completed' && task.url !== null) {
          store?.update(job.id, {
            status: 'completed', phase: 'done', progress: 100,
            urls: [task.url], downloads: task.downloadPath !== null ? [task.downloadPath] : [],
            error: null, finishedAt: Date.now(),
          })
          return
        }
        throw new Error(task.error ?? 'gateway returned no video id')
      }
      store?.update(job.id, { videoId, phase: 'polling', progress: 10 })
    } else {
      store?.update(job.id, { videoId, phase: 'polling', resumed: true })
    }

    const outcome = await pollVideoTask(videoId, await getCreds(), cfg, model, {
      signal,
      onProgress: (task) => {
        const status = normalizeStatus(task.status)
        store?.update(job.id, {
          status: status === 'queued' ? 'queued' : 'running',
          progress: Math.max(5, Math.min(95, progressOf(task))),
          phase: 'polling',
        })
      },
    })

    const result = await materializeVideo(outcome.task, model, downloadDir, signal, outcome.timedOut, await getCreds())
    if (result.status === 'completed' && result.url !== null) {
      store?.update(job.id, {
        status: 'completed',
        phase: 'done',
        progress: 100,
        urls: [result.url],
        downloads: result.downloadPath !== null ? [result.downloadPath] : [],
        error: null,
        finishedAt: Date.now(),
      })
      return
    }
    if (result.status === 'completed') {
      store?.update(job.id, {
        status: 'completed', phase: 'done', progress: 100, urls: [], downloads: [], error: null, finishedAt: Date.now(),
      })
      return
    }
    throw new Error(result.error ?? (outcome.timedOut ? 'polling timed out' : 'video generation failed'))
  }

  /**
   * Run one job body and own its lifecycle.
   *
   * The free tier answers 429 per minute with no `Retry-After`, and a video
   * task costs two calls (create + polls), so a rate limit is expected rather
   * than exceptional: it re-queues the same job with its stored parameters
   * after a widening delay instead of surfacing a failure the user has to
   * retry by hand. `MAX_AUTO_RETRIES` bounds it; a manual "retry" resets it.
   */
  const MAX_AUTO_RETRIES = 3
  const start = (job: Job, work: (signal: AbortSignal) => Promise<void>): void => {
    const controller = new AbortController()
    running.set(job.id, controller)
    void work(controller.signal)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        const aborted = controller.signal.aborted
        if (aborted) {
          store?.update(job.id, { status: 'cancelled', phase: 'error', error: null, finishedAt: Date.now() })
          return
        }
        const current = store?.get(job.id)
        const rateLimited = /rate_limit|429|速率限制|too many requests/i.test(message)
        const attempts = (current?.attempts ?? 0) + 1
        if (rateLimited && attempts <= MAX_AUTO_RETRIES) {
          const waitMs = RATE_LIMIT_RETRY_MS[Math.min(attempts - 1, RATE_LIMIT_RETRY_MS.length - 1)]
          store?.update(job.id, {
            status: 'queued',
            phase: 'queued',
            progress: Math.min(current?.progress ?? 0, 10),
            error: null,
            rateLimited: true,
            attempts,
            retryAt: Date.now() + waitMs,
            finishedAt: null,
          })
          const timer = setTimeout(() => {
            const fresh = store?.get(job.id)
            if (fresh === undefined || fresh.status !== 'queued') return
            store?.update(job.id, { status: 'running', phase: 'submitting', retryAt: null })
            const again = store?.get(job.id)
            if (again === undefined) return
            const params = { ...(again.params as Record<string, unknown>) }
            if (again.kind === 'image') {
              start(again, (signal) => runImageJob(again, { ...params, prompt: again.prompt } as Partial<ImageParams>, signal))
            } else {
              start(again, (signal) => runVideoJob(again, { ...params, prompt: again.prompt } as Partial<VideoParams>, signal))
            }
          }, waitMs)
          timers.add(timer)
          return
        }
        store?.update(job.id, {
          status: 'failed',
          phase: 'error',
          error: message,
          rateLimited,
          attempts,
          retryAt: null,
          finishedAt: Date.now(),
        })
      })
      .finally(() => {
        running.delete(job.id)
        if (downloadDir !== null) void pruneDownloads(downloadDir, cfg.keepDownloads).catch(() => {})
      })
  }

  const jobsApi: AgnesMediaApi['jobs'] = {
    async createImage(params) {
      const prompt = String(params.prompt ?? '').trim()
      if (prompt.length === 0) throw new Error('prompt is required')
      const model = params.model ?? cfg.imageModel
      const n = /^agnes-image-2\.5/i.test(model) ? 1 : (params.n ?? cfg.imageDefaults.n)
      const merged: Partial<ImageParams> = { ...params, prompt, model, n }
      const job = requireStore(store).add('image', prompt, model, stripPrompt(merged))
      start(job, (signal) => runImageJob(job, merged, signal))
      return view(job)
    },
    async createVideo(params) {
      const prompt = String(params.prompt ?? '').trim()
      const mode = params.mode ?? 'text'
      if (prompt.length === 0 && mode === 'text') throw new Error('prompt is required')
      const model = params.model ?? cfg.videoModel
      const merged: Partial<VideoParams> = { ...params, prompt, model }
      const job = requireStore(store).add('video', prompt, model, stripPrompt(merged))
      start(job, (signal) => runVideoJob(job, merged, signal))
      return view(job)
    },
    list() {
      return (store?.list() ?? []).map(view)
    },
    cancel(id) {
      const controller = running.get(id)
      if (controller !== undefined) {
        controller.abort()
        return
      }
      // Not running here: a resumed-but-idle job just becomes cancelled.
      const job = store?.get(id)
      if (job !== undefined && (job.status === 'interrupted' || job.status === 'queued')) {
        store?.update(id, { status: 'cancelled', phase: 'error', finishedAt: Date.now() })
      }
    },
    remove(id) {
      const controller = running.get(id)
      controller?.abort()
      running.delete(id)
      store?.remove(id)
    },
    clear() {
      for (const controller of running.values()) controller.abort()
      running.clear()
      store?.clear()
    },
    retry(id) {
      const job = store?.get(id)
      if (job === undefined || running.has(id)) return undefined
      const params = { ...(job.params as Record<string, unknown>) } as Partial<ImageParams> & Partial<VideoParams>
      store?.update(id, {
        status: 'queued',
        phase: 'queued',
        progress: 0,
        error: null,
        urls: [],
        downloads: [],
        videoId: null,
        finishedAt: null,
        resumed: false,
        attempts: 0,
        retryAt: null,
        rateLimited: false,
      })
      const fresh = store?.get(id)
      if (fresh === undefined) return undefined
      if (job.kind === 'image') {
        start(fresh, (signal) => runImageJob(fresh, { ...params, prompt: job.prompt }, signal))
      } else {
        start(fresh, (signal) => runVideoJob(fresh, { ...params, prompt: job.prompt }, signal))
      }
      return view(fresh)
    },
    resume(id) {
      return resumeJob(id)
    },
    async wait(id, signal) {
      const deadline = Date.now() + cfg.pollTimeoutMs + 60_000
      for (;;) {
        const job = store?.get(id)
        if (job === undefined) return undefined
        if (job.status !== 'queued' && job.status !== 'running') return view(job)
        if (Date.now() > deadline) return view(job)
        if (signal?.aborted === true) return view(job)
        await delay(500)
      }
    },

    async inlineReference(id) {
      const job = store?.get(id)
      if (job === undefined) throw new Error('agnes-media: job not found')
      const url = job.urls[0]
      if (url === undefined || url.length === 0) throw new Error('agnes-media: job has no media to reuse')
      const creds = await getCreds()
      const res = await fetch(url, isAgnesOrigin(url) ? { headers: { Authorization: `Bearer ${creds.apiKey}` } } : {})
      if (!res.ok) throw new Error(`agnes-media: fetching the media failed (HTTP ${res.status})`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > MAX_INLINE_BYTES) {
        throw new Error(`agnes-media: media too large to inline (${Math.round(buf.length / 1024 / 1024)}MB > ${MAX_INLINE_BYTES / 1024 / 1024}MB)`)
      }
      const mime = res.headers.get('content-type')?.split(';')[0] ?? 'image/png'
      return {
        dataUri: `data:${mime};base64,${buf.toString('base64')}`,
        name: `reference-${job.id.slice(-6)}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`,
        kind: job.kind,
      }
    },
  }

  /** Continue polling a video task that is still running server-side. */
  const resumeJob = (id: string): JobView | undefined => {
    const job = store?.get(id)
    if (job === undefined || job.kind !== 'video' || job.videoId === null) return undefined
    if (running.has(id)) return view(job)
    const params = { ...(job.params as Partial<VideoParams>), model: job.model, prompt: job.prompt }
    store?.update(id, { status: 'running', phase: 'polling', error: null, resumed: true, finishedAt: null })
    const current = store?.get(id)
    if (current !== undefined) start(current, (signal) => runVideoJob(current, params, signal, job.videoId ?? undefined))
    const after = store?.get(id)
    return after === undefined ? undefined : view(after)
  }

  const api: AgnesMediaApi = {
    async generateImage(params = {}, signal) {
      const creds = await getCreds()
      const model = params.model ?? cfg.imageModel
      // 2.5-series only ever returns one image per call.
      const n = /^agnes-image-2\.5/i.test(model) ? 1 : (params.n ?? cfg.imageDefaults.n)
      const merged: ImageParams = {
        model,
        prompt: String(params.prompt ?? ''),
        size: params.size ?? cfg.imageDefaults.size,
        ratio: params.ratio ?? cfg.imageDefaults.ratio,
        n,
        ...(params.image !== undefined ? { image: params.image } : {}),
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
        ...(params.negative_prompt !== undefined ? { negative_prompt: params.negative_prompt } : {}),
        ...(params.return_base64 !== undefined ? { return_base64: params.return_base64 } : {}),
        ...(params.extra_body !== undefined ? { extra_body: params.extra_body } : {}),
      }
      const res = await generateImage(merged, creds, cfg, signal)
      return materializeImage(res.data ?? [], model, downloadDir, signal, cfg, creds)
    },

    async generateVideo(params = {}, options = {}, signal) {
      const creds = await getCreds()
      const model = params.model ?? cfg.videoModel
      const seconds = normalizeSeconds(params.seconds ?? cfg.videoDefaults.seconds)
      const merged: VideoParams = {
        model,
        prompt: String(params.prompt ?? ''),
        mode: params.mode ?? 'text',
        seconds,
        size: '720P',
        aspect_ratio: params.aspect_ratio ?? cfg.videoDefaults.ratio,
        ...(typeof params.image === 'string' ? { image: params.image } : {}),
        ...(params.first_frame !== undefined ? { first_frame: params.first_frame } : {}),
        ...(params.last_frame !== undefined ? { last_frame: params.last_frame } : {}),
        ...(params.images !== undefined ? { images: params.images } : {}),
        ...(params.reference_images !== undefined ? { reference_images: params.reference_images } : {}),
        ...(params.audios !== undefined ? { audios: params.audios } : {}),
        ...(params.seed !== undefined ? { seed: params.seed } : {}),
        ...(params.negative_prompt !== undefined ? { negative_prompt: params.negative_prompt } : {}),
        ...(params.from_image_prompt !== undefined ? { from_image_prompt: params.from_image_prompt } : {}),
        ...(params.from_image_model !== undefined ? { from_image_model: params.from_image_model } : {}),
      }

      // One-step image-to-video: render the keyframe first, then feed its public
      // URL as first_frame (the documented workaround for local-only assets).
      let wire: VideoParams = merged
      if (merged.mode !== 'reference' && merged.first_frame === undefined
        && merged.last_frame === undefined && typeof merged.from_image_prompt === 'string'
        && merged.from_image_prompt.length > 0) {
        const keyframe = await generateImage({
          model: merged.from_image_model ?? cfg.imageModel,
          prompt: merged.from_image_prompt,
          size: '1K',
          ratio: merged.aspect_ratio ?? cfg.videoDefaults.ratio,
          return_base64: false,
        }, creds, cfg, signal)
        const url = keyframe.data.find((i) => typeof i.url === 'string' && i.url.length > 0)?.url
        if (url === undefined) throw new Error('agnes-media: keyframe generation returned no public URL')
        wire = { ...merged, mode: 'keyframe', first_frame: url }
      }

      const task = await createVideoTask(wire, creds, cfg, signal)
      const videoId = task.video_id ?? task.id ?? task.task_id ?? null
      if (videoId === null || options.wait === false) {
        return await materializeVideo(task, model, downloadDir, signal, false, creds)
      }
      const outcome = await pollVideoTask(videoId, creds, cfg, model, { signal })
      return await materializeVideo(outcome.task, model, downloadDir, signal, outcome.timedOut, creds)
    },

    async getVideoTask(videoId, model, signal) {
      const creds = await getCreds()
      const task = await getVideoTask(videoId, creds, cfg, model ?? null, signal)
      return await materializeVideo(task, task.model ?? cfg.videoModel, downloadDir, signal, false, creds)
    },

    async listVideoModels(signal) {
      const creds = await getCreds()
      return listVideoModels(creds, cfg, signal)
    },

    async listImageModels(signal) {
      const creds = await getCreds()
      return listImageModels(creds, cfg, signal)
    },

    async probe(signal): Promise<ProbeInfo> {
      const key = await probeApiKey(cfg, credentials)
      const empty: readonly { id: string; name?: string }[] = []
      let imageModels: readonly { id: string; name?: string }[] = empty
      let videoModels: readonly { id: string; name?: string }[] = empty
      if (key.configured) {
        try {
          const creds = await getCreds()
          imageModels = await listImageModels(creds, cfg, signal)
          videoModels = await listVideoModels(creds, cfg, signal)
        } catch {
          // Discovery is a nicety; a probe never fails the panel.
        }
      }
      return {
        site: cfg.site,
        imageModel: cfg.imageModel,
        videoModel: cfg.videoModel,
        imageDefaults: cfg.imageDefaults,
        videoDefaults: cfg.videoDefaults,
        imageModels,
        videoModels,
        keyConfigured: key.configured,
        keySource: key.source,
        storeDir: storeKey() ?? '',
        version,
        // A pinned value (patch) wins; otherwise the stored preference. `true`
        // is the shipped default for an entry nothing has decided yet.
        pageEnabled: cfg.pageEnabled ?? prefs?.get().pageEnabled ?? true,
        drawerEnabled: cfg.drawerEnabled ?? prefs?.get().drawerEnabled ?? true,
      }
    },

    jobs: jobsApi,
  }

  /**
   * Record a tool-driven generation in the same store the panel reads.
   *
   * The agent already produced the media and returned it to the chat; this is
   * the other half of the loop — the panel shows it, so the user can reopen,
   * copy, reuse the settings, or send it back into the conversation without
   * re-running (and re-paying for) the generation.
   */
  const recordAgentJob = (
    kind: Job['kind'],
    prompt: string,
    model: string,
    params: Record<string, unknown>,
    urls: readonly string[],
    downloads: readonly (string | null)[],
    error: string | null,
  ): void => {
    if (store === null) return
    const job = store.add(kind, prompt, model, params, 'agent')
    const keptUrls = urls.filter((u) => typeof u === 'string' && u.length > 0)
    const keptDownloads = downloads.filter((p): p is string => typeof p === 'string' && p.length > 0)
    store.update(job.id, error === null
      ? { status: 'completed', phase: 'done', progress: 100, urls: [...keptUrls], downloads: keptDownloads, error: null, finishedAt: Date.now() }
      : { status: 'failed', phase: 'error', progress: 100, urls: [...keptUrls], downloads: keptDownloads, error, finishedAt: Date.now() })
  }

  ctx.provide?.('agnesMedia', api)

  // Each stage stands alone: a failing tool schema must not take the HTTP bridge
  // (and with it the entry switches) down with it.
  stage('agent tools', () => registerTools(ctx, api, cfg, recordAgentJob))
  stage('history tool', () => registerHistoryTool(ctx, api))
  stage('web-server bridge', () => registerBridge(ctx, api, { store, resumeJob, storeDir, prefs, profileDir }))

  ctx.on?.('dispose', () => {
    for (const controller of running.values()) controller.abort()
    running.clear()
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    credsPromise = null
    void store?.flush()
  })
}

function requireStore(store: JobStore | null): JobStore {
  if (store === null) throw new Error('agnes-media: job store unavailable')
  return store
}

/**
 * True when a service surface looks usable: a function, an object, a class
 * instance, or a context proxy. Primitives (and `undefined`) mean the service
 * did not load, which is how this profile boots — `tools` and `webServer` can
 * both be missing or primitive-only at the moment the entry applies.
 */
function isService(value: unknown): boolean {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

/**
 * Report a broken stage and keep the rest of the plugin alive.
 *
 * `apply()` used to wrap the whole body in one try/catch. One throwing stage
 * then took every later one with it: when the `tools` registrar hit a schema
 * incompatibility, the job store, the preferences and — crucially — the
 * web-server bridge were never built, so the panel's switches answered HTTP 404
 * and the whole page looked dead. Each stage now stands on its own.
 */
function stage(label: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`[agnes-media] ${label} failed; continuing without it:`, error)
  }
}

function readCredentials(ctx: Context): CredentialsLike | undefined {
  try {
    const svc = (ctx as Context & { get?: (n: string) => unknown }).get?.('credentials')
    if (typeof svc !== 'object' || svc === null) return undefined
    const resolve = (svc as { resolve?: unknown }).resolve
    if (typeof resolve !== 'function') return undefined
    return svc as CredentialsLike
  } catch {
    return undefined
  }
}

/** Keep the prompt out of the persisted params (it has its own field). */
function stripPrompt<T extends { prompt?: string }>(params: T): Record<string, unknown> {
  const { prompt: _prompt, ...rest } = params
  return rest as Record<string, unknown>
}

function normalizeSeconds(raw: string): string {
  const n = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(n)) return '5'
  const clamped = Math.min(12, Math.max(4, n))
  return String(clamped)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

// ---------------------------------------------------------------------------
// Agent tools
// ---------------------------------------------------------------------------

type RecordAgentJob = (
  kind: Job['kind'],
  prompt: string,
  model: string,
  params: Record<string, unknown>,
  urls: readonly string[],
  downloads: readonly (string | null)[],
  error: string | null,
) => void

function registerTools(
  ctx: Context,
  api: AgnesMediaApi,
  cfg: AgnesConfig,
  recordAgentJob: RecordAgentJob,
): void {
  const tools = (ctx as Context & { tools?: { register?: (t: unknown) => () => void } }).tools
  if (!isService(tools) || typeof (tools as { register?: unknown }).register !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[agnes-media] ctx.tools unavailable; agent tools are not registered')
    return
  }

  tools.register(defineTool({
    name: 'agnes_media_image',
    description:
      'Generate images with Agnes Image (synchronous). Text-to-image, image-to-image and multi-image '
      + 'composition: pass `image` (public HTTPS URLs or data URIs) to edit or compose. '
      + 'Returns image URLs plus any local files.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Text instruction for image generation.' },
      model: { type: 'string', description: `Image model (default ${cfg.imageModel}).` },
      size: { type: 'string', description: 'Size tier: 1K | 2K | 3K | 4K.' },
      ratio: { type: 'string', description: 'Aspect ratio: 1:1, 3:4, 4:3, 16:9, 9:16, 2:3, 3:2, 21:9.' },
      n: { type: 'number', description: 'Number of images (1..4; 2.5-series always returns 1).' },
      seed: { type: 'number', description: 'Random seed for reproducibility.' },
      negative_prompt: { type: 'string', description: 'Content to avoid.' },
      image: {
        type: 'array',
        items: { type: 'string' },
        description: 'Reference images for image-to-image / multi-image composition (max 5).',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const prompt = String(args.prompt ?? '')
      const model = typeof args.model === 'string' ? args.model : cfg.imageModel
      const params = {
        ...(typeof args.size === 'string' ? { size: args.size } : {}),
        ...(typeof args.ratio === 'string' ? { ratio: args.ratio } : {}),
        ...(typeof args.n === 'number' ? { n: args.n } : {}),
        ...(typeof args.seed === 'number' ? { seed: args.seed } : {}),
        ...(typeof args.negative_prompt === 'string' ? { negative_prompt: args.negative_prompt } : {}),
        ...(Array.isArray(args.image) ? { image: args.image as string[] } : {}),
      }
      try {
        const r = await api.generateImage({ prompt, model, ...params }, exec.signal)
        recordAgentJob('image', prompt, model, params, r.images.map((i) => i.url ?? ''), r.downloads, null)
        return formatImageResult(r)
      } catch (error) {
        recordAgentJob('image', prompt, model, params, [], [], error instanceof Error ? error.message : String(error))
        throw error
      }
    },
  }))

  tools.register(defineTool({
    name: 'agnes_media_video',
    description:
      'Generate a video with Agnes Video (asynchronous; polls until done). Modes: text (prompt only), '
      + 'keyframe (first_frame/last_frame public URLs), reference (images ≤5 and/or audios ≤3, '
      + 'addressed in the prompt as <Picture N>/<Audio N>). Use `from_image_prompt` for one-step '
      + 'image-to-video when no public asset URL exists.',
    parameters: {
      prompt: { type: 'string', required: true, description: 'Text description of the video content.' },
      model: { type: 'string', description: `Video model (default ${cfg.videoModel}).` },
      mode: { type: 'string', enum: ['text', 'keyframe', 'reference'], description: 'Generation mode (default text).' },
      seconds: { type: 'string', description: 'Duration in seconds, 4–12 (default 5).' },
      aspect_ratio: { type: 'string', description: 'Aspect ratio: 21:9, 16:9, 4:3, 1:1, 3:4, 9:16.' },
      first_frame: { type: 'string', description: 'keyframe mode: public URL of the first frame.' },
      last_frame: { type: 'string', description: 'keyframe mode: public URL of the last frame.' },
      images: {
        type: 'array', items: { type: 'string' },
        description: 'reference mode: up to 5 public image URLs.',
      },
      audios: {
        type: 'array', items: { type: 'string' },
        description: 'reference mode: up to 3 public audio URLs.',
      },
      from_image_prompt: {
        type: 'string',
        description: 'One-step image-to-video: generate this keyframe image first and use it as first_frame.',
      },
      seed: { type: 'number', description: 'Random seed.' },
      negative_prompt: { type: 'string', description: 'Content to avoid.' },
      wait: { type: 'boolean', description: 'Block until completion (default true).' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const prompt = String(args.prompt ?? '')
      const model = typeof args.model === 'string' ? args.model : cfg.videoModel
      const params: Partial<VideoParams> = {
        ...(args.mode === 'text' || args.mode === 'keyframe' || args.mode === 'reference' ? { mode: args.mode } : {}),
        ...(typeof args.seconds === 'string' ? { seconds: args.seconds } : {}),
        ...(typeof args.aspect_ratio === 'string' ? { aspect_ratio: args.aspect_ratio } : {}),
        ...(typeof args.first_frame === 'string' ? { first_frame: args.first_frame } : {}),
        ...(typeof args.last_frame === 'string' ? { last_frame: args.last_frame } : {}),
        ...(Array.isArray(args.images) ? { images: args.images as string[] } : {}),
        ...(Array.isArray(args.audios) ? { audios: args.audios as string[] } : {}),
        ...(typeof args.from_image_prompt === 'string' ? { from_image_prompt: args.from_image_prompt } : {}),
        ...(typeof args.seed === 'number' ? { seed: args.seed } : {}),
        ...(typeof args.negative_prompt === 'string' ? { negative_prompt: args.negative_prompt } : {}),
      }
      try {
        const r = await api.generateVideo(
          { prompt, model, ...params },
          { wait: typeof args.wait === 'boolean' ? args.wait : true },
          exec.signal,
        )
        recordAgentJob('video', prompt, model, { ...params }, r.url !== null ? [r.url] : [], [r.downloadPath], r.error)
        return formatVideoResult(r)
      } catch (error) {
        recordAgentJob('video', prompt, model, params, [], [], error instanceof Error ? error.message : String(error))
        throw error
      }
    },
  }))

  tools.register(defineTool({
    name: 'agnes_media_task',
    description: 'Query the status of an Agnes video task by video id.',
    parameters: {
      video_id: { required: true, type: 'string', description: 'Video id returned by agnes_media_video.' },
      model: { type: 'string', description: 'Model used, to pick the right poll contract.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args, exec) {
      const r = await api.getVideoTask(
        String(args.video_id ?? ''),
        typeof args.model === 'string' ? args.model : null,
        exec.signal,
      )
      return formatVideoResult(r)
    },
  }))

  tools.register(defineTool({
    name: 'agnes_media_models',
    description: 'List image and video models available on the configured Agnes gateway.',
    // No parameters: the model list is whatever the gateway reports.
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(_args, exec) {
      const [images, videos] = await Promise.all([
        api.listImageModels(exec.signal),
        api.listVideoModels(exec.signal),
      ])
      const lines = ['## Agnes Models', '', '### Image', '']
      lines.push(...(images.length === 0 ? ['(none returned)'] : images.map((m, i) => `${i + 1}. ${m.id}${m.name !== undefined ? ` (${m.name})` : ''}`)))
      lines.push('', '### Video', '')
      lines.push(...(videos.length === 0 ? ['(none returned)'] : videos.map((m, i) => `${i + 1}. ${m.id}${m.name !== undefined ? ` (${m.name})` : ''}`)))
      return lines.join('\n')
    },
  }))
}

// ---------------------------------------------------------------------------
// History tool — the "panel → chat" half of the loop
// ---------------------------------------------------------------------------

/**
 * Let the agent read what the *panel* generated.
 *
 * Without this, a user who renders something in the panel has to describe it
 * back to the agent ("that panda image, 2K, 16:9") before the agent can reuse
 * or extend it. With it, the agent looks up the exact prompt, model, seed and
 * URL and can continue from there — including feeding the URL into
 * `agnes_media_video` as a first frame.
 */
function registerHistoryTool(ctx: Context, api: AgnesMediaApi): void {
  const tools = (ctx as Context & { tools?: { register?: (t: unknown) => () => void } }).tools
  if (!isService(tools) || typeof (tools as { register?: unknown }).register !== 'function') {
    // eslint-disable-next-line no-console
    console.warn('[agnes-media] ctx.tools unavailable; the history tool is not registered')
    return
  }

  tools.register(defineTool({
    name: 'agnes_media_history',
    description:
      'List media generated in the Agnes panel (and by earlier agent calls), newest first. '
      + 'Use it to reuse an existing result: read the prompt/model/params, then pass the URL to '
      + 'agnes_media_video as first_frame, or the prompt back into agnes_media_image.',
    parameters: {
      limit: { type: 'number', description: 'How many entries to return (default 10, max 50).' },
      kind: { type: 'string', enum: ['image', 'video'], description: 'Only this media kind.' },
      source: {
      type: 'string',
      enum: ['panel', 'agent'],
      description: 'Only jobs started from the panel, or only from tool calls.',
      },
      promptContains: { type: 'string', description: 'Case-insensitive substring of the prompt.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: Record<string, unknown>, value: unknown) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const limit = Math.min(50, Math.max(1, typeof args.limit === 'number' ? Math.trunc(args.limit) : 10))
      const needle = typeof args.promptContains === 'string' ? args.promptContains.toLowerCase() : ''
      const rows = api.jobs.list().filter((job) => {
        if (args.kind === 'image' || args.kind === 'video') { if (job.kind !== args.kind) return false }
        if (args.source === 'panel' || args.source === 'agent') { if (job.source !== args.source) return false }
        if (needle.length > 0 && !job.prompt.toLowerCase().includes(needle)) return false
        return job.status === 'completed'
      }).slice(0, limit)

      if (rows.length === 0) return '## Agnes History\n\n(no matching completed results)'
      const lines = ['## Agnes History', '']
      for (const job of rows) {
        lines.push(`### ${job.kind} · ${job.model} · ${job.source === 'agent' ? 'from chat' : 'from panel'}`)
        lines.push(`- id: ${job.id}`)
        lines.push(`- prompt: ${job.prompt}`)
        const params = summarizeParams(job.params)
        if (params.length > 0) lines.push(`- params: ${params.join(' · ')}`)
        if (job.urls.length > 0) lines.push(`- url: ${job.urls.join(' , ')}`)
        if (job.downloads.length > 0) lines.push(`- local: ${job.downloads.join(' , ')}`)
        lines.push('')
      }
      return lines.join('\n')
    },
  }))
}

/**
 * Render a job's parameters as a compact, readable list.
 *
 * Reference images are stored as inline data URIs — a 4K PNG is several
 * megabytes of base64. Printing them would bury the parameters that actually
 * matter (size, ratio, seed), so each one becomes a size + kind label. The URL
 * of the result is reported separately, and a data URI that large is never
 * useful to a reader anyway.
 */
function summarizeParams(params: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'string') {
      if (value.startsWith('data:')) {
        out.push(`${key}=<inline ${describeDataUri(value)}>`)
      } else {
        out.push(`${key}=${value}`)
      }
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out.push(`${key}=${String(value)}`)
      continue
    }
    if (Array.isArray(value)) {
      const items = value.map((v) => (typeof v === 'string' && v.startsWith('data:')
        ? `<inline ${describeDataUri(v)}>`
        : String(v)))
      out.push(`${key}=${items.join(', ')}`)
      continue
    }
    out.push(`${key}=${JSON.stringify(value)}`)
  }
  return out
}

/** "image/png;base64" + approximate decoded size, e.g. `image/png 4.4MB`. */
function describeDataUri(uri: string): string {
  const mime = /^data:([^;,]+)/.exec(uri)
  const kind = mime !== null ? mime[1].replace(/^image\//, '') : 'image'
  const approxBytes = Math.round((uri.length - uri.indexOf(',') - 1) * 0.75)
  return `${kind} ${approxBytes < 1024 * 1024
    ? `${Math.round(approxBytes / 1024)}KB`
    : `${(approxBytes / (1024 * 1024)).toFixed(1)}MB`}`
}

// ---------------------------------------------------------------------------
// Browser bridge
// ---------------------------------------------------------------------------

interface BridgeOptions {
  readonly store: JobStore | null
  readonly resumeJob: (id: string) => JobView | undefined
  readonly storeDir: string | null
  readonly prefs: PrefStore | null
  /** The profile directory, when known; the bundle list is read from it. */
  readonly profileDir?: string | undefined
}

/**
 * The profile directory that lists this plugin, or undefined.
 *
 * Derived from the store directory rather than from a service, because the
 * profile's path is only reachable through `loader` internals that this plugin
 * does not inject. `~/.dsh/agnes-media` sits directly under the DSH home, whose
 * `profiles/<name>/package.json` is the manifest the Plugins page reads.
 *
 * A directory is accepted only when its manifest actually depends on this
 * package (or selects it as a bundle), so an unrelated profile can never
 * contribute bundle names.
 */
function resolveProfileDir(storeDir: string | null): string | undefined {
  if (typeof storeDir !== 'string' || storeDir.length === 0) return undefined
  for (const home of [resolve(storeDir, '..', '..'), join(homedir(), '.dsh')]) {
    const profiles = join(home, 'profiles')
    let names: string[]
    try {
      names = readdirSync(profiles)
    } catch {
      continue
    }
    for (const name of names) {
      const dir = join(profiles, name)
      try {
        const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, unknown>
          dsh?: { profile?: { bundles?: unknown } }
        }
        const deps = manifest.dependencies ?? {}
        const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh?.profile?.bundles : []
        if (Object.hasOwn(deps, 'agnes-media') || bundles.includes('agnes-media')) return dir
      } catch {
        // Not a profile directory, or unreadable: try the next one.
      }
    }
  }
  return undefined
}

/**
 * The bundle package names this profile selects.
 *
 * `plugins.bundle.config` is keyed by bundle package name, so the browser has
 * to know which ones exist to put its switches on the right page — hard-coding
 * one is how the section ended up keyed to a page that was not there.
 *
 * Read from the same manifest the Plugins page reads (`dsh.profile.bundles` in
 * the profile's `package.json`). Best-effort: an unreadable manifest yields an
 * empty list, and the browser still keys the plugin's own page, which is the
 * seat that matters.
 */
function selectedBundles(options: BridgeOptions): string[] {
  const names = new Set<string>()
  const dir = options.profileDir
  if (typeof dir === 'string' && dir.length > 0) {
    try {
      const raw = readFileSync(join(dir, 'package.json'), 'utf8')
      const manifest = JSON.parse(raw) as {
        dsh?: { profile?: { bundles?: unknown } }
      }
      const bundles = manifest.dsh?.profile?.bundles
      if (Array.isArray(bundles)) {
        for (const name of bundles) if (typeof name === 'string' && name.length > 0) names.add(name)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[agnes-media] cannot read the profile bundle list:', error)
    }
  }
  return [...names]
}

function registerBridge(ctx: Context, api: AgnesMediaApi, options: BridgeOptions): void {
  registerPrefixRoute(ctx, (webServer) => {
    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (req, res) => void handleHttp(req, res, api, options),
    }), 'agnes-media: web-server bridge')
  })
}
/**
 * Mount the plugin's HTTP surface on `ctx.webServer`.
 *
 * Registering while the plugin loads is not enough: the web server is built
 * after the profile's entries, so a load-time check finds `ctx.webServer`
 * undefined and silently serves nothing — which is exactly how the switches
 * ended up answering "HTTP 404" and disabled under a running DSH. When it is
 * missing, this waits for the service (polled, bounded) and mounts then.
 */
function registerPrefixRoute(ctx: Context, mount: (webServer: WebServerLike) => void): void {
  let mounted = false
  const tryMount = (): boolean => {
    if (mounted) return true
    const webServer = (ctx as Context & { webServer?: WebServerLike }).webServer as WebServerLike | undefined
    if (webServer === undefined || !isService(webServer) || typeof webServer.register !== 'function') return false
    mounted = true
    try {
      mount(webServer)
      // One line a support transcript can be checked against.
      // eslint-disable-next-line no-console
      console.info(`[agnes-media] web-server bridge mounted at ${API_PREFIX}`)
    } catch (error) {
      console.error('[agnes-media] mounting the web-server bridge failed:', error)
    }
    return true
  }

  if (tryMount()) return

  let polls = 0
  const poll = (): void => {
    if (tryMount()) return
    polls += 1
    if (polls >= 60) {
      console.error('[agnes-media] no ctx.webServer after 30s; the panel cannot reach the Host')
      return
    }
    const timer = setTimeout(poll, 500)
    ctx.effect(() => () => clearTimeout(timer), 'agnes-media: web-server wait')
  }
  const initial = setTimeout(poll, 250)
  ctx.effect(() => () => clearTimeout(initial), 'agnes-media: web-server retry start')
}

async function handleHttp(
  req: IncomingLike,
  res: ServerResponseLike,
  api: AgnesMediaApi,
  options: BridgeOptions,
): Promise<void> {
  const method = req.method ?? 'GET'
  const path = new URL(req.url ?? '/', 'http://dsh.invalid').pathname
  res.setHeader('Cache-Control', 'no-store')
  if (method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }
  if (method !== 'GET' && method !== 'POST') {
    res.writeHead(405, { 'content-type': 'text/plain' })
    res.end('method not allowed')
    return
  }
  const sub = path.slice(API_PREFIX.length).replace(/^\//, '')

  const payload = method === 'POST' ? await readBody(req) : {}
  try {
    const value = await dispatch(api, options, sub, payload, method)
    sendJson(res, 200, { ok: true, value })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const status = error instanceof AgnesCredentialError ? 401 : 500
    sendJson(res, status, { ok: false, error: { code: error instanceof Error ? error.name : 'error', message } })
  }
}

function sendJson(res: ServerResponseLike, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text)),
  })
  res.end(text)
}

function readBody(req: IncomingLike): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = ''
    let size = 0
    req.on('data', (chunk) => {
      size += String(chunk).length
      // Reference images travel as data URIs; cap the body at ~32 MiB.
      if (size > 32 * 1024 * 1024) { resolve({}); return }
      data += String(chunk)
    })
    req.on('end', () => {
      try {
        const parsed: unknown = data.length > 0 ? JSON.parse(data) : {}
        resolve(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {})
      } catch {
        resolve({})
      }
    })
  })
}

async function dispatch(
  api: AgnesMediaApi,
  options: BridgeOptions,
  endpoint: string,
  payload: unknown,
  method: string,
): Promise<unknown> {
  const p = (payload ?? {}) as Record<string, unknown>
  switch (endpoint) {
    case 'probe':
      return api.probe()

    case 'bundles':
      return selectedBundles(options)

    case 'generateImage':
      return api.generateImage({
        prompt: String(p.prompt ?? ''),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(typeof p.size === 'string' ? { size: p.size } : {}),
        ...(typeof p.ratio === 'string' ? { ratio: p.ratio } : {}),
        ...(typeof p.n === 'number' ? { n: p.n } : {}),
        ...(typeof p.seed === 'number' ? { seed: p.seed } : {}),
        ...(typeof p.negative_prompt === 'string' ? { negative_prompt: p.negative_prompt } : {}),
        ...(Array.isArray(p.image) ? { image: p.image as string[] } : {}),
      })

    case 'generateVideo':
      return api.generateVideo({
        prompt: String(p.prompt ?? ''),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(p.mode === 'text' || p.mode === 'keyframe' || p.mode === 'reference' ? { mode: p.mode } : {}),
        ...(typeof p.seconds === 'string' ? { seconds: p.seconds } : {}),
        ...(typeof p.aspect_ratio === 'string' ? { aspect_ratio: p.aspect_ratio } : {}),
        ...(typeof p.first_frame === 'string' ? { first_frame: p.first_frame } : {}),
        ...(typeof p.last_frame === 'string' ? { last_frame: p.last_frame } : {}),
        ...(Array.isArray(p.images) ? { images: p.images as string[] } : {}),
        ...(Array.isArray(p.audios) ? { audios: p.audios as string[] } : {}),
        ...(typeof p.from_image_prompt === 'string' ? { from_image_prompt: p.from_image_prompt } : {}),
        ...(typeof p.seed === 'number' ? { seed: p.seed } : {}),
        ...(typeof p.negative_prompt === 'string' ? { negative_prompt: p.negative_prompt } : {}),
      }, { wait: typeof p.wait === 'boolean' ? p.wait : false })

    case 'getVideoTask':
      return api.getVideoTask(
        String(p.video_id ?? ''),
        typeof p.model === 'string' ? p.model : null,
      )

    case 'listVideoModels':
      return api.listVideoModels()

    case 'listImageModels':
      return api.listImageModels()

    case 'jobs':
      return method === 'GET' ? api.jobs.list() : { ok: false }

    case 'createImage':
      return api.jobs.createImage({
        prompt: String(p.prompt ?? ''),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(typeof p.size === 'string' ? { size: p.size } : {}),
        ...(typeof p.ratio === 'string' ? { ratio: p.ratio } : {}),
        ...(typeof p.n === 'number' ? { n: p.n } : {}),
        ...(typeof p.seed === 'number' ? { seed: p.seed } : {}),
        ...(typeof p.negative_prompt === 'string' ? { negative_prompt: p.negative_prompt } : {}),
        ...(Array.isArray(p.image) ? { image: p.image as string[] } : {}),
      })

    case 'createVideo':
      return api.jobs.createVideo({
        prompt: String(p.prompt ?? ''),
        ...(typeof p.model === 'string' ? { model: p.model } : {}),
        ...(p.mode === 'text' || p.mode === 'keyframe' || p.mode === 'reference' ? { mode: p.mode } : {}),
        ...(typeof p.seconds === 'string' ? { seconds: p.seconds } : {}),
        ...(typeof p.aspect_ratio === 'string' ? { aspect_ratio: p.aspect_ratio } : {}),
        ...(typeof p.first_frame === 'string' ? { first_frame: p.first_frame } : {}),
        ...(typeof p.last_frame === 'string' ? { last_frame: p.last_frame } : {}),
        ...(Array.isArray(p.images) ? { images: p.images as string[] } : {}),
        ...(Array.isArray(p.audios) ? { audios: p.audios as string[] } : {}),
        ...(typeof p.from_image_prompt === 'string' ? { from_image_prompt: p.from_image_prompt } : {}),
        ...(typeof p.seed === 'number' ? { seed: p.seed } : {}),
        ...(typeof p.negative_prompt === 'string' ? { negative_prompt: p.negative_prompt } : {}),
      })

    case 'cancelJob':
      api.jobs.cancel(String(p.id ?? ''))
      return { ok: true }

    case 'removeJob':
      api.jobs.remove(String(p.id ?? ''))
      return { ok: true }

    case 'clearJobs':
      api.jobs.clear()
      return { ok: true }

    case 'resumeJob': {
      const job = options.resumeJob(String(p.id ?? ''))
      if (job === undefined) throw new Error('agnes-media: job cannot be resumed')
      return job
    }

    case 'retryJob': {
      const job = api.jobs.retry(String(p.id ?? ''))
      if (job === undefined) throw new Error('agnes-media: job cannot be retried')
      return job
    }

    case 'inlineReference':
      return api.jobs.inlineReference(String(p.id ?? ''))

    case 'entries':
      // Read-only here: the sidebar seat writes through `setEntries`.
      // Wait for the stored file: activation cannot await, so without this the
      // first answer after a restart is the compiled-in default and the client
      // would briefly show — and act on — the wrong state.
      await options.prefs?.settled()
      return options.prefs?.get() ?? { pageEnabled: true, drawerEnabled: true }

    case 'setEntries': {
      if (options.prefs === null) throw new Error('agnes-media: preferences unavailable')
      const patch: { pageEnabled?: boolean; drawerEnabled?: boolean } = {}
      if (typeof p.pageEnabled === 'boolean') patch.pageEnabled = p.pageEnabled
      if (typeof p.drawerEnabled === 'boolean') patch.drawerEnabled = p.drawerEnabled
      if (Object.keys(patch).length === 0) throw new Error('agnes-media: nothing to change')
      return options.prefs.set(patch)
    }

    case 'openStoreDir':
      return { dir: options.storeDir }

    default:
      throw new Error(`agnes-media: unknown endpoint "${endpoint}"`)
  }
}

// ---------------------------------------------------------------------------
// Result materialization
// ---------------------------------------------------------------------------

async function materializeImage(
  items: readonly { url?: string; b64_json?: string; revised_prompt?: string }[],
  model: string,
  downloadDir: string | null,
  signal: AbortSignal | undefined,
  cfg: AgnesConfig,
  creds: AgnesCredentials,
): Promise<ImageResult> {
  const downloads: (string | null)[] = []
  if (downloadDir !== null) {
    for (const item of items) {
      const url = typeof item.url === 'string' && item.url.length > 0 ? item.url : null
      downloads.push(url === null ? null : await downloadUrl(url, downloadDir, imageExt(url), signal, creds.apiKey))
    }
    if (downloads.length > 0) void pruneDownloads(downloadDir, cfg.keepDownloads).catch(() => {})
  } else {
    for (let i = 0; i < items.length; i++) downloads.push(null)
  }
  return { generatedAt: new Date().toISOString(), model, images: items, downloads }
}

async function materializeVideo(
  task: VideoTask,
  model: string,
  downloadDir: string | null,
  signal: AbortSignal | undefined,
  timedOut: boolean,
  creds: AgnesCredentials,
): Promise<VideoResult> {
  const status = normalizeStatus(task.status)
  const candidateUrl =
    task.url
    ?? task.metadata?.url
    ?? task.video_url
    ?? task.data?.url
    ?? task.result?.url
    ?? null
  const url = status === 'completed' && typeof candidateUrl === 'string' && candidateUrl.length > 0 ? candidateUrl : null
  const downloadPath =
    downloadDir !== null && url !== null
      ? await downloadUrl(url, downloadDir, videoExt(url), signal, creds.apiKey)
      : null
  const error =
    status === 'failed'
      ? (typeof task.error?.message === 'string' ? task.error.message : 'video generation failed')
      : (timedOut && status !== 'completed' ? 'polling timed out before completion' : null)
  return {
    resolvedAt: new Date().toISOString(),
    model: task.model ?? model,
    taskId: task.task_id ?? task.id ?? null,
    videoId: task.video_id ?? task.id ?? null,
    status,
    seconds: task.seconds ?? null,
    size: task.size ?? null,
    url,
    downloadPath,
    error,
  }
}

function formatImageResult(r: ImageResult): string {
  const lines = ['## Agnes Image Generation', '', `**Model:** ${r.model}`, `**Images:** ${r.images.length}`, '']
  if (r.images.length === 0) lines.push('(no images returned)')
  r.images.forEach((item, i) => {
    lines.push(`${i + 1}.`)
    if (typeof item.url === 'string') lines.push(`   - URL: ${item.url}`)
    const dl = r.downloads[i]
    if (typeof dl === 'string' && dl.length > 0) lines.push(`   - Local file: ${dl}`)
  })
  return lines.join('\n')
}

function formatVideoResult(r: VideoResult): string {
  const lines = ['## Agnes Video Generation', '', `**Model:** ${r.model}`, `**Status:** ${r.status}`]
  if (r.taskId !== null) lines.push(`**Task:** ${r.taskId}`)
  if (r.videoId !== null) lines.push(`**Video:** ${r.videoId}`)
  lines.push('')
  if (r.url !== null) lines.push(`- URL: ${r.url}`)
  if (r.downloadPath !== null) lines.push(`- Local file: ${r.downloadPath}`)
  if (r.error !== null) lines.push(`- Error: ${r.error}`)
  return lines.join('\n')
}

export type { VideoTaskStatus }
