import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../../../../modules/review"
import type ReviewModuleService from "../../../../modules/review/service"

/**
 * GET /store/reviews/:id
 *
 * A `[id]` directory becomes a path parameter, read as `req.params.id` — the same
 * convention as Next.js routing, applied to a REST backend.
 *
 * Only approved reviews are reachable here. Note that a pending review returns
 * 404, NOT 403: telling an anonymous caller "this exists but you may not see it"
 * leaks information for no benefit.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  const [review] = await reviewService.listReviews(
    { id: req.params.id, status: "approved" },
    { select: ["id", "title", "content", "rating", "author_name", "created_at"] }
  )

  if (!review) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Review not found.")
  }

  res.json({ review })
}
