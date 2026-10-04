import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import type { IWorkflowEngineService } from "@medusajs/framework/types"

/**
 * GET /admin/workflows?state=failed&limit=50
 *
 * The honest answer to "did my background work succeed, is it still running, or
 * did it fail" — read from the `workflow_execution` table.
 *
 * ── This endpoint could not have existed a day ago ────────────────────────
 *
 * With the default in-memory workflow engine, `workflow_execution` exists but
 * stays permanently **empty**: executions live in the process and are discarded.
 * Ask it how many workflows failed and it says zero, whether none failed or all
 * of them did — the most dangerous kind of monitoring, the sort that is reliably
 * reassuring.
 *
 * Two changes were needed, and BOTH are required:
 *
 *   1. `@medusajs/workflow-engine-redis` in medusa-config.ts, so there is
 *      somewhere durable to write.
 *   2. `{ store: true, retentionTime: 3600 }` on each createWorkflow(), because
 *      even the Redis engine discards an execution once it finishes unless that
 *      workflow asked to be kept. Retention is opt-in **per workflow**.
 *
 * Miss either and this route returns an empty list that looks like good news.
 * See docs/learn/12-operating-it.md §12.4.
 *
 * ── Why the module service and not raw SQL ────────────────────────────────
 *
 * Contrast api/admin/schema/route.ts, which legitimately drops to
 * PG_CONNECTION: that one asks an infrastructure question about the whole
 * database, which no module owns. Here the workflow engine module owns this
 * table and exposes a list API, so going around it with SQL would mean
 * hand-writing the soft-delete filter that it already applies correctly.
 *
 * Reach for raw SQL when no module owns the question — not when reading the
 * module's own data is mildly inconvenient.
 */

/**
 * Medusa's seven TransactionStates, folded into the three buckets anyone
 * actually asks about.
 *
 * The interesting line is `reverted` sitting apart from `failed`, because the
 * difference is the entire value of writing compensation:
 *
 *   • `reverted` — the workflow failed and **every compensation ran**. The
 *     failure is clean: no half-written data. This is the success case of
 *     failure handling, and what scripts/test-compensation.ts proves.
 *   • `failed`   — it failed and could not be fully rolled back. THIS is the
 *     one to alert on; it is the state that leaves orphans behind.
 *
 * Collapsing the two into one "errors" number would throw away exactly the
 * distinction worth paging someone about.
 */
const BUCKETS = {
  successful: ["done"],
  pending: ["not_started", "invoking", "waiting_to_compensate", "compensating"],
  /** Rolled back cleanly — a controlled failure. */
  reverted: ["reverted"],
  /** Could not be rolled back — needs a human. */
  failed: ["failed"],
} as const

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const engine: IWorkflowEngineService = req.scope.resolve(Modules.WORKFLOW_ENGINE)

  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50))
  const state = typeof req.query.state === "string" ? req.query.state : undefined

  /**
   * Fetched unfiltered so the counts describe everything retained, then
   * filtered in memory for the returned rows. The counts have to cover states
   * you are not currently looking at, or the filter chips could not tell you
   * that there are failures on the tab you are not on.
   */
  const executions = await engine.listWorkflowExecutions(
    {},
    { order: { updated_at: "DESC" }, take: 500 }
  )

  const byState: Record<string, number> = {}
  const byWorkflow: Record<string, Record<string, number>> = {}

  for (const e of executions) {
    byState[e.state] = (byState[e.state] ?? 0) + 1
    byWorkflow[e.workflow_id] ??= {}
    byWorkflow[e.workflow_id][e.state] = (byWorkflow[e.workflow_id][e.state] ?? 0) + 1
  }

  const counts = Object.fromEntries(
    Object.entries(BUCKETS).map(([bucket, states]) => [
      bucket,
      states.reduce((n, s) => n + (byState[s] ?? 0), 0),
    ])
  ) as Record<keyof typeof BUCKETS, number>

  const rows = (state ? executions.filter((e) => e.state === state) : executions).slice(0, limit)

  res.json({
    counts,
    byState,
    /** Per-workflow breakdown: which workflow is failing, not just that one is. */
    byWorkflow,

    executions: rows.map((e) => ({
      workflowId: e.workflow_id,
      transactionId: e.transaction_id,
      state: e.state,
      /**
       * The step-by-step record is in `e.execution`, and it is large — a full
       * serialised state machine per run. Only the step names and their states
       * are surfaced; fetch one transaction by id if you need the payloads.
       */
      steps: summariseSteps(e.execution),
      startedAt: new Date(e.created_at).toISOString(),
      updatedAt: new Date(e.updated_at).toISOString(),
    })),

    /**
     * Same honesty as /admin/uptime: an empty list means "nothing retained",
     * which is NOT the same as "nothing failed". Say which one it is.
     */
    retaining: executions.length > 0,
    note:
      executions.length === 0
        ? "No executions retained. Either no workflow has run since the last restart, or its createWorkflow() is missing { store: true, retentionTime }. Run a review mutation and check again."
        : undefined,
    generatedAt: new Date().toISOString(),
  })
}

/**
 * `execution` is the orchestrator's serialised state machine. Its shape is an
 * internal detail of @medusajs/orchestration and has changed between versions,
 * so every access is defensive: a monitoring endpoint that throws while
 * describing a failure is worse than one that admits it cannot read the detail.
 *
 * ── What this actually contains, from a real reverted run ─────────────────
 *
 *   validate-product                 invoke done/ok         compensate reverted/idle
 *   ..create-review                  invoke done/ok         compensate reverted/ok
 *   ....link-review-to-product       invoke FAILED          compensate reverted/ok
 *                                    status permanent_failure
 *   ......emit-event-step            invoke not_started     compensate dormant
 *
 * Read top to bottom and the rollback tells its own story: the link step failed
 * permanently, the two steps that had already succeeded were compensated in
 * reverse, and the step after the failure never ran at all — so it has nothing
 * to undo and sits `dormant`.
 *
 * This is what "the database has no orphans" looks like from the inside, and
 * it is why `status` is surfaced alongside `state`: `state: "failed"` tells you
 * a step failed, `status: "permanent_failure"` tells you it will not be retried.
 */
function summariseSteps(execution: Record<string, any> | null) {
  /**
   * `steps` is at the TOP level of `execution` — not under `flow`, which is
   * where the shape of the in-memory transaction object would suggest.
   */
  const steps = execution?.steps
  if (!steps || typeof steps !== "object") return []

  return Object.entries(steps)
    /** `_root` is the synthetic entry point, not a step anyone wrote. */
    .filter(([name]) => name !== "_root")
    .map(([name, step]: [string, any]) => ({
      /**
       * Keys are dotted paths recording each step's ancestry
       * (`_root.validate-product.create-review`). The depth IS the execution
       * order, so it is kept rather than flattened away.
       */
      name: name.replace(/^_root\./, ""),
      depth: typeof step?.depth === "number" ? step.depth : name.split(".").length - 1,
      invoke: step?.invoke?.state ?? null,
      /** e.g. "permanent_failure" — whether a failed step will be retried. */
      invokeStatus: step?.invoke?.status ?? null,
      /** "dormant" means the step never ran, so there was nothing to undo. */
      compensate: step?.compensate?.state ?? null,
    }))
}
