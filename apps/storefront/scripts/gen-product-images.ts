/**
 * Draws a cover image for every product in the Medusa catalogue.
 *
 *   npx tsx scripts/gen-product-images.ts        (from apps/storefront)
 *
 * Output goes to `public/products/<handle>.png`, which this app serves
 * statically. The Medusa seed references them as
 * `${STOREFRONT_URL}/products/<handle>.png`.
 *
 * ── Why here and not in the commerce app ──────────────────────────────────
 *
 * Two reasons. `sharp` is already a dependency of this app and is not one of
 * Medusa's, and these are static assets that need an HTTP server in front of
 * them — which this app is and Medusa is not.
 *
 * The stock Medusa seed points `images` at a public S3 bucket, so the demo only
 * looks right with an internet connection and the pictures are of t-shirts.
 * Generating them keeps the catalogue coherent and working offline.
 *
 * ⚠️ This imports the catalogue across app boundaries, which app code must
 * never do — the three apps talk over HTTP, not imports. It is tolerable in a
 * one-off dev script whose whole job is to stay in step with that file, and it
 * is the reason this lives in `scripts/` rather than `src/`.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

import { catalogueSeeds, usdFromEur } from '../../commerce/src/scripts/catalogue'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/products')

/** 4:3 suits the three-column card grid on /products. */
const WIDTH = 1200
const HEIGHT = 900

const ACCENTS: Record<string, string> = {
  'Hosting & VPS': '#7c3f16',
  'Managed Databases': '#2f6b45',
  'Edge & CDN': '#1f4f6b',
  Security: '#9c2f2f',
  Observability: '#4a3b6b',
  'Plugins & Extensions': '#8a5a10',
}

const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** SVG `<text>` does not wrap; every line has to be placed individually. */
const wrap = (text: string, perLine: number): string[] => {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (candidate.length > perLine && line) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line) lines.push(line)
  return lines
}

const run = async () => {
  await mkdir(OUT, { recursive: true })

  for (const product of catalogueSeeds) {
    const accent = ACCENTS[product.category] ?? '#4a4a4a'
    const cheapest = Math.min(...product.variants.map((v) => v.eur))
    const lines = wrap(product.title, 20)

    const lineHeight = 86
    const firstBaseline = HEIGHT / 2 - (lines.length * lineHeight) / 2 + lineHeight * 0.8

    const titleLines = lines
      .map(
        (line, i) =>
          `<text x="80" y="${firstBaseline + i * lineHeight}" class="t">${escapeXml(line)}</text>`,
      )
      .join('\n    ')

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#16150f"/>
        <stop offset="100%" stop-color="#262117"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <rect x="0" y="0" width="14" height="${HEIGHT}" fill="${accent}"/>
    <circle cx="${WIDTH - 150}" cy="150" r="54" fill="none" stroke="${accent}" stroke-width="3" opacity="0.5"/>
    <circle cx="${WIDTH - 150}" cy="150" r="30" fill="${accent}" opacity="0.25"/>
    <style>
      .t { font-family: Georgia, 'DejaVu Serif', serif; font-size: 64px; fill: #f2efe6; }
      .k { font-family: 'DejaVu Sans Mono', monospace; font-size: 26px; fill: ${accent}; letter-spacing: 3px; }
      .p { font-family: 'DejaVu Sans', sans-serif; font-size: 34px; fill: #c9c2b2; }
      .s { font-family: 'DejaVu Sans', sans-serif; font-size: 24px; fill: #8a8372; }
    </style>
    <text x="80" y="120" class="k">${escapeXml(product.category.toUpperCase())}</text>
    ${titleLines}
    <text x="80" y="${HEIGHT - 120}" class="p">from €${cheapest} · $${usdFromEur(cheapest)}</text>
    <text x="80" y="${HEIGHT - 70}" class="s">${product.variants.length} plan${product.variants.length === 1 ? '' : 's'}</text>
  </svg>`

    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
    await writeFile(resolve(OUT, `${product.handle}.png`), png)

    // eslint-disable-next-line no-console
    console.log(`  ${product.handle.padEnd(38)} ${String(png.length).padStart(7)} bytes`)
  }

  // eslint-disable-next-line no-console
  console.log(`\n  ${catalogueSeeds.length} product images written to public/products/`)
}

await run()
