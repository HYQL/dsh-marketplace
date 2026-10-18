/**
 * Turning a local file into something Agnes accepts as a reference image.
 *
 * The API takes reference images as either a public HTTPS URL or a `data:`
 * URI. Local files therefore become data URIs — no hosting, no upload server.
 *
 * Two practical constraints drive the code below:
 *   • The Host caps a request body at 32 MiB, and base64 inflates by ~4/3, so
 *     a raw 8 MiB photo would already be a 10.7 MiB field. Large inputs are
 *     therefore downscaled first, which also keeps generation fast.
 *   • A reference image does not need to be full resolution: the model sees it
 *     as conditioning, so 2048 px on the long edge is plenty.
 *
 * @module agnes-media/client/upload
 */

/** Longest edge kept when re-encoding a large input. */
const MAX_EDGE = 2048
/** Above this, an image is re-encoded rather than passed through. */
const PASSTHROUGH_BYTES = 1.5 * 1024 * 1024
/** Hard reject: no re-encode can rescue a file this large within the body cap. */
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024
/** The gateway accepts at most 5 reference images. */
export const MAX_REFERENCES = 5

export interface ReferenceImage {
  readonly id: string
  /** `data:image/...;base64,...` — what the request carries. */
  readonly dataUri: string
  readonly name: string
  /** Approximate encoded size in bytes, for the UI. */
  readonly bytes: number
  /** What to render in the thumbnail (same as dataUri; kept separate for clarity). */
  readonly preview: string
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UploadError'
  }
}

let counter = 0

/** Read one file into a reference image, downscaling when it is large. */
export async function toReferenceImage(file: File): Promise<ReferenceImage> {
  if (!file.type.startsWith('image/')) {
    throw new UploadError(`not an image: ${file.name}`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new UploadError(`file too large: ${file.name} (${formatBytes(file.size)})`)
  }

  const dataUri = file.size <= PASSTHROUGH_BYTES
    ? await readAsDataUri(file)
    : await downscale(file)

  counter += 1
  return {
    id: `ref_${Date.now().toString(36)}_${counter}`,
    dataUri,
    name: file.name,
    bytes: Math.round(dataUri.length * 0.75),
    preview: dataUri,
  }
}

/** Collect files from an input or a drop, up to the remaining capacity. */
export async function toReferenceImages(
  files: readonly File[],
  already: number,
): Promise<{ added: ReferenceImage[]; errors: string[] }> {
  const room = Math.max(0, MAX_REFERENCES - already)
  const picked = [...files].slice(0, room)
  const added: ReferenceImage[] = []
  const errors: string[] = []
  if (files.length > room) errors.push(`only ${MAX_REFERENCES} reference images are used`)
  for (const file of picked) {
    try {
      added.push(await toReferenceImage(file))
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { added, errors }
}

function readAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string' && result.startsWith('data:')) resolve(result)
      else reject(new UploadError(`could not read ${file.name}`))
    }
    reader.onerror = () => reject(new UploadError(`could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

/**
 * Decode, fit inside MAX_EDGE, and re-encode.
 *
 * PNG stays PNG when the source had transparency; everything else becomes JPEG,
 * which is far smaller for photographic references.
 */
async function downscale(file: File): Promise<string> {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (ctx === null) throw new UploadError('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if (typeof bitmap.close === 'function') bitmap.close()

  const keepAlpha = file.type === 'image/png' || file.type === 'image/webp'
  const encoded = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92)
  if (!encoded.startsWith('data:')) throw new UploadError(`could not encode ${file.name}`)
  return encoded
}

type Bitmap = ImageBitmap | HTMLImageElement

async function loadBitmap(file: File): Promise<Bitmap & { close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Fall through to the <img> path (older engines, odd formats).
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new UploadError(`could not decode ${file.name}`))
      el.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
