/**
 * Agnes image generation (synchronous POST /v1/images/generations).
 *
 * Two details this module owns because they are easy to get wrong:
 *   • `response_format` belongs inside `extra_body`, never at the top level.
 *   • reference images for image-to-image / multi-image composition belong in
 *     `extra_body.image` (an array of public URLs or `data:` URIs); the
 *     `tags: ["img2img"]` field some samples show is not needed.
 *
 * @module agnes-media/agnes/image
 */

import type { AgnesConfig, AgnesCredentials, ImageParams, ImageResponse } from '../types.ts'
import { agnesPost } from './http.ts'

export function imageEndpoint(creds: AgnesCredentials): string {
  return `${creds.imageBaseUrl.replace(/\/+$/, '')}/v1/images/generations`
}

/** Build the wire payload: top-level scalars, everything image-shaped in extra_body. */
export function buildImagePayload(params: ImageParams): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...(params.extra_body ?? {}) }
  const refs = params.image?.filter((u) => typeof u === 'string' && u.length > 0) ?? []
  if (refs.length > 0) extra.image = refs
  if (extra.response_format === undefined) extra.response_format = params.return_base64 === true ? 'b64_json' : 'url'

  const payload: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    size: params.size,
  }
  if (params.ratio !== undefined && params.ratio.length > 0) payload.ratio = params.ratio
  if (params.seed !== undefined) payload.seed = params.seed
  if (params.negative_prompt !== undefined && params.negative_prompt.length > 0) {
    payload.negative_prompt = params.negative_prompt
  }
  // `n` is accepted by the OpenAI-compatible schema; the 2.5 Flash model always
  // returns a single image, so callers clamp it before reaching this layer.
  if (params.n !== undefined) payload.n = params.n
  payload.extra_body = extra
  return payload
}

export async function generateImage(
  params: ImageParams,
  creds: AgnesCredentials,
  config: AgnesConfig,
  signal?: AbortSignal,
): Promise<ImageResponse> {
  return agnesPost<ImageResponse>(imageEndpoint(creds), buildImagePayload(params), creds, config, signal)
}

/** `size × ratio → pixels`, mirroring the published mapping table. */
export const SIZE_RATIO_PIXELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '1:1': { '1K': '1024×1024', '2K': '2048×2048', '3K': '3072×3072', '4K': '4096×4096' },
  '3:4': { '1K': '864×1152', '2K': '1728×2304', '3K': '2592×3456', '4K': '3456×4608' },
  '4:3': { '1K': '1152×864', '2K': '2304×1728', '3K': '3456×2592', '4K': '4608×3456' },
  '16:9': { '1K': '1312×736', '2K': '2624×1472', '3K': '3936×2208', '4K': '5248×2944' },
  '9:16': { '1K': '736×1312', '2K': '1472×2624', '3K': '2208×3936', '4K': '2944×5248' },
  '2:3': { '1K': '832×1248', '2K': '1664×2496', '3K': '2496×3744', '4K': '3328×4992' },
  '3:2': { '1K': '1248×832', '2K': '2496×1664', '3K': '3744×2496', '4K': '4992×3328' },
  '21:9': { '1K': '1568×672', '2K': '3136×1344', '3K': '4704×2016', '4K': '6272×2688' },
}
