import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { REVIEW_MODULE } from "../modules/review"
import type ReviewModuleService from "../modules/review/service"

/**
 * Reacts to `review.created`.
 *
 * ── The fourth way to run code in Medusa ──────────────────────────────────
 *
 * You have seen three: a route handler (synchronous, in the request), a workflow
 * step (orchestrated, compensatable), and a service method (business logic).
 * A subscriber is the fourth, and it is different in one important way:
 *
 *   **It runs AFTER the request has already been answered.**
 *
 * The caller got its 201 before this function started. So a subscriber is the
 * place for work that must not slow the response down and must not be able to
 * fail the request — sending an email, warming a cache, notifying a moderator.
 *
 * The flip side: **if this throws, the caller never finds out.** The review is
 * created and the email silently is not sent. Anything the caller must be told
 * about belongs in the workflow, not here.
 *
 * ── Registration is by convention ─────────────────────────────────────────
 * No import anywhere points at this file. Medusa scans `src/subscribers/**` at
 * boot and wires the exported `config.event` to the default export. That is why
 * `src/subscribers/` being empty meant the whole event system was invisible.
 */
export default async function reviewCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string; product_id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

  const { id, product_id } = event.data

  /**
   * The event carries ids, not the whole record — deliberately. Events are
   * broadcast and may be handled much later; a payload that embedded the full
   * review could be stale by the time anyone reads it. Fetch what you need.
   */
  let review
  try {
    review = await reviewService.retrieveReview(id)
  } catch {
    // Already deleted between the event firing and this handler running. That is
    // normal in an event-driven system, not an error.
    logger.warn(`[review.created] review ${id} no longer exists — skipping`)
    return
  }

  logger.info(
    `[review.created] "${review.title}" (${review.rating}★) by ${review.author_name} ` +
      `on product ${product_id} — status ${review.status}`
  )

  /**
   * Where the real side effects would go:
   *   • notify a moderator that the queue grew
   *   • email the author "thanks, we're reviewing it"
   *   • invalidate the cached rating for this product
   *
   * Left as a log so the lifecycle is observable without adding dependencies —
   * the same choice `Posts.afterChange` makes in the CMS.
   */
  if (review.status === "pending") {
    logger.info(`[review.created] → would notify a moderator: ${id} awaits a decision`)
  }
}

/**
 * ⚠️ With the in-memory event bus (the default, and what this repo runs), events
 * are delivered inside ONE process. Two Medusa instances means each sees only
 * the events it produced, so a subscriber fires inconsistently or not at all —
 * and a restart drops anything in flight. That is the concrete cost described in
 * docs/learn/09-to-production.md §9.3, and the reason Redis is not optional.
 */
export const config: SubscriberConfig = {
  event: "review.created",
}
