import Medusa from '@medusajs/js-sdk'

import { env } from './env'
import type { Product, RatingStats, StoreReview } from './types'

/**
 * Client for Medusa's STORE surface.
 *
 * ── Why the SDK and raw fetch appear side by side ───────────────────────────
 *
 * `@medusajs/js-sdk` has typed methods for Medusa's BUILT-IN routes:
 *
 *   sdk.store.product.list()      sdk.store.cart.create()
 *   sdk.store.product.retrieve()  sdk.store.order.list()   …
 *
 * It has nothing for `/store/reviews`, because we invented that route. The SDK
 * cannot know about it. `sdk.client.fetch()` is the escape hatch: same base URL,
 * same publishable-key header, same error handling — just an arbitrary path.
 *
 * That is the pattern for custom Medusa routes: use the generated methods where
 * they exist, drop to `client.fetch` where they do not, and never hand-roll the
 * headers yourself.
 */
export const sdk = new Medusa({
  baseUrl: env.medusa.url,

  /**
   * Sent as `x-publishable-api-key` on every /store/* request.
   *
   * Required on custom routes too — this is the single most common wall people
   * hit with a Medusa storefront. Omit it and you get:
   *   400 "Publishable API key required in the request header"
   */
  publishableKey: env.medusa.publishableKey,
})

// ── Products (built-in routes, via typed SDK methods) ───────────────────────

/**
 * Pricing is region-dependent — currency, tax inclusivity and price lists all
 * vary by region — so Medusa refuses to guess one and simply omits
 * `calculated_price` when no `region_id` is supplied. That is why a product
 * list can look complete and have no prices in it.
 *
 * This repo seeds exactly one region, so resolving it once and reusing it is
 * correct here. A multi-region storefront would pick the region from the
 * visitor instead, and must not cache it in module scope like this.
 */
let regionIdPromise: Promise<string | null> | null = null

function defaultRegionId(): Promise<string | null> {
  regionIdPromise ??= sdk.store.region
    .list()
    .then((r) => r.regions[0]?.id ?? null)
    // A missing region must not take the whole page down: without it the
    // products still render, just without prices.
    .catch(() => null)

  return regionIdPromise
}

/**
 * `*variants.calculated_price` expands the price object rather than returning
 * its id. `variants.title` and `variants.sku` have to be named explicitly —
 * expanding the price does NOT bring the rest of the variant with it, and the
 * symptom is a plans table full of `variant_01ABC…` instead of plan names.
 *
 * Naming the two fields rather than using `*variants` keeps the response small:
 * the wildcard returns 24 variant columns, of which this storefront uses two.
 */
const PRODUCT_FIELDS =
  'id,title,handle,description,thumbnail,*variants.calculated_price,variants.title,variants.sku'

export async function listProducts(limit = 20): Promise<Product[]> {
  const region_id = await defaultRegionId()

  const { products } = await sdk.store.product.list({
    limit,
    fields: PRODUCT_FIELDS,
    ...(region_id ? { region_id } : {}),
  })

  return products as unknown as Product[]
}

export async function getProductByHandle(handle: string): Promise<Product | null> {
  const region_id = await defaultRegionId()

  const { products } = await sdk.store.product.list({
    handle,
    limit: 1,
    fields: PRODUCT_FIELDS,
    ...(region_id ? { region_id } : {}),
  })

  return (products[0] as unknown as Product) ?? null
}

// ── Reviews (custom routes, via the SDK's raw fetch) ────────────────────────

export type ListReviewsResult = {
  reviews: StoreReview[]
  count: number
  limit: number
  offset: number
}

export function listStoreReviews(
  options: { limit?: number; offset?: number; productId?: string; order?: string } = {},
): Promise<ListReviewsResult> {
  const { limit = 20, offset = 0, productId, order = '-created_at' } = options

  return sdk.client.fetch<ListReviewsResult>('/store/reviews', {
    query: {
      limit,
      offset,
      order,
      ...(productId ? { product_id: productId } : {}),
    },
  })
}

export function getStoreReview(id: string): Promise<{ review: StoreReview }> {
  return sdk.client.fetch<{ review: StoreReview }>(`/store/reviews/${id}`)
}

export type CreateReviewInput = {
  product_id: string
  title: string
  content: string
  rating: number
  author_name: string
  author_email?: string | null
}

/**
 * POST /store/reviews.
 *
 * Always lands as `pending` — the store validator does not accept a `status`
 * field at all, so a public caller cannot self-publish. Approving happens through
 * the admin surface (src/lib/medusa-admin.ts).
 */
export function createStoreReview(input: CreateReviewInput): Promise<{ review: StoreReview; message: string }> {
  return sdk.client.fetch<{ review: StoreReview; message: string }>('/store/reviews', {
    method: 'POST',
    body: input,
  })
}

export type ProductReviewsResult = {
  product: { id: string; title: string; handle: string; thumbnail: string | null }
  reviews: StoreReview[]
  stats: RatingStats
}

/**
 * GET /store/products/:id/reviews — the route that reads across the module link.
 * See apps/commerce/src/api/store/products/[id]/reviews/route.ts.
 */
export function getProductReviews(productId: string): Promise<ProductReviewsResult> {
  return sdk.client.fetch<ProductReviewsResult>(`/store/products/${productId}/reviews`)
}

/** Used by the health dashboard on the home page. */
export async function medusaHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const [{ count }, products] = await Promise.all([listStoreReviews({ limit: 1 }), listProducts(1)])

    return { ok: true, detail: `${count} approved reviews, ${products.length > 0 ? 'products reachable' : 'no products'}` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' }
  }
}
