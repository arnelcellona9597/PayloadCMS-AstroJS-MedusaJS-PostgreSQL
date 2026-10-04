import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../../../../../modules/review"
import type ReviewModuleService from "../../../../../modules/review/service"

/**
 * GET /store/products/:id/reviews
 *
 * ── This route is the payoff for src/links/product-review.ts ────────────────
 *
 * `query.graph` is Medusa's read layer. Give it a root entity and a field list
 * and it resolves across module boundaries and link tables for you:
 *
 *   fields: ["id", "title", "reviews.title", "reviews.rating", ...]
 *                        ^^^^^^^ a DIFFERENT module, reached through the link
 *                                table
 *
 * The field list is enumerated rather than written as `reviews.*` on purpose.
 * `reviews.*` returns EVERY column of the review model — author_email, and any
 * column added to the model in future — straight onto a public endpoint. On a
 * public route, listing fields explicitly is the difference between "we chose
 * what to expose" and "we exposed whatever the schema happens to hold".
 *
 * There is no SQL join here and you could not write one — `product` lives in the
 * product module's schema and `review` in ours. Query reads the link table,
 * fetches from each module, and stitches the result.
 *
 * The `reviews` key comes from the link definition, not from a column anywhere.
 * Delete src/links/product-review.ts and this field stops existing.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      // Explicit — see the note above. `status` is fetched so this route can
      // filter on it, then dropped before the response is sent.
      "reviews.id",
      "reviews.title",
      "reviews.content",
      "reviews.rating",
      "reviews.author_name",
      "reviews.status",
      "reviews.created_at",
    ],
    filters: { id: req.params.id },
  })

  const product = data[0] as
    | {
        id: string
        title: string
        handle: string
        thumbnail: string | null
        // `| undefined` is not defensive noise — see the comment below on why
        // Query can legitimately return holes here.
        reviews?: (
          | {
              id: string
              title: string
              content: string
              rating: number
              author_name: string
              status: string
              created_at: string
            }
          | undefined
        )[]
      }
    | undefined

  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found.")
  }

  /**
   * ── Holes in the array are expected. Do not skip this filter. ────────────
   *
   * `product.reviews` can contain `undefined` entries, and the reason is a real
   * consequence of this design:
   *
   *   1. Deleting a review is a SOFT delete (see workflows/steps/delete-review).
   *   2. The delete workflow deliberately LEAVES the link row in place, so that
   *      restoring the review restores it still attached to its product.
   *   3. So the link table can point at a review that generated queries no
   *      longer return — and Query resolves that link to nothing.
   *
   * Result: one hole per soft-deleted-but-still-linked review. Without this
   * filter the route throws `Cannot read properties of undefined`, and it throws
   * only AFTER someone deletes a review — which is exactly the kind of bug that
   * escapes a first pass through the happy path.
   */
  const all = (product.reviews ?? []).filter(
    (review): review is NonNullable<typeof review> => Boolean(review)
  )

  /**
   * Query returns every linked review regardless of moderation state, because
   * the link table knows nothing about `status`. Filtering is this route's job.
   *
   * Worth internalising: crossing a module boundary does not carry the other
   * module's business rules with it. Query gives you data, not policy.
   */
  const approved = all.filter((review) => review.status === "approved")

  // Aggregation is the review module's own concern, so it lives in the service.
  const stats = await reviewService.getRatingStats(approved.map((r) => r.id))

  res.json({
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      thumbnail: product.thumbnail,
    },
    reviews: approved
      .map(({ status, ...rest }) => rest)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    stats,
  })
}
