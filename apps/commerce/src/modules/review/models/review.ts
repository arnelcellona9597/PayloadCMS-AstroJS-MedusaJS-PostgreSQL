import { model } from "@medusajs/framework/utils"

/**
 * A product review.
 *
 * This is Medusa's DML (data modelling language), not a MikroORM entity and not
 * a raw table definition. `model.define` describes the shape; Medusa derives the
 * MikroORM entity, the Postgres DDL and the migration from it.
 *
 * Three things you get for free and should not declare yourself:
 *   created_at, updated_at, deleted_at
 *
 * `deleted_at` matters more than it looks. Every generated delete is a SOFT
 * delete, which is what makes the delete workflow's compensation possible:
 * rolling back is `restoreReviews`, not "re-insert and hope the id matches".
 *
 * Notice what is NOT here: any reference to a product. Modules in Medusa v2 are
 * isolated — this module cannot import Product and has no foreign key to it. The
 * association lives in a separate link table defined in src/links/.
 */
const Review = model
  .define("review", {
    id: model.id().primaryKey(),

    title: model.text(),
    content: model.text(),

    // 1–5. Enforced at the edge by zod (src/api/**/validators.ts) rather than by
    // the database, so the error surfaces as a 400 with a useful message.
    rating: model.number(),

    author_name: model.text(),
    author_email: model.text().nullable(),

    /**
     * Moderation state. The Store API only ever returns `approved` rows; the
     * Admin API sees all of them. That difference is the whole reason this
     * entity has two route surfaces.
     */
    status: model
      .enum(["pending", "approved", "rejected"])
      .default("pending"),
  })
  // Reviews are almost always read "newest first, approved only", so index the
  // pair rather than each column separately.
  .indexes([
    {
      on: ["status", "created_at"],
    },
  ])

export default Review
