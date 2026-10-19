/**
 * Agnes Media Studio — core type vocabulary.
 *
 * @module agnes-media/types
 */

export type Site = 'intl' | 'cn'

export interface AgnesCredentials {
  readonly apiKey: string
  readonly imageBaseUrl: string
  readonly videoBaseUrl: string
  readonly keySource: 'config' | 'env' | 'credentials' | 'credentials-file' | 'unknown'
}

// --- Image ------------------------------------------------------------------

export interface ImageParams {
  readonly model: string
  readonly prompt: string
  readonly size: string
  readonly ratio?: string
  /** Reference images (public HTTPS URL or data URI) — sent inside `extra_body`. */
  readonly image?: readonly string[]
  readonly n?: number
  readonly seed?: number
  readonly negative_prompt?: string
  readonly return_base64?: boolean
  readonly extra_body?: Record<string, unknown>
}

export interface ImageItem {
  readonly url?: string
  readonly b64_json?: string
  readonly revised_prompt?: string
}

export interface ImageResponse {
  readonly created?: number
  readonly data: readonly ImageItem[]
}

export interface ImageResult {
  readonly generatedAt: string
  readonly model: string
  readonly images: readonly ImageItem[]
  readonly downloads: readonly (string | null)[]
}

// --- Video ------------------------------------------------------------------

export type VideoTaskStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

/** `text` = prompt only, `keyframe` = first/last frame, `reference` = images/audios. */
export type VideoMode = 'text' | 'keyframe' | 'reference'

export interface VideoParams {
  readonly model: string
  readonly prompt: string
  readonly mode?: VideoMode
  readonly image?: string
  readonly width?: number
  readonly height?: number
  readonly num_frames?: number
  readonly frame_rate?: number
  readonly seconds?: string
  readonly size?: string
  readonly aspect_ratio?: string
  readonly first_frame?: string
  readonly last_frame?: string
  readonly images?: readonly string[]
  readonly audios?: readonly string[]
  readonly reference_images?: readonly string[]
  readonly seed?: number
  readonly negative_prompt?: string
  readonly extra_body?: Record<string, unknown>
  /**
   * One-step image-to-video: generate a keyframe with the image model first and
   * use its public URL as `first_frame`. Ignored when `first_frame` is given.
   */
  readonly from_image_prompt?: string
  readonly from_image_model?: string
}

export interface VideoTask {
  readonly id?: string
  readonly task_id?: string
  readonly video_id?: string
  readonly object?: string
  readonly model?: string
  readonly status?: string
  readonly progress?: number
  readonly created_at?: number
  readonly completed_at?: number
  readonly seconds?: string
  readonly size?: string
  readonly metadata?: { readonly url?: string; readonly [k: string]: unknown }
  readonly error?: { readonly code?: string; readonly message?: string; readonly [k: string]: unknown } | null
  readonly url?: string
  readonly video_url?: string
  readonly data?: { readonly url?: string }
  readonly result?: { readonly url?: string }
}

export interface VideoResult {
  readonly resolvedAt: string
  readonly model: string
  readonly taskId: string | null
  readonly videoId: string | null
  readonly status: VideoTaskStatus
  readonly seconds: string | null
  readonly size: string | null
  readonly url: string | null
  readonly downloadPath: string | null
  readonly error: string | null
}

// --- Jobs -------------------------------------------------------------------

export type JobKind = 'image' | 'video'
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

/** Who started the job: the panel, or the agent through a tool call. */
export type JobSource = 'panel' | 'agent'

/** One generation attempt, owned by the Host so it survives a page reload. */
export interface Job {
  readonly id: string
  readonly kind: JobKind
  /** `agent` jobs are shown in the panel too, tagged, so chat output is reusable. */
  readonly source: JobSource
  readonly prompt: string
  readonly model: string
  readonly params: Record<string, unknown>
  status: JobStatus
  /** 0..100, best effort. */
  progress: number
  /** Human-readable phase, already localized on the Host side only as a code. */
  phase: 'queued' | 'submitting' | 'polling' | 'downloading' | 'done' | 'error'
  videoId: string | null
  urls: string[]
  downloads: string[]
  error: string | null
  createdAt: number
  updatedAt: number
  finishedAt: number | null
  /** Set when the job was resumed from a previous Host process. */
  resumed: boolean
  /** Automatic rate-limit retries already spent (free tier answers 429). */
  attempts: number
  /** Epoch ms of the scheduled automatic retry, while `status` is `queued`. */
  retryAt: number | null
  /** True when the last failure was the gateway's rate limit. */
  rateLimited: boolean
}

export interface JobView extends Job {
  /** Seconds since creation, computed for the client. */
  readonly ageSeconds: number
}

// --- Config -----------------------------------------------------------------

export interface ImageDefaults {
  readonly size: string
  readonly ratio: string
  readonly n: number
}

export interface VideoDefaults {
  readonly ratio: string
  readonly seconds: string
  readonly size: string
}

export interface AgnesConfig {
  readonly site: Site
  readonly apiKey: string | null
  readonly imageBaseURL: string | null
  readonly videoBaseURL: string | null
  readonly imageModel: string
  readonly videoModel: string
  readonly imageDefaults: ImageDefaults
  readonly videoDefaults: VideoDefaults
  readonly requestTimeoutMs: number
  readonly pollIntervalMs: number
  readonly pollTimeoutMs: number
  readonly maxRetries: number
  readonly retryBackoffMs: number
  readonly downloadDir: string | null
  readonly keepDownloads: number
  readonly storeDir: string | null
  readonly maxHistory: number
  readonly autoInsert: boolean
  /**
   * Register the `sidebar.panellist` + `main` workbench entry.
   *
   * `null` when the patch says nothing: the stored preference (written by the
   * switches) then decides. A boolean is an explicit pin.
   */
  readonly pageEnabled: boolean | null
  /** Same contract for the conversation-header button and its drawer. */
  readonly drawerEnabled: boolean | null
}

export interface AgnesApiError {
  readonly status: number
  readonly statusText: string
  readonly body: unknown
  readonly message: string
}

export interface GatewayModel {
  readonly id: string
  readonly name?: string
}

export interface ProbeInfo {
  readonly site: Site
  readonly imageModel: string
  readonly videoModel: string
  readonly imageDefaults: ImageDefaults
  readonly videoDefaults: VideoDefaults
  readonly imageModels: readonly GatewayModel[]
  readonly videoModels: readonly GatewayModel[]
  readonly keyConfigured: boolean
  readonly keySource: AgnesCredentials['keySource']
  readonly storeDir: string
  readonly version: string
  /** Whether the sidebar workbench entry is registered. */
  readonly pageEnabled: boolean
  /** Whether the conversation-header quick button (and its drawer) is registered. */
  readonly drawerEnabled: boolean
}

export interface AgnesMediaApi {
  generateImage(params?: Partial<ImageParams>, signal?: AbortSignal): Promise<ImageResult>
  generateVideo(
    params?: Partial<VideoParams>,
    options?: { wait?: boolean; jobId?: string },
    signal?: AbortSignal,
  ): Promise<VideoResult>
  getVideoTask(videoId: string, model?: string | null, signal?: AbortSignal): Promise<VideoResult>
  listVideoModels(signal?: AbortSignal): Promise<readonly GatewayModel[]>
  listImageModels(signal?: AbortSignal): Promise<readonly GatewayModel[]>
  probe(signal?: AbortSignal): Promise<ProbeInfo>
  /** Job runner surface used by the browser panel. */
  readonly jobs: {
    createImage(params: Partial<ImageParams>): Promise<JobView>
    createVideo(params: Partial<VideoParams>): Promise<JobView>
    list(): JobView[]
    cancel(id: string): void
    remove(id: string): void
    clear(): void
    /** Re-run a finished/failed job from its stored parameters. */
    retry(id: string): JobView | undefined
    /** Continue polling an interrupted video job instead of re-creating it. */
    resume(id: string): JobView | undefined
    wait(id: string, signal?: AbortSignal): Promise<JobView | undefined>
    /**
     * Fetch a finished job's media and return it as a data URI.
     *
     * The browser cannot fetch the CDN itself: the gateway's object host sends
     * no `Access-Control-Allow-Origin`, so a cross-origin `fetch()` from the
     * page fails with "Failed to fetch". The Host has no such constraint and
     * already holds the key, so this is the only path that works.
     */
    inlineReference(id: string): Promise<{ dataUri: string; name: string; kind: JobKind }>
  }
}
