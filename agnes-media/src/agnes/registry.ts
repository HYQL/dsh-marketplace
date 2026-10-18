/**
 * Credential + base-URL resolution.
 *
 * Resolution order for the API key:
 *   1. `apiKey` in the plugin config
 *   2. DSH `ctx.credentials.resolve(envName)` — provider-managed store, then the
 *      process environment and `.env` files (the same seam every other model
 *      provider uses, so a key configured in Settings → Models is visible here)
 *   3. process.env directly (for harnesses booted without the credentials service)
 *   4. `~/.dsh/.credentials.yaml` → `refs.<NAME>`
 *
 * Base URLs: config → model-registry provider → site default.
 *
 * @module agnes-media/agnes/registry
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { AgnesConfig, AgnesCredentials, Site } from '../types.ts'

const SITE_DEFAULT_BASE_URL: Readonly<Record<Site, string>> = {
  intl: 'https://apihub.agnes-ai.com',
  cn: 'https://api.agnes-ai.cn',
}

const FALLBACK_ENV: Readonly<Record<Site, readonly string[]>> = {
  intl: ['AGNES_API_KEY', 'AGNES_IMAGE_API_KEY', 'AGNES_AI_API_KEY'],
  cn: ['AGNES_API_KEY', 'AGNES_CN_API_KEY', 'AGNES_IMAGE_API_KEY', 'AGNES_AI_API_KEY'],
}

interface ProviderEntry {
  readonly apiKeyEnv?: string
  readonly baseURL?: string
}
interface DshSettings {
  readonly 'llm-pi-ai'?: { readonly providers?: Readonly<Record<string, ProviderEntry>> }
}

/** The slice of `ctx.credentials` this plugin uses. */
export interface CredentialsLike {
  resolve(ref: string): Promise<{ value: string; source: string } | undefined>
  describe?(ref: string): Promise<{ configured: boolean; source?: string }>
}

export class AgnesCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgnesCredentialError'
  }
}

export async function resolveCredentials(
  config: AgnesConfig,
  credentials?: CredentialsLike | undefined,
): Promise<AgnesCredentials> {
  const site = config.site

  let apiKey = config.apiKey
  let keySource: AgnesCredentials['keySource'] = 'config'
  if (apiKey === null) {
    const resolved = await resolveApiKey(site, credentials)
    apiKey = resolved.key
    keySource = resolved.source
  }
  if (apiKey === null || apiKey.length === 0) {
    throw new AgnesCredentialError(
      `agnes-media: no Agnes API key for site "${site}". Set "apiKey" in cordis.patch.yml, `
      + `an AGNES_API_KEY environment variable, or the AGNES_API_KEY credential in DSH settings.`,
    )
  }

  let imageBaseUrl = config.imageBaseURL
  if (imageBaseUrl === null) {
    const reg = await readProviderBaseURL('agnes-image')
    imageBaseUrl = reg !== null ? originOf(reg) : null
  }
  if (imageBaseUrl === null) imageBaseUrl = SITE_DEFAULT_BASE_URL[site]

  let videoBaseUrl = config.videoBaseURL
  if (videoBaseUrl === null) {
    const reg = await readProviderBaseURL('agnes')
    videoBaseUrl = reg !== null ? originOf(reg) : null
  }
  if (videoBaseUrl === null) videoBaseUrl = imageBaseUrl

  return { apiKey, imageBaseUrl, videoBaseUrl, keySource }
}

/** Cheap, non-throwing key probe for the panel's status line. */
export async function probeApiKey(
  config: AgnesConfig,
  credentials?: CredentialsLike | undefined,
): Promise<{ configured: boolean; source: AgnesCredentials['keySource'] }> {
  if (config.apiKey !== null) return { configured: true, source: 'config' }
  try {
    const resolved = await resolveApiKey(config.site, credentials)
    return { configured: resolved.key !== null, source: resolved.source }
  } catch {
    return { configured: false, source: 'unknown' }
  }
}

async function resolveApiKey(
  site: Site,
  credentials?: CredentialsLike | undefined,
): Promise<{ key: string | null; source: AgnesCredentials['keySource'] }> {
  for (const name of await apiKeyEnvNames(site)) {
    if (credentials !== undefined) {
      try {
        const resolved = await credentials.resolve(name)
        if (resolved !== undefined && resolved.value.length > 0) {
          return { key: resolved.value, source: sourceOf(resolved.source) }
        }
      } catch {
        // A failing credential store must not hide the env/file fallbacks.
      }
    }
    const fromEnv = process.env[name]
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return { key: fromEnv, source: 'env' }
    const fromFile = await readCredentialEntry(name)
    if (fromFile !== null) return { key: fromFile, source: 'credentials-file' }
  }
  return { key: null, source: 'unknown' }
}

function sourceOf(source: string): AgnesCredentials['keySource'] {
  if (source.includes('env')) return 'env'
  if (source.includes('file')) return 'credentials-file'
  return 'credentials'
}

async function apiKeyEnvNames(site: Site): Promise<readonly string[]> {
  const names: string[] = []
  const push = (v: string | undefined): void => {
    if (typeof v === 'string' && v.length > 0 && !names.includes(v)) names.push(v)
  }
  push((await readProviderEntry('agnes-image'))?.apiKeyEnv)
  push((await readProviderEntry('agnes'))?.apiKeyEnv)
  for (const n of FALLBACK_ENV[site]) push(n)
  return names
}

let cachedSettings: { value: DshSettings | null; ts: number } | null = null
let cachedCredentials: { value: Record<string, string>; ts: number } | null = null
const TTL_MS = 5_000

async function readSettings(): Promise<DshSettings | null> {
  const now = Date.now()
  if (cachedSettings !== null && now - cachedSettings.ts < TTL_MS) return cachedSettings.value
  const text = await readText(join(homedir(), '.dsh', 'settings.yaml'))
  let value: DshSettings | null = null
  if (text !== null) {
    try {
      value = parseYaml(text) as DshSettings
    } catch {
      value = null
    }
  }
  cachedSettings = { value, ts: now }
  return value
}

async function readProviderEntry(id: string): Promise<ProviderEntry | null> {
  return (await readSettings())?.['llm-pi-ai']?.providers?.[id] ?? null
}

async function readProviderBaseURL(id: string): Promise<string | null> {
  return (await readProviderEntry(id))?.baseURL ?? null
}

/**
 * `~/.dsh/.credentials.yaml` stores two maps: `records` (plugin-owned grants,
 * keyed by credential key) and `refs` (environment-variable references, keyed
 * by variable name). Only `refs` holds plain secret strings.
 */
async function readCredentials(): Promise<Record<string, string>> {
  const now = Date.now()
  if (cachedCredentials !== null && now - cachedCredentials.ts < TTL_MS) return cachedCredentials.value
  const text = await readText(join(homedir(), '.dsh', '.credentials.yaml'))
  const value: Record<string, string> = {}
  if (text !== null) {
    try {
      const parsed = parseYaml(text) as { refs?: Record<string, unknown> } | null
      const refs = parsed?.refs
      if (typeof refs === 'object' && refs !== null) {
        for (const [k, v] of Object.entries(refs)) if (typeof v === 'string') value[k] = v
      }
      // Legacy flat layout (top-level `NAME: secret`) still resolves.
      if (typeof parsed === 'object' && parsed !== null) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && value[k] === undefined) value[k] = v
        }
      }
    } catch {
      // Unreadable credentials file: treat as absent.
    }
  }
  cachedCredentials = { value, ts: now }
  return value
}

async function readCredentialEntry(name: string): Promise<string | null> {
  const v = (await readCredentials())[name]
  return typeof v === 'string' && v.length > 0 ? v : null
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}
