/**
 * Generates cover images for the seeded guides.
 *
 * ── Why generate rather than download ─────────────────────────────────────
 *
 * The alternative is pointing at a placeholder service, which means the seed
 * only works online and the images change under you. These are drawn locally
 * from an SVG string and rasterised with sharp — which Payload already depends
 * on, because it uses it to produce the `thumbnail` and `card` derivatives.
 *
 * ── Why PNG and not SVG ───────────────────────────────────────────────────
 *
 * `Media.ts` allows any `image/*`, and sharp can read SVG. But Payload stores
 * width and height from the uploaded file and generates raster derivatives, so
 * handing it a vector means the original and its two derivatives are different
 * kinds of thing. Rasterising here keeps all three consistent, and costs one
 * call.
 *
 * This is the only code in the repo that exercises the `upload` field — before
 * this, `apps/cms/public/media` had never held a file.
 */
import sharp from 'sharp'

/** 1536×864 is 16:9 and divides cleanly into both configured sizes. */
const WIDTH = 1536
const HEIGHT = 864

/**
 * One accent per category, drawn from the storefront's own palette so the
 * covers do not fight the UI they appear in.
 */
const ACCENTS: Record<string, string> = {
  'Getting Started': '#7c3f16',
  'Content Modelling': '#2f6b45',
  Frontend: '#8a5a10',
  Commerce: '#9c2f2f',
  'Data & APIs': '#1f4f6b',
  'Operations & Tooling': '#4a3b6b',
  'Deployment & Infrastructure': '#1f5f5b',
  Security: '#6b2f4a',
  Performance: '#5a6b1f',
  'Testing & Quality': '#2f4a6b',
}

const FALLBACK = '#4a4a4a'

/** SVG has five characters that must be escaped, or the document will not parse. */
const escapeXml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/**
 * Wrap on word boundaries at a fixed character count.
 *
 * SVG has no text flow — `<text>` renders one line and silently overflows the
 * viewport. Every line has to be positioned individually, so the wrapping has
 * to happen here rather than in the renderer.
 */
const wrap = (text: string, perLine: number, maxLines: number): string[] => {
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

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[,.;:]$/, '')}…`
    return kept
  }
  return lines
}

export type CoverInput = {
  title: string
  category: string
}

/**
 * Draw one cover and return it as a PNG buffer, ready for Payload's Local API
 * upload form: `file: { data, mimetype, name, size }`.
 */
export const renderCover = async ({ title, category }: CoverInput): Promise<Buffer> => {
  const accent = ACCENTS[category] ?? FALLBACK
  const lines = wrap(title, 26, 4)

  // Vertically centre the block of lines around the middle of the canvas.
  const lineHeight = 104
  const blockHeight = lines.length * lineHeight
  const firstBaseline = HEIGHT / 2 - blockHeight / 2 + lineHeight * 0.78

  const titleLines = lines
    .map(
      (line, i) =>
        `<text x="96" y="${firstBaseline + i * lineHeight}" class="t">${escapeXml(line)}</text>`,
    )
    .join('\n    ')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#14130f"/>
        <stop offset="100%" stop-color="#231f18"/>
      </linearGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
    <rect x="0" y="0" width="16" height="${HEIGHT}" fill="${accent}"/>
    <style>
      .t { font-family: Georgia, 'DejaVu Serif', serif; font-size: 76px; fill: #f2efe6; }
      .k { font-family: 'DejaVu Sans Mono', monospace; font-size: 30px; fill: ${accent};
           letter-spacing: 3px; text-transform: uppercase; }
      .f { font-family: 'DejaVu Sans', sans-serif; font-size: 28px; fill: #8a8372; }
    </style>
    <text x="96" y="140" class="k">${escapeXml(category)}</text>
    ${titleLines}
    <text x="96" y="${HEIGHT - 86}" class="f">Astro · Payload · Medusa</text>
  </svg>`

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
}

/** Payload uses the filename for the stored file and its derivatives. */
export const coverFilename = (slug: string): string => `${slug}-cover.png`
