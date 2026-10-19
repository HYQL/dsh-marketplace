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
