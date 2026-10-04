/**
 * Shapes the storefront works with.
 *
 * These are hand-written on purpose, and it is worth understanding why they are
 * NOT imported from the backends:
 *
 *   • Payload generates `apps/cms/src/payload-types.ts` from its collection
 *     config. Importing it would couple the storefront to the CMS's file layout
 *     and drag Payload's whole type graph in.
 *   • Medusa generates types into `apps/commerce/.medusa/types`, which only
 *     exists after a build.
 *
 * Declaring the contract here — the subset the storefront actually consumes —
 * keeps the three apps independently buildable. The trade-off is real: these can
 * drift from the backends, and nothing but `astro check` will tell you. In a
 * monorepo you would extract a shared package; kept local here so each app stays
 * readable on its own.
 */

// ── Payload ─────────────────────────────────────────────────────────────────

export type LexicalNode = {
  type: string
  text?: string
  format?: number | string
  tag?: string
  listType?: string
  url?: string
  fields?: { url?: string; newTab?: boolean }
  children?: LexicalNode[]
}

export type LexicalRoot = {
  root: LexicalNode
}

export type Category = {
  id: number
  name: string
  slug: string
  description?: string | null
}

export type Media = {
  id: number
  alt: string
  /**
   * ABSOLUTE, e.g. `http://localhost:3000/api/media/file/foo.png` — Payload
   * builds it from `NEXT_PUBLIC_SERVER_URL`. Do not prefix it with a host.
   */
  url?: string | null
  /** Often null. The usable derivatives live under `sizes`, not here. */
  thumbnailURL?: string | null
  width?: number | null
  height?: number | null
  /**
   * One entry per `imageSizes` entry in Media.ts — `thumbnail` at 400×300 and
   * `card` at 768×512. Present only when the document was fetched at depth ≥ 1;
   * at depth 0 the whole relationship is just a number.
   */
  sizes?: Partial<
    Record<'thumbnail' | 'card', { url?: string | null; width?: number | null; height?: number | null }>
  > | null
}

/**
 * Pick the smallest derivative that is big enough, falling back to the original.
 *
 * Hand-written rather than reached for from a library because the shape is
 * entirely local: three possible URLs, any of which may be absent depending on
 * the `depth` the document was fetched at.
 */
export function imageUrl(
  media: number | Media | null | undefined,
  size: 'thumbnail' | 'card' | 'full' = 'card',
): string | null {
  // At depth 0 a relationship is just an id, so there is no URL to find.
  if (!media || typeof media !== 'object') return null
  if (size === 'full') return media.url ?? null
  return media.sizes?.[size]?.url ?? media.url ?? null
}

export type Post = {
  id: number
  title: string
  slug: string
  excerpt?: string | null
  content?: LexicalRoot | null
  /** An id when depth=0, the full document when depth>=1. */
  category?: number | Category | null
  coverImage?: number | Media | null
  tags?: { id?: string; tag: string }[] | null
  publishedAt?: string | null
  _status?: 'draft' | 'published'
  createdAt: string
  updatedAt: string
}

/** Payload's list response envelope. */
export type PaginatedDocs<T> = {
  docs: T[]
  totalDocs: number
  limit: number
  page: number
  totalPages: number
  hasNextPage: boolean
  hasPrevPage: boolean
}

export type PostStats = {
  counts: { posts: number; published: number; drafts: number; categories: number }
  recent: { id: number; title: string; slug: string; updatedAt: string }[]
  authenticatedAs: { id: number; email: string } | null
  generatedAt: string
}

// ── Medusa ──────────────────────────────────────────────────────────────────

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

/** As returned by /store/reviews — no author_email, no status. */
export type StoreReview = {
  id: string
  title: string
  content: string
  rating: number
  author_name: string
  created_at: string
}

/** As returned by /admin/reviews — every column. */
export type AdminReview = StoreReview & {
  author_email: string | null
  status: ReviewStatus
  updated_at: string
}

export type RatingStats = {
  count: number
  average: number
  distribution: Record<string, number>
}

export type Product = {
  id: string
  title: string
  handle: string
  description?: string | null
  thumbnail?: string | null
  variants?: {
    id: string
    title?: string
    sku?: string | null
    /**
     * Only present when the request passed a `region_id` — pricing is
     * region-dependent (currency, tax, price lists), so Medusa will not guess
     * one for you. Without it this key is simply absent.
     */
    calculated_price?: {
      /** MAJOR units. 49 is 49.00, not 49 cents. */
      calculated_amount: number
      currency_code: string
    } | null
  }[]
}

/**
 * The cheapest variant's price, for a "from €X" label.
 *
 * Returns null rather than 0 when prices are absent, because "free" and "not
 * fetched" are very different claims and a 0 would quietly assert the first.
 */
export function priceFrom(
  product: Product,
): { amount: number; currency: string } | null {
  const priced = (product.variants ?? []).flatMap((v) =>
    v.calculated_price ? [v.calculated_price] : [],
  )
  if (priced.length === 0) return null

  const cheapest = priced.reduce((a, b) =>
    a.calculated_amount <= b.calculated_amount ? a : b,
  )
  return { amount: cheapest.calculated_amount, currency: cheapest.currency_code }
}

/** Intl handles the symbol, separators and placement per currency. */
export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount)
}
