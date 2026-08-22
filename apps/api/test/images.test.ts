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
})
