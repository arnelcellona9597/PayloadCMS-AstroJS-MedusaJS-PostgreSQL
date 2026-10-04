import { MedusaService } from "@medusajs/framework/utils"

import Review from "./models/review"

/**
 * The review module's service — the ONLY way anything outside this folder is
 * allowed to touch review data.
 *
 * `MedusaService({ Review })` is a class factory. Extending it generates a full
 * CRUD surface from the data model, named after it:
 *
 *   createReviews(data | data[])       listReviews(filters, config)
 *   retrieveReview(id, config)         listAndCountReviews(filters, config)
 *   updateReviews(data | data[])       deleteReviews(id | id[])     ← soft
 *   softDeleteReviews(id | id[])       restoreReviews(id | id[])
 *
 * Note the pluralisation: `retrieveReview` (one) but `createReviews` (many).
 * That trips everyone up once.
 *
 * The generated methods are a BASE CLASS, not a sealed black box — anything you
 * add here sits alongside them, which is what `getRatingStats` below shows.
 */
class ReviewModuleService extends MedusaService({
  Review,
}) {
  /**
   * Aggregate rating for a set of review ids.
   *
   * Deliberately takes ids rather than a product id: this module does not know
   * that products exist. The caller resolves product → review ids through the
   * link table first, then asks this service to do the arithmetic. Keeping the
   * dependency pointing that way is what keeps the module isolated.
   */
  async getRatingStats(reviewIds: string[]): Promise<{
    count: number
    average: number
    distribution: Record<1 | 2 | 3 | 4 | 5, number>
  }> {
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<
      1 | 2 | 3 | 4 | 5,
      number
    >

    if (reviewIds.length === 0) {
      return { count: 0, average: 0, distribution }
    }

    const reviews = await this.listReviews(
      { id: reviewIds, status: "approved" },
      { select: ["rating"] }
    )

    if (reviews.length === 0) {
      return { count: 0, average: 0, distribution }
    }

    let total = 0

    for (const review of reviews) {
      const rating = review.rating as 1 | 2 | 3 | 4 | 5
      total += rating
      if (distribution[rating] !== undefined) {
        distribution[rating] += 1
      }
    }

    return {
      count: reviews.length,
      average: Math.round((total / reviews.length) * 10) / 10,
      distribution,
    }
  }
}

export default ReviewModuleService
