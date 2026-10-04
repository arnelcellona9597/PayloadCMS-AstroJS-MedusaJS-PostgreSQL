import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

import { REVIEW_MODULE } from "../../modules/review"

export type LinkReviewToProductInput = {
  review_id: string
  product_id: string
}

/**
 * Writes the row in the product ←→ review link table.
 *
 * Neither module service can do this: the link belongs to neither of them. You
 * resolve the LINK service from the container and describe the association as a
 * pair of "module name → { <entity>_id }" objects. The keys are module keys, not
 * table names — `Modules.PRODUCT` for a built-in, our own `REVIEW_MODULE` string
 * for the custom one.
 *
 * ── The teaching flag ──────────────────────────────────────────────────────
 * Set DEMO_FAIL_LINK_STEP=1 in .env and POST a review. This step throws, and you
 * get to watch the rollback: create-review's compensation deletes the row it
 * inserted, so the database ends up with NO orphan review and NO orphan link.
 *
 * That is the entire argument for putting mutations in workflows. Without it,
 * "insert the review, then link it" is two writes with no transaction across
 * them, and a failure between them leaves a review attached to nothing.
 */
export const linkReviewToProductStep = createStep(
  "link-review-to-product",
  async ({ review_id, product_id }: LinkReviewToProductInput, { container }) => {
    if (process.env.DEMO_FAIL_LINK_STEP === "1") {
      throw new Error(
        "DEMO_FAIL_LINK_STEP=1 — failing on purpose so you can watch the workflow compensate."
      )
    }

    const link = container.resolve(ContainerRegistrationKeys.LINK)

    await link.create({
      [Modules.PRODUCT]: { product_id },
      [REVIEW_MODULE]: { review_id },
    })

    return new StepResponse({ review_id, product_id }, { review_id, product_id })
  },

  /**
   * `dismiss` removes the link without deleting either linked record — exactly
   * the right verb for undoing an association. `link.delete` would cascade into
   * the records themselves, which is not what we want here.
   */
  async (data, { container }) => {
    if (!data) {
      return
    }

    const link = container.resolve(ContainerRegistrationKeys.LINK)

    await link.dismiss({
      [Modules.PRODUCT]: { product_id: data.product_id },
      [REVIEW_MODULE]: { review_id: data.review_id },
    })
  }
)
