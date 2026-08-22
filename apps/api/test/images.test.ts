import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalisePhoto, PHOTO_EDGE_PX } from '../src/storage/images.js'

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 1200, height: 900, channels: 3, background: '#c1440e' } })
    // sharp's `Exif` type only permits numbered IFD blocks (IFD0-3), not a
    // literal `GPS` key -- see node_modules/sharp/dist/output.cjs's own
    // withExif() JSDoc example, which puts GPS tags under `IFD3`.
    .withExif({ IFD0: { Copyright: 'test' }, IFD3: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' } })
    .jpeg()
    .toBuffer()
}

/**
 * Reads a single pixel's RGB out of a webp buffer by decoding to raw and
 * indexing directly -- used by the orientation test below to prove pixel
 * content actually moved, not just that dimensions changed.
 */
async function pixelAt(webp: Buffer, x: number, y: number): Promise<{ r: number; g: number; b: number }> {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true })
  const idx = (y * info.width + x) * info.channels
  return { r: data[idx]!, g: data[idx + 1]!, b: data[idx + 2]! }
}

describe('normalisePhoto', () => {
  it('strips every EXIF block including GPS', async () => {
    const out = await normalisePhoto(await jpegWithGps())
    const meta = await sharp(out).metadata()
    expect(meta.exif).toBeUndefined()
  })

  it('bounds the long edge and produces webp', async () => {
    const out = await normalisePhoto(await jpegWithGps())
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(PHOTO_EDGE_PX)
  })

  it('rejects a file that is not an image', async () => {
    await expect(normalisePhoto(Buffer.from('this is not an image'))).rejects.toThrow()
  })

  // The content-type allowlist declared in the contracts (`PresignBody`,
  // `PHOTO_CONTENT_TYPES`) has NO enforcement point at upload time:
  // `@aws-sdk/s3-request-presigner` puts `content-type` in its
  // `unsignableHeaders`, so the `ContentType` passed at presign time never
  // binds what the client actually PUTs. `normalisePhoto` is therefore the
  // only place the allowlist is real, and it must reject anything sharp
  // decodes that isn't jpeg/png/webp.
  it('rejects a decodable image whose format is not on the allowlist', async () => {
    const gif = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#00ff00' } })
      .gif()
      .toBuffer()
    await expect(normalisePhoto(gif)).rejects.toThrow(/unsupported/i)
  })

  it('accepts each of the three allowed formats', async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#123456' } })
      .png()
      .toBuffer()
    const webp = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#654321' } })
      .webp()
      .toBuffer()
    const jpeg = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#abcdef' } })
      .jpeg()
      .toBuffer()

    for (const input of [png, webp, jpeg]) {
      const out = await normalisePhoto(input)
      expect((await sharp(out).metadata()).format).toBe('webp')
    }
  })

  // The single highest-risk detail in this module: `.rotate()` must run
  // BEFORE metadata is stripped, or every portrait phone photo comes out
  // sideways. `withExif({ IFD0: { Orientation: '6' } })` does NOT exercise
  // this -- verified by hand that it writes a generic string EXIF field
  // that libvips's loader does not recognise as the real orientation tag
  // (a fresh `sharp(buf).metadata()` reports `orientation: 1`, unchanged).
  // `withMetadata({ orientation: 6 })` is sharp's actual API for this: it
  // writes the real numeric EXIF Orientation tag that `.rotate()`'s
  // auto-detection reads (confirmed: `metadata().autoOrient` reports the
  // swapped 200x400 dimensions before any rotate() call happens).
  //
  // `normalisePhoto` also resizes with `fit: 'cover'` to a fixed 800x800
  // square, so final WIDTH/HEIGHT are always 800x800 regardless of
  // orientation -- a dimensions-only assertion would pass even with
  // `.rotate()` deleted or moved after the resize. So this asserts on pixel
  // CONTENT instead: a distinctive colour band is placed across the full
  // WIDTH of the top of the raw (pre-rotation) 400x200 image. EXIF
  // orientation 6 means "rotate 90 CW to display correctly" -- applying
  // that turns a full-width top band into a full-height band on the RIGHT
  // side of the (now 200x400) corrected image. `fit: 'cover'` onto a square
  // crops the corrected image's height but never its width, so that
  // right-side band survives at a known final x-range (x >= 600 of 800)
  // untouched, while the opposite edge (x <= 200) stays the background
  // colour. If `.rotate()` were missing (or ran after the crop/resize
  // instead of before), the band would still be a TOP band after scaling
  // -- verified by hand that both check pixels below read as background
  // colour in that case, so this assertion is not vacuously true.
  it('applies the EXIF rotation before stripping metadata, not after', async () => {
    const width = 400
    const height = 200
    const bandHeight = 50
    const background = sharp({ create: { width, height, channels: 3, background: '#0000ff' } })
    const band = await sharp({ create: { width, height: bandHeight, channels: 3, background: '#ff0000' } })
      .png()
      .toBuffer()

    const rotatedRight = await background
      .composite([{ input: band, top: 0, left: 0 }])
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()

    const out = await normalisePhoto(rotatedRight)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(PHOTO_EDGE_PX)
    expect(meta.height).toBe(PHOTO_EDGE_PX)

    const rightEdge = await pixelAt(out, 750, 400)
    const leftEdge = await pixelAt(out, 50, 400)

    // Right edge should be the rotated band (red-ish); left edge the
    // untouched background (blue-ish). A generous threshold absorbs webp's
    // lossy re-encoding of the jpeg source.
    expect(rightEdge.r).toBeGreaterThan(180)
    expect(rightEdge.b).toBeLessThan(80)
    expect(leftEdge.b).toBeGreaterThan(180)
    expect(leftEdge.r).toBeLessThan(80)
  })
})
