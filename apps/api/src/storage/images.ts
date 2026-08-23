import sharp from 'sharp'
import type { PHOTO_CONTENT_TYPES } from '@tennis/contracts'

export const PHOTO_EDGE_PX = 800

type AllowedContentType = (typeof PHOTO_CONTENT_TYPES)[number]

// Maps sharp's detected format string (`metadata().format`, e.g. 'jpeg') back
// to the MIME types the presign step allows. Keyed by `AllowedContentType` so
// adding an entry to `PHOTO_CONTENT_TYPES` without updating this map is a
// compile error, not a silent gap in enforcement.
const SHARP_FORMAT_BY_CONTENT_TYPE: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const ALLOWED_SHARP_FORMATS = new Set(Object.values(SHARP_FORMAT_BY_CONTENT_TYPE))

/**
 * Re-encodes an uploaded photo to a bounded webp with NO metadata. sharp drops
 * all EXIF unless `withMetadata()` is called, which is exactly what we want:
 * phone photos carry GPS coordinates and these are pictures of real people.
 *
 * This is also the ONLY place the content-type allowlist is actually
 * enforced. `@aws-sdk/s3-request-presigner` puts `content-type` in its
 * `unsignableHeaders` by design, so the `ContentType` passed to
 * `PutObjectCommand` at presign time is excluded from the SigV4 signature
 * and never binds what the client actually PUTs to storage -- a client can
 * presign as `image/jpeg` and then upload anything. sharp's own detected
 * format, read back at confirm time, is the only truthful check available,
 * which is why it lives here rather than at the route layer: this function
 * is the trust boundary, and any caller of it gets the check for free.
 */
export async function normalisePhoto(input: Buffer): Promise<Buffer> {
  const metadata = await sharp(input, { failOn: 'error' }).metadata()
  if (!metadata.format || !ALLOWED_SHARP_FORMATS.has(metadata.format)) {
    throw new Error(`Unsupported image format: ${metadata.format ?? 'unknown'}`)
  }
  return sharp(input, { failOn: 'error' })
    .rotate() // apply the EXIF orientation before discarding it
    .resize({ width: PHOTO_EDGE_PX, height: PHOTO_EDGE_PX, fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer()
}
