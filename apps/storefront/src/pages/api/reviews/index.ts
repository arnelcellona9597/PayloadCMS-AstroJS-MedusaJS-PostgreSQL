import type { APIRoute } from 'astro'
import { z } from 'astro/zod'

import { createStoreReview, listStoreReviews } from '../../../lib/medusa'
import { listAdminReviews } from '../../../lib/medusa-admin'

export const prerender = false

/**
 * ═══ PATTERN B — hand-written REST endpoints (used for Medusa / reviews) ═════
 *
 * A file in src/pages/api/ that exports HTTP-method functions becomes a real
 * endpoint. Same file-based routing as pages; the return value is a standard
 * `Response`, so there is no framework-specific reply object to learn.
 *
 *   GET  /api/reviews
 *   POST /api/reviews
 *
 * ── Why bother, when Medusa already exposes /store/reviews? ─────────────────
 * This is the BFF (Backend For Frontend) pattern, and it buys three things:
 *
 *   1. CREDENTIALS STAY SERVER-SIDE. The publishable key and the admin JWT live
 *      here. A browser calling /api/reviews needs no key at all — and cannot
 *      obtain one. Calling Medusa directly from the browser would mean shipping
 *      the key to every visitor.
 *
 *   2. ONE SHAPE FOR THE CLIENT. Medusa uses POST for updates; Payload uses
 *      PATCH. This layer picks one convention and hides the difference.
 *
 *   3. COMPOSITION. `?include_pending=true` below merges the store and admin
 *      surfaces into one response — something no single Medusa route does.
 *
 * The cost, versus the Actions in src/actions/index.ts: you write the parsing,
 * the status codes and the error envelope yourself, and there is no
 * progressive-enhancement story. Everything below is that plumbing.
 */

const ListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  product_id: z.string().optional(),
  /** Requires the admin surface, so it is opt-in rather than the default. */
  include_pending: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
})

/**
 * Astro bundles zod 4, so the modern spellings apply here: `z.email()` rather
 * than the deprecated `z.string().email()`, and the top-level
 * `z.flattenError(err)` rather than `err.flatten()`.
 *
 * Medusa bundles its own separate copy of zod. Its validators
 * (apps/commerce/src/api/**\/validators.ts) are written against that copy, which
 * is why the two projects can look slightly different and both be correct — and
 * why you must never import zod across them.
 */
const CreateBodySchema = z.object({
  product_id: z.string().min(1),
  title: z.string().min(3).max(200),
  content: z.string().min(10).max(4000),
  rating: z.coerce.number().int().min(1).max(5),
  author_name: z.string().min(1).max(120),
  author_email: z.email().nullish(),
})

/** Consistent error envelope, so every endpoint here fails the same way. */
function fail(status: number, message: string, detail?: unknown): Response {
  return Response.json({ error: { message, detail } }, { status })
}

export const GET: APIRoute = async ({ url }) => {
  const parsed = ListQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!parsed.success) {
    return fail(400, 'Invalid query parameters.', z.flattenError(parsed.error).fieldErrors)
  }

  const { limit, offset, product_id, include_pending } = parsed.data

  try {
    if (include_pending) {
      // Admin surface: every status, plus author_email.
      const result = await listAdminReviews({ limit, offset, productId: product_id })

      return Response.json({
        reviews: result.reviews,
        count: result.count,
        limit,
        offset,
        source: 'admin',
      })
    }

    // Store surface: approved only, no author_email.
    const result = await listStoreReviews({ limit, offset, productId: product_id })

    return Response.json({
      reviews: result.reviews,
      count: result.count,
      limit,
      offset,
      source: 'store',
    })
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : 'Medusa is unreachable.')
  }
}

export const POST: APIRoute = async ({ request }) => {
  /**
   * Accepts BOTH JSON and form encodings.
   *
   * Actions handle this for you via `accept`. Here it is manual — and it is the
   * reason the review pages can submit a plain <form> to this endpoint and also
   * be called with `fetch(..., { body: JSON.stringify(...) })`.
   */
  let raw: Record<string, unknown>

  const contentType = request.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('application/json')) {
      raw = (await request.json()) as Record<string, unknown>
    } else {
      raw = Object.fromEntries(await request.formData())
    }
  } catch {
    return fail(400, 'Could not parse the request body.')
  }

  const parsed = CreateBodySchema.safeParse(raw)

  if (!parsed.success) {
    return fail(422, 'Validation failed.', z.flattenError(parsed.error).fieldErrors)
  }

  try {
    const result = await createStoreReview(parsed.data)

    return Response.json({ review: result.review, message: result.message }, { status: 201 })
  } catch (error) {
    // Medusa's own zod layer may also reject this — surface its message rather
    // than swallowing it, so double validation is visible instead of confusing.
    return fail(502, error instanceof Error ? error.message : 'Medusa rejected the review.')
  }
}
