/**
 * Model discovery from the gateway.
 *
 * @module agnes-media/agnes/models
 */

import type { AgnesConfig, AgnesCredentials, GatewayModel } from '../types.ts'
import { agnesGet } from './http.ts'

/** GET /v1/models, optionally filtered by family. */
export async function listModels(
  creds: AgnesCredentials,
  config: AgnesConfig,
  family: 'image' | 'video' | null,
  signal?: AbortSignal,
): Promise<readonly GatewayModel[]> {
  const url = `${creds.videoBaseUrl.replace(/\/+$/, '')}/v1/models`
  const parsed = await agnesGet<{ data?: readonly Record<string, unknown>[] }>(url, creds, config, signal)
  const rows = Array.isArray(parsed?.data) ? parsed.data : []
  const out: GatewayModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : typeof row.model === 'string' ? row.model : null
    if (id === null || seen.has(id)) continue
    if (family === 'video' && !/video/i.test(id)) continue
    if (family === 'image' && !/image/i.test(id)) continue
    seen.add(id)
    out.push({ id, ...(typeof row.name === 'string' && row.name.length > 0 ? { name: row.name } : {}) })
  }
  out.sort((a, b) => a.id.localeCompare(b.id))
  return out
}

export async function listVideoModels(
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<readonly GatewayModel[]> {
  return listModels(creds, config, 'video', signal)
}

export async function listImageModels(
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<readonly GatewayModel[]> {
  return listModels(creds, config, 'image', signal)
}
