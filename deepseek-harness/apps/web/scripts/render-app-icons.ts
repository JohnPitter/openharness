/**
 * Render the install icons of the Web application from the OpenHarness mascot.
 *
 * A browser installs a Web App only with a raster 192px and a 512px icon, masks
 * the icon it puts on the home screen, and has no manifest support for iOS,
 * which reads `apple-touch-icon` instead. The favicon is the bare mascot raster
 * (`public/mascot.png`, transparent, no tile): handed to a launcher directly it
 * has no background of its own and its edges meet the mask. This script places
 * the mascot on an opaque white tile and writes the committed PNGs under
 * `public/`. Every variant keeps the mascot at {@link TILE_ARTWORK_SCALE} of
 * the tile; the maskable variant additionally scales it inside the safe zone a
 * platform mask may crop, leaving the white tile to fill the icon so no mask
 * meets a seam.
 *
 * The committed PNGs are the output; rerun
 * `pnpm --filter @deepseek-ai/dsh-web-frontend run render:app-icons` after the
 * mascot artwork changes.
 * @module render-app-icons
 */

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertNever } from '@deepseek-ai/dsh-util-values'

/** Raster source: the transparent mascot the favicon and the brand slots also draw. */
export const TILE_SOURCE = fileURLToPath(new URL('../public/mascot.png', import.meta.url))

/** Directory the generated PNGs are committed to. */
export const ICON_OUTPUT_DIRECTORY = fileURLToPath(new URL('../public/', import.meta.url))

/** Tile edge in document units; every render density is expressed against it. */
const TILE_EDGE = 1024

/** Tile fill: the manifest's `background_color`, opaque so no launcher shows its own backdrop. */
const TILE_FILL = '#ffffff'

/**
 * Fraction of the tile edge the mascot occupies in every variant. The mascot's
 * darkest ink reaches 0.516 of its own edge from the centre, so 0.84 keeps it
 * about 0.433 of the tile from the centre — inside a launcher's rounded mask.
 */
export const TILE_ARTWORK_SCALE = 0.84

/** Density at which the document's own 1:1 scale renders. */
const SOURCE_DENSITY = 72

/** Samples per output pixel along each axis before reduction. */
const RENDER_SCALE = 4

/**
 * Fraction of a maskable icon's artwork kept relative to the tile variant: the
 * platform may crop the border outside it. The tile's mascot ink reaches 0.433
 * of its edge from the centre, so 0.82 keeps it near 0.355 — inside the 0.4
 * circle a mask always shows; `pwa-manifest.e2e.ts` checks the committed
 * artwork against that circle.
 */
export const MASKABLE_ARTWORK_SCALE = 0.82

/** Radius a platform mask is guaranteed to show, as a fraction of the icon edge. */
export const MASKABLE_SAFE_RADIUS_RATIO = 0.4

/** PNG file signature; the source must be the mascot raster, not a vector. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One committed install icon: the manifest or link member it serves and its edge in pixels. */
export interface AppIconVariant {
  /** File name inside `public/`. */
  readonly file: string
  /** Square edge in pixels. */
  readonly size: number
  /** Which rendering the platform receives. */
  readonly kind: 'tile' | 'maskable'
}

/**
 * Install icons the Web application ships. Chrome requires the 192px and 512px
 * raster pair to offer installation, prefers a maskable icon for the home
 * screen, and iOS reads the touch icon alone.
 */
export const APP_ICON_VARIANTS: readonly AppIconVariant[] = [
  { file: 'icon-192.png', size: 192, kind: 'tile' },
  { file: 'icon-512.png', size: 512, kind: 'tile' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'tile' },
]

/** Compose the white tile with the mascot centred at `scale` of its edge. */
function composedDocument(source: Buffer, scale: number): string {
  if (source.length < PNG_SIGNATURE.length || !source.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('app icons: the mascot source is not a PNG')
  }
  const edge = TILE_EDGE * scale
  const offset = (TILE_EDGE - edge) / 2
  return `<svg width="${String(TILE_EDGE)}" height="${String(TILE_EDGE)}"`
    + ` viewBox="0 0 ${String(TILE_EDGE)} ${String(TILE_EDGE)}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect width="${String(TILE_EDGE)}" height="${String(TILE_EDGE)}" fill="${TILE_FILL}"/>`
    + `<image href="data:image/png;base64,${source.toString('base64')}"`
    + ` x="${String(offset)}" y="${String(offset)}" width="${String(edge)}" height="${String(edge)}"/>`
    + '</svg>'
}

/**
 * Place the mascot on the opaque tile.
 * @param source - `mascot.png` bytes.
 * @returns an SVG document whose 1024-unit square is the tile with the mascot.
 */
export function tileDocument(source: Buffer): string {
  return composedDocument(source, TILE_ARTWORK_SCALE)
}

/**
 * Place the mascot on the opaque tile inside a maskable icon's safe zone. The
 * tile keeps its full extent, so the border a mask may crop is still the tile.
 * @param source - `mascot.png` bytes.
 * @returns an SVG document whose artwork survives a circular mask whole.
 */
export function maskableDocument(source: Buffer): string {
  return composedDocument(source, TILE_ARTWORK_SCALE * MASKABLE_ARTWORK_SCALE)
}

/**
 * Rasterize one composed document at a square edge.
 * @param document - output of {@link tileDocument} or {@link maskableDocument}.
 * @param size - square edge in pixels.
 * @returns the PNG bytes.
 */
async function renderPng(document: string, size: number): Promise<Buffer> {
  const { default: sharp } = await import('sharp')
  const renderSize = Math.max(TILE_EDGE, size * RENDER_SCALE)
  // A separate raster at a supersampled edge prevents SVG resize
  // optimizations from bypassing the Lanczos downsampling step.
  const raster = await sharp(Buffer.from(document), { density: SOURCE_DENSITY * renderSize / TILE_EDGE })
    .png()
    .toBuffer()
  return sharp(raster)
    .resize(size, size, { kernel: 'lanczos3' })
    .flatten({ background: TILE_FILL })
    .png()
    .toBuffer()
}

function documentForVariant(source: Buffer, kind: AppIconVariant['kind']): string {
  switch (kind) {
    case 'tile': return tileDocument(source)
    case 'maskable': return maskableDocument(source)
    default: return assertNever(kind)
  }
}

/**
 * Render every install icon from the mascot source.
 * @param source - `mascot.png` bytes.
 * @returns one PNG per {@link APP_ICON_VARIANTS} entry, in declaration order.
 */
export async function renderAppIcons(source: Buffer): Promise<readonly { variant: AppIconVariant; png: Buffer }[]> {
  return Promise.all(APP_ICON_VARIANTS.map(async variant => ({
    variant,
    png: await renderPng(
      documentForVariant(source, variant.kind),
      variant.size,
    ),
  })))
}

async function main(): Promise<void> {
  const icons = await renderAppIcons(await readFile(TILE_SOURCE))
  await Promise.all(icons.map(async ({ variant, png }) => {
    await writeFile(resolve(ICON_OUTPUT_DIRECTORY, variant.file), png)
  }))
  console.info(`app icons: wrote ${icons.map(icon => icon.variant.file).join(', ')} to ${ICON_OUTPUT_DIRECTORY}`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
