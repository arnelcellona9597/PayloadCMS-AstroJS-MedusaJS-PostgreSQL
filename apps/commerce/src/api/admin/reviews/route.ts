import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../../../modules/review"
import type ReviewModuleService from "../../../modules/review/service"
import createReviewWorkflow from "../../../workflows/create-review"
import type { AdminCreateReviewInput, AdminListReviewsInput } from "./validators"

/**
 * /admin/reviews — the MODERATION surface.
 *
 * The only thing separating this from src/api/store/reviews/route.ts is the
 * `admin` path segment, and that segment carries real weight. Medusa applies its
 * own authentication middleware to `/admin/*`: every request needs a logged-in
 * admin (a JWT bearer token or a session cookie). Compare:
 *
 *   /store/*   →  x-publishable-api-key, public, sales-channel scoped
 *   /admin/*   →  authenticated admin user, sees everything
 *
 * You do not write that auth check. It comes from the path.
 *
 * This is worth contrasting with Payload, where one collection has ONE endpoint
 * set and the difference between a public reader and an editor is expressed by
 * access-control functions. Medusa splits by route tree; Payload splits by
 * function. Same requirement, opposite mechanism.
 */

/**
 * GET /admin/reviews
 *
 * Sees every status, supports search and pagination.
 */
export const GET = async (
  req: MedusaRequest & { validatedQuery: AdminListReviewsInput },
  res: MedusaResponse
) => {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const { status, product_id, q, limit, offset, order } = req.validatedQuery

  const filters: Record<string, unknown> = {}

  if (status) {
    filters.status = status
  }

  if (product_id) {
    const ids = await reviewIdsForProduct(req, product_id)

    if (ids.length === 0) {
      return res.json({ reviews: [], count: 0, limit, offset })
    }

    filters.id = ids
  }

  // `$ilike` is MikroORM's case-insensitive LIKE, exposed straight through the
  // generated list method. The `%` wildcards are yours to supply.
  if (q) {
    filters.$or = [
      { title: { $ilike: `%${q}%` } },
      { content: { $ilike: `%${q}%` } },
      { author_name: { $ilike: `%${q}%` } },
    ]
  }

  const [reviews, count] = await reviewService.listAndCountReviews(filters, {
    take: limit,
    skip: offset,
    order: toOrderBy(order),
    // No `select` here: an admin is allowed to see every column, including
    // author_email. The store route restricts; this one does not.
  })

  res.json({ reviews, count, limit, offset })
}

/**
 * POST /admin/reviews
 *
 * Same workflow as the store route — only the input differs, because an admin may
 * choose the initial status. Reusing the workflow rather than calling the service
 * directly means both surfaces get the same validation, linking and rollback.
 */
export const POST = async (
  req: MedusaRequest<AdminCreateReviewInput>,
  res: MedusaResponse
) => {
  const { result } = await createReviewWorkflow(req.scope).run({
    input: req.validatedBody,
  })

  res.status(201).json({ review: result })
}

// ── helpers ────────────────────────────────────────────────────────────────

async function reviewIdsForProduct(req: MedusaRequest, productId: string): Promise<string[]> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "product",
    fields: ["id", "reviews.id"],
    filters: { id: productId },
  })

  const product = data[0] as { reviews?: ({ id: string } | undefined)[] } | undefined

  /**
   * `.filter(Boolean)` is load-bearing. A soft-deleted review keeps its link row
   * (so a restore reattaches it to the product), which means the link table can
   * resolve to nothing and Query hands back a hole in this array.
   */
  return (product?.reviews ?? []).filter((review) => Boolean(review)).map((review) => review!.id)
}

function toOrderBy(order: string): Record<string, "ASC" | "DESC"> {
  const desc = order.startsWith("-")
  const field = desc ? order.slice(1) : order

  return { [field]: desc ? "DESC" : "ASC" }
}
