/** Committed install icon dimensions and the generator's mascot tile and safe-zone scale. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_ICON_VARIANTS, ICON_OUTPUT_DIRECTORY, MASKABLE_ARTWORK_SCALE, TILE_ARTWORK_SCALE, TILE_SOURCE,
  maskableDocument, tileDocument,
} from '../scripts/render-app-icons.ts'
import { pngSize } from './png-size.ts'

describe('web install icons', () => {
  it('ships every declared variant at its declared edge', async () => {
    for (const variant of APP_ICON_VARIANTS) {
      expect(pngSize(await readFile(join(ICON_OUTPUT_DIRECTORY, variant.file))))
        .toEqual([variant.size, variant.size])
    }
  })

  it('centres the mascot on an opaque tile and scales only the maskable artwork', async () => {
    const source = await readFile(TILE_SOURCE)
    const tile = tileDocument(source)
    const maskable = maskableDocument(source)
    const encoded = `data:image/png;base64,${source.toString('base64')}`
    expect(tile).toContain('viewBox="0 0 1024 1024"')
    expect(tile).toContain('<rect width="1024" height="1024" fill="#ffffff"/>')
    expect(tile).toContain(encoded)
    const edge = (document: string) => Number(/<image\b[^>]*\bwidth="([\d.]+)"/u.exec(document)![1])
    expect(edge(tile)).toBeCloseTo(1024 * TILE_ARTWORK_SCALE, 6)
    expect(edge(maskable)).toBeCloseTo(1024 * TILE_ARTWORK_SCALE * MASKABLE_ARTWORK_SCALE, 6)
    expect(maskable).toContain(encoded)
  })

  it('rejects non-PNG bytes and incomplete image headers', () => {
    expect(() => pngSize(Buffer.from('<svg/>'))).toThrow(/PNG IHDR/)
    expect(() => pngSize(Buffer.alloc(33))).toThrow(/PNG IHDR/)
  })

  it('fails loudly on a source that is not the mascot raster', () => {
    expect(() => tileDocument(Buffer.from(''))).toThrow(/not a PNG/)
    expect(() => maskableDocument(Buffer.from('<svg></svg>'))).toThrow(/not a PNG/)
  })
})
