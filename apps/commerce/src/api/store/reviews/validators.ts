import { z } from "@medusajs/framework/zod"

/**
 * Zod schemas for the STORE surface.
 *
 * Import zod from `@medusajs/framework/zod`, not from the bare `zod` package.
 * Medusa re-exports its own pinned copy, and mixing the two gives you two
 * different `ZodType` identities — at which point `validateAndTransformBody`
 * stops recognising your schema and the type errors are baffling.
 */

/**
 * Body for POST /store/reviews.
 *
 * `status` is deliberately absent. A public caller must not be able to publish
 * its own review — the route forces `status: "pending"` and moderation happens
 * through the Admin API. Leaving the field out of the schema means `.strict()`
 * rejects the attempt outright rather than silently ignoring it.
 */
export const StoreCreateReviewSchema = z
  .object({
    product_id: z.string().min(1),
    title: z.string().min(3).max(200),
    content: z.string().min(10).max(4000),
    rating: z.coerce.number().int().min(1).max(5),
    author_name: z.string().min(1).max(120),
    author_email: z.string().email().optional().nullable(),
  })
  .strict()

export type StoreCreateReviewInput = z.infer<typeof StoreCreateReviewSchema>

/**
 * Query for GET /store/reviews.
 *
 * `z.coerce` matters for query strings: everything arrives as text, so
 * `?limit=10` is the string "10" and a plain `z.number()` would reject it.
 */
export const StoreListReviewsSchema = z
  .object({
    product_id: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    order: z.enum(["created_at", "-created_at", "rating", "-rating"]).optional().default("-created_at"),
  })
  .strict()

export type StoreListReviewsInput = z.infer<typeof StoreListReviewsSchema>
