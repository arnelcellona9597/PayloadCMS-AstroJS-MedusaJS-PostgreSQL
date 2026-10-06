/**
 * Validate the guide data BEFORE the seed touches the database.
 *
 *   npm run guides:check
 *
 * ── Why this exists as a separate command ─────────────────────────────────
 *
 * `seed.ts` deletes every post before it creates any. So a guide that fails
 * halfway — a duplicate slug, an over-long excerpt — leaves the database with
 * *fewer* posts than it started with, and the failure message points at the one
 * bad guide rather than at the fact that the other hundred are now gone.
 *
 * Every check here is cheap and pure. Running it first turns a destructive
 * mid-flight failure into a list of things to fix.
 *
 * Imports no database and no Payload config, so it runs in milliseconds and
 * works with the stack switched off.
 */
import { categorySeeds, guideSeeds } from './guides'
import { toSlug } from '../hooks/slugify'

/** Mirrors the collection's own limits, and the storefront's zod schema. */
const MAX_TITLE = 200
const MAX_EXCERPT = 300

/** `renderCover()` wraps at 26 characters over 4 lines, then elides. */
const COVER_BUDGET = 26 * 4

type Problem = { guide: string; detail: string }

const problems: Problem[] = []
const warnings: Problem[] = []

const fail = (guide: string, detail: string) => problems.push({ guide, detail })
const warn = (guide: string, detail: string) => warnings.push({ guide, detail })

// ── Per-guide checks ────────────────────────────────────────────────────────
const categoryNames = new Set<string>(categorySeeds.map((c) => c.name))
const slugs = new Map<string, string>()
const orders = new Map<number, string>()

for (const guide of guideSeeds) {
  const { title } = guide

  if (title.length > MAX_TITLE) {
    fail(title, `title is ${title.length} characters, limit is ${MAX_TITLE}`)
  }

  if (guide.excerpt.length > MAX_EXCERPT) {
    fail(title, `excerpt is ${guide.excerpt.length} characters, limit is ${MAX_EXCERPT}`)
  }

  if (!categoryNames.has(guide.category)) {
    fail(
      title,
      `category "${guide.category}" is not in categorySeeds — the post would land uncategorised`,
    )
  }

  /**
   * The one that actually breaks the seed. `toSlug` DELETES punctuation rather
   * than replacing it, so "How to debug" and "How to debug?" collide — and
   * `slug` is unique, so the second create throws mid-loop.
   */
  const slug = toSlug(title)
  const clash = slugs.get(slug)
  if (clash) {
    fail(title, `slug "${slug}" collides with "${clash}"`)
  } else {
    slugs.set(slug, title)
  }

  const orderClash = orders.get(guide.order)
  if (orderClash) {
    fail(title, `order ${guide.order} is also used by "${orderClash}"`)
  } else {
    orders.set(guide.order, title)
  }

  if (guide.body.length === 0) fail(title, 'body is empty')
  if (guide.tags.length === 0) warn(title, 'has no tags')

  // Not fatal — the cover still renders, it just elides mid-sentence.
  if (title.length > COVER_BUDGET) {
    warn(title, `title is ${title.length} characters and the cover elides past ~${COVER_BUDGET}`)
  }

  /**
   * The body format has no link syntax and no fenced code blocks; both would
   * render as literal characters in the storefront. Cheap to catch here.
   */
  for (const block of guide.body) {
    if (/\[[^\]]+\]\([^)]+\)/.test(block)) {
      warn(title, 'body contains markdown link syntax, which renders literally')
      break
    }
  }
  for (const block of guide.body) {
    if (block.trimStart().startsWith('```')) {
      warn(title, 'body contains a fenced code block, which renders as an unstyled paragraph')
      break
    }
  }
}

// ── Whole-collection checks ─────────────────────────────────────────────────
const expected = guideSeeds.length
const contiguous = [...orders.keys()].sort((a, b) => a - b)
if (
  contiguous.length === expected &&
  (contiguous[0] !== 1 || contiguous[expected - 1] !== expected)
) {
  fail(
    '(collection)',
    `order values should run 1..${expected}, got ${contiguous[0]}..${contiguous[expected - 1]}`,
  )
}

/**
 * The storefront builds its filter chips straight from `categorySeeds`, while
 * the reading order comes from the guide array. If the two disagree, the chips
 * read in one order and the guides in another — which looks like a bug in the
 * page and is actually a mismatch here.
 */
const curriculumOrder = [...new Set(guideSeeds.map((g) => g.category))]
const declaredOrder = categorySeeds.map((c) => c.name).filter((n) => curriculumOrder.includes(n))
if (declaredOrder.join('|') !== curriculumOrder.join('|')) {
  fail(
    '(collection)',
    `categorySeeds order does not match reading order.\n      declared:   ${declaredOrder.join(' → ')}\n      curriculum: ${curriculumOrder.join(' → ')}`,
  )
}

const unusedCategories = categorySeeds
  .map((c) => c.name)
  .filter((name) => !guideSeeds.some((g) => g.category === name))
for (const name of unusedCategories) {
  warn('(collection)', `category "${name}" has no guides — it will be created and sit empty`)
}

// ── Report ──────────────────────────────────────────────────────────────────
const byCategory = new Map<string, number>()
for (const g of guideSeeds) byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + 1)

console.log(
  `\n  ${guideSeeds.length} guides, ${categorySeeds.length} categories, in reading order:\n`,
)
for (const { name } of categorySeeds) {
  const count = byCategory.get(name) ?? 0
  const first = guideSeeds.find((g) => g.category === name)?.order
  const last = [...guideSeeds].reverse().find((g) => g.category === name)?.order
  const span = count ? `${first}–${last}` : '—'
  console.log(`    ${String(count).padStart(3)}  ${name.padEnd(30)} ${span}`)
}

const drafts = guideSeeds.filter((g) => g.status === 'draft').length
console.log(
  `\n  ${guideSeeds.length - drafts} published, ${drafts} draft, ${slugs.size} distinct slugs`,
)

if (warnings.length) {
  console.log(`\n  ${warnings.length} warning(s):`)
  for (const w of warnings) console.log(`    · ${w.guide}\n      ${w.detail}`)
}

if (problems.length) {
  console.error(`\n  ${problems.length} problem(s) — the seed would fail or corrupt data:\n`)
  for (const p of problems) console.error(`    ✗ ${p.guide}\n      ${p.detail}`)
  console.error('\n  Fix these before running the seed.\n')
  process.exit(1)
}

console.log('\n  No problems. Safe to seed.\n')
