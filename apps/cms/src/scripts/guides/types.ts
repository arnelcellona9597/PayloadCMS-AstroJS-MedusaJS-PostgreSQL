/**
 * The shape of one guide, and the mini-markdown its body is written in.
 *
 * ── The mini-format in `body` ─────────────────────────────────────────────
 *
 * Each entry is one block. A tiny markdown subset is parsed by `richText()` in
 * ../seed.ts into real Lexical nodes:
 *
 *   "## Text"    → heading (h2)
 *   "### Text"   → heading (h3)
 *   "- Text"     → bulleted list item (consecutive ones merge into one list)
 *   "1. Text"    → numbered list item (likewise)
 *   "> Text"     → blockquote
 *   "---"        → horizontal rule
 *   anything else→ paragraph
 *
 * Inline `backticks` become Lexical's CODE format (bitmask 16) and **double
 * asterisks** become BOLD (bitmask 1).
 *
 * ⚠️ There is deliberately no fenced-code-block syntax. Lexical's `code` node is
 * not in the storefront renderer's switch (apps/storefront/src/lib/lexical.ts),
 * so a fenced block would render as an unstyled paragraph. Inline code is
 * supported and is what these guides use. Commands that need a real code block
 * live in docs/how-to/, which the guides reference by name.
 *
 * ⚠️ There is no link syntax either. Reference a document in prose
 * ("see docs/learn/13-deploying-it.md"), not as a markdown link — the renderer
 * would emit the brackets literally.
 *
 * ── Honesty labels ────────────────────────────────────────────────────────
 *
 * Guides describing things this repo does not do must say so, using the same
 * three markers the documentation uses:
 *
 *   ✅ running here — real, and you can verify it today
 *   📋 supported but not configured in this repo
 *   🚫 not in this repo at all; conceptual only
 */

export type Guide = {
  /**
   * ⚠️ Becomes a UNIQUE slug via `toSlug()`, which DELETES punctuation rather
   * than replacing it — so "How to debug" and "How to debug?" collide, as do
   * "Draft: X" and "Draft X". A collision aborts the seed mid-loop, after the
   * delete pass has already run. `npm run guides:check` catches it first.
   *
   * Maximum 200 characters, and the cover image elides past roughly 104.
   */
  title: string
  /** Must match a `name` in categorySeeds exactly, or the post lands uncategorised. */
  category: string
  status: 'published' | 'draft'
  /** Maximum 300 characters — enforced by the collection and by the storefront's zod schema. */
  excerpt: string
  tags: string[]
  body: string[]
}

/**
 * A guide before it is given a date.
 *
 * `publishedAt` is deliberately NOT written by hand. The previous version of
 * this file numbered every guide with an explicit hour offset, which works at 32
 * and becomes a bookkeeping exercise at 88 — one duplicated number silently
 * breaks `sort: '-publishedAt'`. index.ts now stamps them from array position,
 * so the ordering is a property of the list rather than something to maintain.
 */
export type DatedGuide = Guide & {
  publishedAt: string
  /**
   * Curriculum position, 1-based. The archive's default sort.
   *
   * Separate from `publishedAt` on purpose: "when was this written" and "where
   * does it belong in the path" are different questions, and a guide can be
   * revised today without ceasing to be step 3.
   */
  order: number
}
