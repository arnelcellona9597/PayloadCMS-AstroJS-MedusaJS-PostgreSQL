import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { emitEventStep } from "@medusajs/medusa/core-flows"

import { createReviewStep } from "./steps/create-review"
import { linkReviewToProductStep } from "./steps/link-review-to-product"
import { validateProductStep } from "./steps/validate-product"

export type CreateReviewWorkflowInput = {
  product_id: string
  title: string
  content: string
  rating: number
  author_name: string
  author_email?: string | null
  status?: "pending" | "approved" | "rejected"
}

export const CREATE_REVIEW_WORKFLOW = "create-review"

/**
 * Create a review and attach it to a product.
 *
 * Three steps, two of which write. If step 3 fails, step 2's compensation runs
 * and the review row is removed — the caller sees an error and the database is
 * exactly as it was. Prove it to yourself with DEMO_FAIL_LINK_STEP=1.
 *
 * ── Reading workflow bodies ────────────────────────────────────────────────
 * The function below looks like ordinary imperative code and is not. It runs ONCE
 * at startup to build a graph; `review` is a proxy standing in for "whatever step
 * 2 will return", not a value. Which means:
 *
 *   ✗ if (review.rating > 3) { ... }        — branching on a proxy does nothing
 *   ✗ const t = review.title.toUpperCase()  — no string here to call methods on
 *   ✓ review.id                             — property access is recorded, fine
 *
 * For real computation on step output you need `transform()` from the SDK. This
 * workflow does not need it; anything more involved would.
 */
/**
 * ── Why this workflow declares `store` and `retentionTime` ────────────────
 *
 * Medusa DISCARDS a workflow execution the moment it finishes, unless you ask
 * it not to. That is a sensible default — most runs are uninteresting and the
 * table would grow without bound — but it means `workflow_execution` sits empty
 * even after workflows have succeeded AND failed, so there is nothing to
 * monitor.
 *
 * Setting `retentionTime` turns persistence on (it implies `store: true`) and
 * says how long to keep the row. 3600s is enough to debug what just happened
 * without accumulating history forever.
 *
 * This is what makes /monitor's workflow panel possible. Remove it and the
 * panel goes honestly empty rather than silently wrong.
 *
 * ⚠️ Retention is per-workflow, not global. A workflow without it stays
 * invisible — so "no failures recorded" never means "no failures".
 */
export const createReviewWorkflow = createWorkflow(
  {
    name: CREATE_REVIEW_WORKFLOW,
    // See the note above createWorkflow on persistence.
    store: true,
    retentionTime: 3600,
  },
  (input: CreateReviewWorkflowInput) => {
    // 1. Cheap read-only guard, first — so we never roll back for a bad id.
    validateProductStep({ product_id: input.product_id })

    // 2. Insert the row.
    const review = createReviewStep({
      title: input.title,
      content: input.content,
      rating: input.rating,
      author_name: input.author_name,
      author_email: input.author_email,
      status: input.status,
    })

    // 3. Associate it with the product via the link table.
    linkReviewToProductStep({
      review_id: review.id,
      product_id: input.product_id,
    })

    /**
     * 4. Announce it.
     *
     * `emitEventStep` is a built-in step from @medusajs/medusa/core-flows — you
     * do not write your own, and using it rather than calling the event bus
     * directly matters: as a STEP it participates in the workflow. It runs only
     * if steps 1–3 all succeeded, so nobody is ever told about a review that got
     * rolled back.
     *
     * Emitting from the route handler instead would break that guarantee — the
     * event would fire even when the link step failed and the review was
     * compensated away.
     *
     * Handled by src/subscribers/review-created.ts, AFTER the caller already has
     * its 201.
     */
    emitEventStep({
      eventName: "review.created",
      data: { id: review.id, product_id: input.product_id },
    })

    return new WorkflowResponse(review)
  }
)

export default createReviewWorkflow
