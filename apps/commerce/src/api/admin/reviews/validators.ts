import { z } from "@medusajs/framework/zod"

/**
 * Zod schemas for the ADMIN surface.
 *
 * Compare these with src/api/store/reviews/validators.ts. Same entity, different
 * rules — which is the reason the two surfaces exist as separate route trees
 * rather than one route with an `if (isAdmin)` inside it:
 *
 *   • admin MAY set `status` directly (that is moderation)
 *   • admin MAY filter by `status`, including `pending` and `rejected`
 *   • admin MAY create a review on behalf of someone else
 */

const StatusEnum = z.enum(["pending", "approved", "rejected"])

export const AdminCreateReviewSchema = z
  .object({
    product_id: z.string().min(1),
    title: z.string().min(3).max(200),
    content: z.string().min(10).max(4000),
    rating: z.coerce.number().int().min(1).max(5),
    author_name: z.string().min(1).max(120),
    author_email: z.string().email().optional().nullable(),
    status: StatusEnum.optional().default("approved"),
  })
  .strict()

export type AdminCreateReviewInput = z.infer<typeof AdminCreateReviewSchema>

/**
 * Update body. Every field optional, but `.refine` rejects an empty object —
 * without it, `PATCH` with `{}` would happily "succeed" while doing nothing,
 * which reads as a bug at the call site.
 */
export const AdminUpdateReviewSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    content: z.string().min(10).max(4000).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    author_name: z.string().min(1).max(120).optional(),
    author_email: z.string().email().optional().nullable(),
    status: StatusEnum.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Provide at least one field to update.",
  })

export type AdminUpdateReviewInput = z.infer<typeof AdminUpdateReviewSchema>

export const AdminListReviewsSchema = z
  .object({
    status: StatusEnum.optional(),
    product_id: z.string().optional(),
    q: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    offset: z.coerce.number().int().min(0).optional().default(0),
    order: z
      .enum(["created_at", "-created_at", "rating", "-rating", "status", "-status"])
      .optional()
      .default("-created_at"),
  })
  .strict()

export type AdminListReviewsInput = z.infer<typeof AdminListReviewsSchema>
