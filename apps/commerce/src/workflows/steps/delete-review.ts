import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { REVIEW_MODULE } from "../../modules/review"
import type ReviewModuleService from "../../modules/review/service"

export type DeleteReviewStepInput = {
  id: string
}

/**
 * Soft-deletes a review.
 *
 * The clearest illustration of why every DML model gets a `deleted_at` column:
 * a soft delete is trivially reversible, so the compensation is one call and no
 * bookkeeping. If this were a hard delete, rolling back would mean re-inserting
 * a row and hoping nothing else referenced the old id in the meantime.
 *
 * Soft-deleted rows disappear from `listReviews` and `retrieveReview`
 * automatically — you have to opt back in with `withDeleted` to see them.
 */
export const deleteReviewStep = createStep(
  "delete-review",
  async ({ id }: DeleteReviewStepInput, { container }) => {
    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

    await reviewService.softDeleteReviews(id)

    return new StepResponse({ id }, id)
  },

  async (id, { container }) => {
    if (!id) {
      return
    }

    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)
    await reviewService.restoreReviews(id)
  }
)
