import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ExecArgs } from "@medusajs/framework/types"

import { REVIEW_MODULE } from "../modules/review"
import type ReviewModuleService from "../modules/review/service"
import createReviewWorkflow from "../workflows/create-review"

/**
 * Seeds reviews across the products created by `npm run seed`.
 *
 *   npm run seed:reviews
 *
 * Every review is created by RUNNING THE WORKFLOW, not by calling the service.
 * That is not ceremony: the workflow is what writes the link table row. Calling
 * `createReviews` directly would insert perfectly valid review rows that belong
 * to no product, and the product pages would show nothing.
 *
 * Mixed statuses are seeded on purpose — the store surface should visibly return
 * fewer reviews than the admin surface.
 */
export default async function seedReviews({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const reviewService: ReviewModuleService = container.resolve(REVIEW_MODULE)

  const existing = await reviewService.listReviews({}, { take: 1 })

  if (existing.length > 0) {
    logger.info("Reviews already seeded — nothing to do.")
    return
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "title"],
  })

  if (products.length === 0) {
    throw new Error("No products found. Run `npm run seed` first.")
  }

  logger.info(`Found ${products.length} products.`)

  /**
   * Seven templates rather than five, so a product with four reviews does not
   * simply repeat the first four. The status mix is deliberate: the store
   * surface filters on `status`, so `pending` and `rejected` entries are what
   * make that filtering visible rather than theoretical.
   *
   * Written as infrastructure reviews because the catalogue is infrastructure —
   * retail prose about sizing reads as nonsense against a managed Postgres plan.
   */
  const templates = [
    {
      title: "Provisioned faster than the docs claimed",
      content:
        "Spun up in about forty seconds and the connection string worked first time. Migrated two databases over the weekend with no surprises.",
      rating: 5,
      author_name: "Dana Whitfield",
      author_email: "dana@example.com",
      status: "approved" as const,
    },
    {
      title: "Solid, but the dashboard is slow",
      content:
        "The service itself has been completely stable for three months. The admin UI is another matter — listing metrics takes several seconds every time.",
      rating: 4,
      author_name: "Priya Raman",
      author_email: "priya@example.com",
      status: "approved" as const,
    },
    {
      title: "Does the job, support was slow",
      content:
        "No complaints about uptime. Opened a ticket about a billing question and waited four days for a first reply, which is not what the SLA page implies.",
      rating: 3,
      author_name: "Marcus Bell",
      author_email: null,
      status: "approved" as const,
    },
    {
      title: "Replaced three separate tools",
      content:
        "We were paying for two monitoring services and a status page. This consolidated all of it and came out cheaper. The migration guide was accurate.",
      rating: 5,
      author_name: "Tomas Lindqvist",
      author_email: "tomas@example.com",
      status: "approved" as const,
    },
    {
      title: "Good value at the lower tier",
      content:
        "The entry plan is genuinely usable rather than a trial in disguise. We outgrew it in a year, which feels like the right amount of time.",
      rating: 4,
      author_name: "Aisha Rahman",
      author_email: "aisha@example.com",
      status: "approved" as const,
    },
    {
      title: "Still waiting on moderation",
      content:
        "This one is left PENDING on purpose. It will not appear on /store/reviews, but it will appear on /admin/reviews.",
      rating: 2,
      author_name: "Anonymous Developer",
      author_email: null,
      status: "pending" as const,
    },
    {
      title: "Rejected as spam",
      content:
        "This one is left REJECTED on purpose, so you can see that the store surface filters on status rather than on soft-deletion.",
      rating: 1,
      author_name: "cheap-vps-deals-now",
      author_email: null,
      status: "rejected" as const,
    },
  ]

  let created = 0

  for (const [index, product] of products.entries()) {
    // Vary how many reviews each product gets, so the aggregate stats differ.
    const count = (index % 3) + 2

    for (let i = 0; i < count; i++) {
      const template = templates[(index + i) % templates.length]

      const { result } = await createReviewWorkflow(container).run({
        input: {
          product_id: product.id,
          ...template,
          title: `${template.title}`,
        },
      })

      created++
      logger.info(
        `  ${product.title} ← "${result.title}" [${template.status}] (${template.rating}★)`
      )
    }
  }

  logger.info(`Seeded ${created} reviews across ${products.length} products.`)
}
