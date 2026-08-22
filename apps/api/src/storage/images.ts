import sharp from 'sharp'

export const PHOTO_EDGE_PX = 800

/**
 * Re-encodes an uploaded photo to a bounded webp with NO metadata. sharp drops
 * all EXIF unless `withMetadata()` is called, which is exactly what we want:
 * phone photos carry GPS coordinates and these are pictures of real people.
 */
export async function normalisePhoto(input: Buffer): Promise<Buffer> {
  return sharp(input, { failOn: 'error' })
    .rotate() // apply the EXIF orientation before discarding it
    .resize({ width: PHOTO_EDGE_PX, height: PHOTO_EDGE_PX, fit: 'cover', position: 'centre' })
    .webp({ quality: 82 })
    .toBuffer()
}
