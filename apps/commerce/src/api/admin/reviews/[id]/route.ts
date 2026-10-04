import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../../../../modules/review"
import type ReviewModuleService from "../../../../modules/review/service"
import deleteReviewWorkflow from "../../../../workflows/delete-review"
import updateReviewWorkflow from "../../../../workflows/update-review"
import type { AdminUpdateReviewInput } from "../validators"

/**
 * /admin/reviews/:id — read, update, delete one review.
 *
 * ── Why UPDATE is POST and not PATCH ───────────────────────────────────────
 * Medusa's own admin routes use POST for updates throughout, and the admin JS SDK
 * expects that. It is a convention, not a limitation — exporting `PATCH` here
 * would work fine. Following the house style keeps the SDK usable and means a
 * reader of the Medusa docs is not surprised by this file.
 *
 * Contrast with Payload, which uses PATCH. Two frameworks in the same repo, two
 * conventions; the Astro layer normalises them (see apps/storefront/src/lib).
 */

/** GET /admin/reviews/:id — full record, every status, all columns. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  try {
    const review = await reviewService.retrieveReview(req.params.id)
    res.json({ review })
  } catch {
    // `retrieveReview` throws on a missing id. Rethrowing as a MedusaError gives
    // a clean 404 body instead of a 500 with an ORM stack trace.
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Review not found.")
  }
}

/**
 * POST /admin/reviews/:id — update, including moderation.
 *
 * Approving a review is just `{ "status": "approved" }` against this route. The
 * moment that lands, the review starts appearing on the store surface — nothing
 * else has to happen, because the store routes filter on status at read time.
 */
export const POST = async (
  req: MedusaRequest<AdminUpdateReviewInput>,
  res: MedusaResponse
) => {
  const { result } = await updateReviewWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  })

  res.json({ review: result })
}

/**
 * DELETE /admin/reviews/:id — soft delete.
 *
 * The row stays in Postgres with `deleted_at` set, and vanishes from every
 * generated query. Check for yourself:
 *
 *   docker exec apm-postgres psql -U postgres -d medusa_crud \
 *     -c 'select id, title, deleted_at from review;'
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const reviewService: ReviewModuleService = req.scope.resolve(REVIEW_MODULE)

  // Fail before the workflow starts if the id is bogus, so the client gets a 404
  // rather than a 500 out of the middle of a step.
  try {
    await reviewService.retrieveReview(req.params.id)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Review not found.")
  }

  await deleteReviewWorkflow(req.scope).run({
    input: { id: req.params.id },
  })

  res.json({ id: req.params.id, object: "review", deleted: true })
}
