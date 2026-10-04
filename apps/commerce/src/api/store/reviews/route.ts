import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../../../modules/review"
import type ReviewModuleService from "../../../modules/review/service"
import createReviewWorkflow from "../../../workflows/create-review"
import type { StoreCreateReviewInput, StoreListReviewsInput } from "./validators"

/**
 * /store/reviews — the PUBLIC surface.
 *
 * Medusa maps the file path to the URL path, so this file is reachable at
 * GET/POST http://localhost:9000/store/reviews. There is no route table.
 *
 * ── The publishable API key ────────────────────────────────────────────────
 * Every /store/* route — including custom ones like this — requires:
 *
 *   x-publishable-api-key: pk_...
 *
 * Without it you get a 400, and the message is not always obvious. The key is
 * not a secret in the password sense; it identifies which SALES CHANNEL the
 * request belongs to, so Medusa can scope what the caller may see. Run
 * `npm run bootstrap` to print yours.
 */

/**
 * GET /store/reviews
 *
 * Only ever returns APPROVED reviews. That constraint is hard-coded rather than
 * a default, because it is the difference between this route and its admin
 * counterpart, and a caller must not be able to override it via query string.
 */
export const GET = async (
  req: MedusaRequest & { validatedQuery: StoreListReviewsInput },
  res: MedusaResponse
) => {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)
  const { limit, offset, order, product_id } = req.validatedQuery

  // Filtering by product means going through the link table, since this module
  // has no product_id column. Query is the only thing that can see both sides.
  let idFilter: string[] | undefined

  if (product_id) {
    idFilter = await reviewIdsForProduct(req, product_id)

    if (idFilter.length === 0) {
      return res.json({ reviews: [], count: 0, limit, offset })
    }
  }

  const [reviews, count] = await reviewService.listAndCountReviews(
    {
      status: "approved",
      ...(idFilter ? { id: idFilter } : {}),
    },
    {
      take: limit,
      skip: offset,
      order: toOrderBy(order),
      // Public payloads should be explicit. Without `select`, any column added
      // to the model later would silently start leaking — author_email included.
      select: ["id", "title", "content", "rating", "author_name", "created_at"],
    }
  )

  res.json({ reviews, count, limit, offset })
}

/**
 * POST /store/reviews
 *
 * The body has already been validated by the middleware, so this handler does no
 * checking of its own — it reads `req.validatedBody` and runs the workflow.
 *
 * `status: "pending"` is forced here. The store schema does not accept a status
 * at all, and setting it explicitly documents that a public review is never
 * self-published.
 */
export const POST = async (
  req: MedusaRequest<StoreCreateReviewInput>,
  res: MedusaResponse
) => {
  const { result } = await createReviewWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      status: "pending",
    },
  })

  res.status(201).json({
    review: result,
    message: "Thanks — your review is awaiting moderation.",
  })
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Resolve a product id to the ids of its linked reviews, via Query. */
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

/** Turn "-created_at" into { created_at: "DESC" }. */
function toOrderBy(order: string): Record<string, "ASC" | "DESC"> {
  const desc = order.startsWith("-")
  const field = desc ? order.slice(1) : order

  return { [field]: desc ? "DESC" : "ASC" }
}
