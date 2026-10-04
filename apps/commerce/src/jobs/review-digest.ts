import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../modules/review"
import type ReviewModuleService from "../modules/review/service"

/**
 * A scheduled job — the fifth and last way to run code in Medusa.
 *
 * Nothing triggers this. No request, no event; the scheduler runs it on a cron
 * expression. That makes it the right home for periodic work: digests, reminders,
 * reconciliation, cleanup of abandoned carts.
 *
 * Like subscribers, registration is **by convention** — Medusa scans
 * `src/jobs/**` at boot and reads the exported `config`. Nothing imports this
 * file.
 *
 * ── Two things that bite ──────────────────────────────────────────────────
 *
 * 1. **It runs on every instance** unless the locking module stops it. With
 *    in-memory locking (this repo's default), two instances means the job runs
 *    twice — so "email the moderator a digest" becomes two emails. Redis
 *    locking is what makes a scheduled job singular. Same root cause as the
 *    event-bus problem: docs/learn/09-to-production.md §9.3.
 *
 * 2. **The schedule is in code, not config.** Changing it needs a restart, and
 *    a job that throws does not retry by default.
 */
export default async function reviewDigestJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

  /**
   * `listAndCountReviews` rather than `listReviews` — a digest needs the total,
   * and asking for the count separately would be a second query.
   */
  const [pending, pendingCount] = await reviewService.listAndCountReviews(
    { status: "pending" },
    { take: 5, order: { created_at: "ASC" }, select: ["id", "title", "rating", "created_at"] }
  )

  if (pendingCount === 0) {
    logger.info("[review-digest] moderation queue is empty — nothing to report")
    return
  }

  const oldest = pending[0]
  // created_at comes back as a Date from the DML model, not a string — the
  // opposite of what the HTTP layer hands you, where it is serialised JSON.
  const ageHours = oldest
    ? Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 3_600_000)
    : 0

  logger.info(
    `[review-digest] ${pendingCount} review(s) awaiting moderation. ` +
      `Oldest: "${oldest?.title}" (${ageHours}h old)`
  )

  for (const review of pending) {
    logger.info(`[review-digest]   • ${review.rating}★ ${review.title}`)
  }

  // In a real deployment this is where the email or Slack message would go.
  logger.info("[review-digest] → would send this digest to the moderation team")
}

export const config = {
  name: "review-digest",
  /**
   * Every day at 08:00. Standard 5-field cron: minute hour day month weekday.
   *
   * While learning, change this to `"* * * * *"` (every minute), restart, and
   * watch it fire in the `[commerce]` logs — a daily job is otherwise hard to
   * believe in. Change it back afterwards.
   */
  schedule: "0 8 * * *",
}
