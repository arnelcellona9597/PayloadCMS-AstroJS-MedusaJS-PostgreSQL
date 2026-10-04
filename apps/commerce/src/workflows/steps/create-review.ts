import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { REVIEW_MODULE } from "../../modules/review"
import type ReviewModuleService from "../../modules/review/service"

export type CreateReviewStepInput = {
  title: string
  content: string
  rating: number
  author_name: string
  author_email?: string | null
  status?: "pending" | "approved" | "rejected"
}

/**
 * Inserts the review row.
 *
 * The shape of `StepResponse` is the thing to study here:
 *
 *   new StepResponse(output, compensateInput)
 *                    ^^^^^^  ^^^^^^^^^^^^^^^
 *                    what later steps and the caller see
 *                            what THIS step's compensation receives if a LATER
 *                            step fails
 *
 * They are separate on purpose. Compensation usually needs less than the full
 * output (here: just the id) and sometimes needs something the output does not
 * contain at all (see update-review.ts, which stashes the PREVIOUS values).
 */
export const createReviewStep = createStep(
  "create-review",
  async (input: CreateReviewStepInput, { container }) => {
    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

    const review = await reviewService.createReviews(input)

    return new StepResponse(review, review.id)
  },

  /**
   * Compensation. Runs only if a step AFTER this one throws.
   *
   * `deleteReviews` is a HARD delete, which is right here: the row should never
   * have existed. Contrast with delete-review.ts, where the rollback of a soft
   * delete is `restoreReviews`.
   *
   * The `if (!id)` guard matters — compensation can be invoked with undefined
   * when the step itself was the one that failed.
   */
  async (id, { container }) => {
    if (!id) {
      return
    }

    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)
    await reviewService.deleteReviews(id)
  }
)
