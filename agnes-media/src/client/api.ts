/**
 * Browser → Host bridge.
 *
 * Every call goes through the plugin's own prefix route; the API key never
 * leaves the Host process.
 *
 * @module agnes-media/client/api
 */

import type { JobView, ProbeInfo } from '../types.ts'

export const API_BASE = '/agnes-media-studio/api'

interface Envelope<T> {
  ok?: boolean
  value?: T
  error?: { code?: string; message?: string }
}

async function call<T>(endpoint: string, payload?: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const res = await fetch(`${API_BASE}/${endpoint}`, method === 'GET'
    ? { method, cache: 'no-store' }
    : {
        method,
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
  let parsed: Envelope<T> | null = null
  try {
    parsed = await res.json() as Envelope<T>
  } catch {
    throw new Error(`HTTP ${res.status}`)
  }
  if (res.ok && parsed?.ok === true) return parsed.value as T
  throw new Error(parsed?.error?.message ?? `HTTP ${res.status}`)
}

export interface CreateImageInput {
  prompt: string
  model?: string
  size?: string
  ratio?: string
  n?: number
  seed?: number
  negative_prompt?: string
  image?: string[]
}

export interface CreateVideoInput {
  prompt: string
  model?: string
  mode?: 'text' | 'keyframe' | 'reference'
  seconds?: string
  aspect_ratio?: string
  first_frame?: string
  last_frame?: string
  images?: string[]
  audios?: string[]
  from_image_prompt?: string
  seed?: number
  negative_prompt?: string
}

/** The two entry toggles the sidebar footer seat controls. */
export interface EntryPrefs {
  pageEnabled: boolean
  drawerEnabled: boolean
}

export const api = {
  probe: () => call<ProbeInfo>('probe', {}, 'GET'),
  entries: () => call<EntryPrefs>('entries', {}, 'GET'),
  setEntries: (patch: Partial<EntryPrefs>) => call<EntryPrefs>('setEntries', patch),
  /**
   * Bundle package names the profile selects.
   *
   * The entry switches are keyed by *bundle* name, so this is how the browser
   * learns which bundle page it should mount them on without hard-coding one.
   * Read from the profile manifest on the Host, so it needs no network.
   */
  bundles: () => call<string[]>('bundles', undefined, 'GET'),
  jobs: () => call<JobView[]>('jobs', undefined, 'GET'),
  createImage: (input: CreateImageInput) => call<JobView>('createImage', input),
  createVideo: (input: CreateVideoInput) => call<JobView>('createVideo', input),
  cancelJob: (id: string) => call<{ ok: boolean }>('cancelJob', { id }),
  removeJob: (id: string) => call<{ ok: boolean }>('removeJob', { id }),
  clearJobs: () => call<{ ok: boolean }>('clearJobs', {}),
  resumeJob: (id: string) => call<JobView>('resumeJob', { id }),
  retryJob: (id: string) => call<JobView>('retryJob', { id }),
  /**
   * Fetch a finished job's media as a data URI through the Host.
   *
   * The CDN sends no CORS headers, so the page cannot fetch it directly; the
   * Host can, and it already holds the key.
   */
  inlineReference: (id: string) => call<{ dataUri: string; name: string; kind: 'image' | 'video' }>('inlineReference', { id }),
  getVideoTask: (videoId: string, model?: string) =>
    call<{ status?: string; url?: string | null }>('getVideoTask', { video_id: videoId, model }),
}
