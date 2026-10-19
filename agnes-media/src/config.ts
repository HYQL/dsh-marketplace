/**
 * Config resolution — tolerant of partial/legacy patch overlays.
 *
 * @module agnes-media/config
 */

import type { AgnesConfig, ImageDefaults, Site, VideoDefaults } from './types.ts'

export const DEFAULT_CONFIG: AgnesConfig = {
  site: 'cn',
  apiKey: null,
  imageBaseURL: null,
  videoBaseURL: null,
  imageModel: 'agnes-image-2.5-flash',
  videoModel: 'agnes-video-2.5-flash',
  imageDefaults: { size: '1K', ratio: '1:1', n: 1 },
  videoDefaults: { ratio: '16:9', seconds: '5', size: '720P' },
  requestTimeoutMs: 120_000,
  pollIntervalMs: 5_000,
  pollTimeoutMs: 600_000,
  maxRetries: 2,
  retryBackoffMs: 1_000,
  downloadDir: null,
  keepDownloads: 200,
  storeDir: null,
  maxHistory: 60,
  autoInsert: true,
  /*
   * No defaults for the two entry toggles.
   *
   * `resolveConfig` always returns a complete object, and the Host feeds it to
   * `PrefStore.applyPatch`, which treats every boolean it sees as an
   * administrator's pin. A default of `true` here would therefore pin both
   * entries on at every boot (and every `probe`) and silently undo what the user
   * saved. Absent means "the stored preference decides".
   */
  pageEnabled: null,
  drawerEnabled: null,
}

type Raw = Record<string, unknown>

function obj(v: unknown): Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Raw) : {}
}
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function clampNum(v: unknown, fallback: number, min: number, max: number): number {
  const n = num(v, fallback)
  return Math.min(max, Math.max(min, n))
}
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback
}
function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** Site: accept 'cn' | 'intl' (and the legacy 'china' | 'international' | 'com'). */
function site(v: unknown): Site {
  if (v === 'cn' || v === 'china') return 'cn'
  if (v === 'intl' || v === 'international' || v === 'com') return 'intl'
  return DEFAULT_CONFIG.site
}

export function resolveConfig(input: unknown): AgnesConfig {
  const raw = obj(input)
  const imgDefaults = obj(raw.imageDefaults)
  const vidDefaults = obj(raw.videoDefaults)

  const imageDefaults: ImageDefaults = {
    size: str(imgDefaults.size, DEFAULT_CONFIG.imageDefaults.size),
    ratio: str(imgDefaults.ratio, DEFAULT_CONFIG.imageDefaults.ratio),
    n: clampNum(imgDefaults.n, DEFAULT_CONFIG.imageDefaults.n, 1, 4),
  }
  const videoDefaults: VideoDefaults = {
    ratio: str(vidDefaults.ratio, DEFAULT_CONFIG.videoDefaults.ratio),
    seconds: str(vidDefaults.seconds, DEFAULT_CONFIG.videoDefaults.seconds),
    size: str(vidDefaults.size, DEFAULT_CONFIG.videoDefaults.size),
  }

  return {
    site: site(raw.site),
    apiKey: nullableStr(raw.apiKey),
    imageBaseURL: nullableStr(raw.imageBaseURL),
    videoBaseURL: nullableStr(raw.videoBaseURL),
    imageModel: str(raw.imageModel, DEFAULT_CONFIG.imageModel),
    videoModel: str(raw.videoModel, DEFAULT_CONFIG.videoModel),
    imageDefaults,
    videoDefaults,
    requestTimeoutMs: clampNum(raw.requestTimeoutMs, DEFAULT_CONFIG.requestTimeoutMs, 5_000, 600_000),
    pollIntervalMs: clampNum(raw.pollIntervalMs, DEFAULT_CONFIG.pollIntervalMs, 1_000, 60_000),
    pollTimeoutMs: clampNum(raw.pollTimeoutMs, DEFAULT_CONFIG.pollTimeoutMs, 30_000, 3_600_000),
    maxRetries: clampNum(raw.maxRetries, DEFAULT_CONFIG.maxRetries, 0, 5),
    retryBackoffMs: clampNum(raw.retryBackoffMs, DEFAULT_CONFIG.retryBackoffMs, 100, 30_000),
    downloadDir: nullableStr(raw.downloadDir),
    keepDownloads: clampNum(raw.keepDownloads, DEFAULT_CONFIG.keepDownloads, 0, 10_000),
    storeDir: nullableStr(raw.storeDir),
    maxHistory: clampNum(raw.maxHistory, DEFAULT_CONFIG.maxHistory, 0, 500),
    autoInsert: bool(raw.autoInsert, DEFAULT_CONFIG.autoInsert === true),
    // A boolean only when the patch (or the user's layer) actually said so;
    // otherwise null, so the stored preference stays authoritative.
    pageEnabled: typeof raw.pageEnabled === 'boolean' ? raw.pageEnabled : DEFAULT_CONFIG.pageEnabled,
    drawerEnabled: typeof raw.drawerEnabled === 'boolean' ? raw.drawerEnabled : DEFAULT_CONFIG.drawerEnabled,
  }
}
