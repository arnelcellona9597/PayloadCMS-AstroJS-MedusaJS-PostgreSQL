import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { updateReviewStep } from "./steps/update-review"

export type UpdateReviewWorkflowInput = {
  id: string
  title?: string
  content?: string
  rating?: number
  author_name?: string
  author_email?: string | null
  status?: "pending" | "approved" | "rejected"
}

export const UPDATE_REVIEW_WORKFLOW = "update-review"

/**
 * Update a review.
 *
 * A single-step workflow, which raises a fair question: why bother?
 *
 * Because the wrapper is where the operation becomes observable and extensible.
 * Once it is a workflow you get a named, retryable execution recorded in the
 * workflow tables, and adding "also notify the author" or "also recompute the
 * product's rating" later means appending a step — not editing a route handler
 * and rediscovering that it now needs its own rollback logic.
 *
 * The consistency is the point: in this codebase every review mutation goes
 * through a workflow, so there is exactly one place to look.
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
export const updateReviewWorkflow = createWorkflow(
  {
    name: UPDATE_REVIEW_WORKFLOW,
    // See the note above createWorkflow on persistence.
    store: true,
    retentionTime: 3600,
  },
  (input: UpdateReviewWorkflowInput) => {
    const review = updateReviewStep(input)

    return new WorkflowResponse(review)
  }
)

export default updateReviewWorkflow
