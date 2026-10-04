import { MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { REVIEW_MODULE } from "../../modules/review"
import type ReviewModuleService from "../../modules/review/service"

export type UpdateReviewStepInput = {
  id: string
  title?: string
  content?: string
  rating?: number
  author_name?: string
  author_email?: string | null
  status?: "pending" | "approved" | "rejected"
}

const MUTABLE_FIELDS = [
  "title",
  "content",
  "rating",
  "author_name",
  "author_email",
  "status",
] as const

/**
 * Updates a review, remembering enough to put it back.
 *
 * This is the pattern for compensating an UPDATE, and it is less obvious than
 * compensating a create. A create is undone by deleting; an update can only be
 * undone by restoring the previous values — so the step has to read them BEFORE
 * writing and stash them in the second argument of `StepResponse`.
 *
 * It snapshots only the fields this call is actually changing. Writing back the
 * whole row would clobber any concurrent change to a field we never touched.
 */
export const updateReviewStep = createStep(
  "update-review",
  async ({ id, ...changes }: UpdateReviewStepInput, { container }) => {
    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

    let existing: Record<string, unknown>

    try {
      existing = (await reviewService.retrieveReview(id)) as Record<string, unknown>
    } catch {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Review '${id}' not found.`)
    }

    // Snapshot the previous value of every field this call will overwrite.
    const previous: Record<string, unknown> = { id }

    for (const field of MUTABLE_FIELDS) {
      if (changes[field] !== undefined) {
        previous[field] = existing[field]
      }
    }

    const updated = await reviewService.updateReviews({ id, ...changes })

    return new StepResponse(updated, previous)
  },

  async (previous, { container }) => {
    if (!previous) {
      return
    }

    const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)
    await reviewService.updateReviews(previous as { id: string })
  }
)
