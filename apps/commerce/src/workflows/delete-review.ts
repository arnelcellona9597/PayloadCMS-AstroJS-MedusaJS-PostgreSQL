import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { deleteReviewStep } from "./steps/delete-review"

export type DeleteReviewWorkflowInput = {
  id: string
}

export const DELETE_REVIEW_WORKFLOW = "delete-review"

/**
 * Soft-delete a review.
 *
 * The link row is intentionally left in place. A soft delete means "hide this,
 * reversibly", and dismissing the link would make the restore incomplete — the
 * review would come back detached from its product. Rolling back a soft delete
 * has to be symmetric, so the association survives.
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
export const deleteReviewWorkflow = createWorkflow(
  {
    name: DELETE_REVIEW_WORKFLOW,
    // See the note above createWorkflow on persistence.
    store: true,
    retentionTime: 3600,
  },
  (input: DeleteReviewWorkflowInput) => {
    const result = deleteReviewStep(input)

    return new WorkflowResponse(result)
  }
)

export default deleteReviewWorkflow
