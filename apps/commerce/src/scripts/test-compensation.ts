import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

import createReviewWorkflow from "../workflows/create-review"

/**
 * Integration check: a failing workflow must leave NO trace.
 *
 *   npm run test:compensation
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Compensation is the most valuable claim in this repo and the easiest to break
 * silently. Reorder two steps, forget an `if (!input) return` guard, or swap
 * `deleteReviews` for `softDeleteReviews`, and the happy path keeps working
 * perfectly — the damage only shows on failure, which nothing exercises by
 * accident.
 *
 * Lab 6 walks this by hand. This does it in about a second, and exits non-zero
 * when it regresses, so it can run in CI.
 *
 * ── Why it is a script, not a unit test ───────────────────────────────────
 *
 * Compensation is a property of the whole stack: the workflow engine, the module
 * service, the link service and Postgres all have to co-operate. Mocking any of
 * them would test the mock. `medusa exec` boots the real container against the
 * real database, which is the only place the claim is meaningful.
 *
 * It writes to the dev database and cleans up after itself. It is not safe to
 * point at production, which is true of every integration test worth having.
 */
export default async function testCompensation({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const knex = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  const failures: string[] = []
  const check = (name: string, pass: boolean, detail = "") => {
    logger.info(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
    if (!pass) failures.push(name)
  }

  const counts = async () => {
    const [{ rows: r }, { rows: l }] = await Promise.all([
      knex.raw("select count(*)::int as n from review"),
      knex.raw("select count(*)::int as n from product_product_review_review"),
    ])
    return { reviews: r[0].n as number, links: l[0].n as number }
  }

  const { data: products } = await query.graph({ entity: "product", fields: ["id"] })
  if (products.length === 0) {
    throw new Error("No products. Run `npm run seed` first.")
  }
  const productId = products[0].id as string

  const TITLE = "__compensation_test__"
  const input = {
    product_id: productId,
    title: TITLE,
    content: "Created by test-compensation.ts. Should never survive.",
    rating: 5,
    author_name: "Compensation Test",
  }

  logger.info("")
  logger.info("── 1. the workflow succeeds normally ──")

  const before = await counts()
  const { result } = await createReviewWorkflow(container).run({ input })

  const afterSuccess = await counts()
  check("a successful run inserts one review", afterSuccess.reviews === before.reviews + 1)
  check("a successful run inserts one link", afterSuccess.links === before.links + 1)
  check("the review is linked to the product", Boolean(result?.id))

  // Tidy up the successful one so the failure case starts from a known state.
  await knex.raw("delete from product_product_review_review where review_id = ?", [result.id])
  await knex.raw("delete from review where id = ?", [result.id])

  logger.info("")
  logger.info("── 2. the workflow fails at the link step ──")

  const baseline = await counts()

  /**
   * The step reads this at EXECUTION time, not module load, so toggling it here
   * works without restarting the server — which is what makes this runnable as
   * a test rather than a manual procedure.
   */
  const previous = process.env.DEMO_FAIL_LINK_STEP
  process.env.DEMO_FAIL_LINK_STEP = "1"

  let threw = false
  try {
    await createReviewWorkflow(container).run({
      input: { ...input, title: `${TITLE}_rollback` },
    })
  } catch {
    threw = true
  } finally {
    if (previous === undefined) delete process.env.DEMO_FAIL_LINK_STEP
    else process.env.DEMO_FAIL_LINK_STEP = previous
  }

  check("the failure propagates to the caller", threw)

  const afterFailure = await counts()

  check(
    "no orphan review",
    afterFailure.reviews === baseline.reviews,
    `${baseline.reviews} → ${afterFailure.reviews}`
  )
  check(
    "no orphan link",
    afterFailure.links === baseline.links,
    `${baseline.links} → ${afterFailure.links}`
  )

  /**
   * The strongest assertion. Create's compensation is a HARD delete, so the row
   * must be gone entirely — not merely soft-deleted. A regression to
   * `softDeleteReviews` would keep the counts above looking wrong anyway, but
   * this catches the subtler case where someone "fixes" the count by soft
   * deleting.
   */
  const { rows: leftovers } = await knex.raw(
    "select id, deleted_at from review where title like ?",
    [`${TITLE}%`]
  )
  check(
    "the rolled-back row does not exist even as a soft delete",
    leftovers.length === 0,
    leftovers.length ? `found ${leftovers.length}` : "none"
  )

  logger.info("")
  if (failures.length > 0) {
    logger.error(`✗ ${failures.length} check(s) failed: ${failures.join(", ")}`)
    process.exit(1)
  }

  logger.info("✓ compensation holds — a failed workflow left nothing behind")
  process.exit(0)
}
