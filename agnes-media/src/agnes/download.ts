/**
 * Best-effort download of generated media to disk, plus the job store.
 *
 * @module agnes-media/agnes/download
 */

import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'

/** Expand a leading `~` and resolve relative paths against the home dir. */
export function resolveDownloadDir(configured: string | null): string | null {
  if (configured === null) return null
  return expandHome(configured)
}

export function expandHome(configured: string): string {
  const expanded = configured === '~' || configured.startsWith('~/') || configured.startsWith('~\\')
    ? join(homedir(), configured.slice(1))
    : configured
  return isAbsolute(expanded) ? expanded : join(homedir(), expanded)
}

export function imageExt(url: string): string {
  const clean = url.split('?')[0] ?? ''
  const m = /\.(png|jpe?g|webp|gif|avif)$/i.exec(clean)
  if (m === null) return 'png'
  return m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase()
}

export function videoExt(url: string): string {
  const clean = url.split('?')[0] ?? ''
  const m = /\.(mp4|webm|mov|mkv)$/i.exec(clean)
  return m === null ? 'mp4' : m[1].toLowerCase()
}

/**
 * Download one URL into `dir`.
 *
 * Returns the path, or null on any failure. The bearer token is attached only
 * when the URL shares the Agnes origin — sending our API key to an arbitrary
 * CDN would leak it.
 */
export async function downloadUrl(
  url: string,
  dir: string,
  ext: string,
  signal?: AbortSignal,
  apiKey?: string,
): Promise<string | null> {
  try {
    await mkdir(dir, { recursive: true })
    const headers: Record<string, string> = {}
    if (typeof apiKey === 'string' && apiKey.length > 0 && isAgnesOrigin(url)) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const res = await fetch(url, { ...(Object.keys(headers).length > 0 ? { headers } : {}), ...(signal !== undefined ? { signal } : {}) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    const path = join(dir, `agnes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
    await writeFile(path, buf)
    return path
  } catch {
    return null
  }
}

/** True when the URL belongs to the Agnes object host (token may be attached). */
export function isAgnesOrigin(url: string): boolean {
  try {
    return /agnes-ai\.(cn|com)$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/** Prune oldest files so at most `keep` remain. Never throws. */
export async function pruneDownloads(dir: string, keep: number): Promise<void> {
  if (keep <= 0) return
  try {
    const entries = await readdir(dir)
    const withTime: Array<{ name: string; mtime: number }> = []
    for (const name of entries) {
      try {
        const s = await stat(join(dir, name))
        if (s.isFile()) withTime.push({ name, mtime: s.mtimeMs })
      } catch { /* skip unreadable entries */ }
    }
    if (withTime.length <= keep) return
    withTime.sort((a, b) => b.mtime - a.mtime)
    for (const victim of withTime.slice(keep)) {
      await unlink(join(dir, victim.name)).catch(() => {})
    }
  } catch { /* best effort */ }
}
