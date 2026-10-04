import { defineLink } from "@medusajs/framework/utils"
import ProductModule from "@medusajs/medusa/product"

import ReviewModule from "../modules/review"

/**
 * Product ←→ Review.
 *
 * This file is the single most important idea in Medusa v2's architecture.
 *
 * The review module has NO foreign key to `product`, and the product module has
 * never heard of reviews. They are separately deployable, separately migratable
 * units. So how do you associate them?
 *
 * `defineLink` creates a THIRD table that holds nothing but the two ids:
 *
 *   product_product_review_review
 *   ├── product_id
 *   └── review_id
 *
 * Consequences worth internalising:
 *
 *   • Neither module gains a dependency. You could delete src/links/ and both
 *     modules would still compile and run — you would just lose the association.
 *
 *   • You cannot JOIN across the boundary in SQL and you should not try. Reads
 *     go through Query (`query.graph`), which resolves links for you. See
 *     src/api/store/products/[id]/reviews/route.ts.
 *
 *   • Writes to the link go through the Link service, not through either module
 *     service. See src/workflows/steps/link-review-to-product.ts.
 *
 * `isList: true` sits on the review side: one product has MANY reviews, and each
 * review belongs to one product.
 *
 * Run `npm run db:migrate` after adding or changing a link — the link table is
 * created by the migration step, not by db:generate.
 */
export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ReviewModule.linkable.review,
    isList: true,
  }
)
