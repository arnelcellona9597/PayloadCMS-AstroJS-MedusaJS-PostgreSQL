import {
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http"

import { rateLimit } from "./rate-limit"

import {
  AdminCreateReviewSchema,
  AdminListReviewsSchema,
  AdminUpdateReviewSchema,
} from "./admin/reviews/validators"
import { StoreCreateReviewSchema, StoreListReviewsSchema } from "./store/reviews/validators"

/**
 * ONE file wires validation for every custom route in this project.
 *
 * Medusa discovers routes from the filesystem but NOT their middleware — that is
 * declared centrally here, matched by path pattern and HTTP method. The upside is
 * that you can see every validated route in one screen; the cost is that adding a
 * route means remembering to come back and register it.
 *
 * What the two helpers actually do:
 *
 *   validateAndTransformBody(schema)   parses req.body  → req.validatedBody
 *   validateAndTransformQuery(schema)  parses req.query → req.validatedQuery
 *
 * "Transform" is not decoration: the parsed result is COERCED (so `?limit=10`
 * becomes the number 10) and defaults are applied. Always read the validated
 * property in your handler, never the raw one — `req.query.limit` is still a
 * string, and `req.body` is still unchecked.
 *
 * A schema failure short-circuits with a 400 and a field-level message. Your
 * handler never runs, so it does not need defensive checks.
 *
 * `matcher` uses path-to-regexp. Note that `/admin/reviews` and
 * `/admin/reviews/:id` need separate entries — the first does not cover the
 * second.
 */
/**
 * Rate limits, read from the environment so you can lower them to try the 429.
 *
 * The store limit is generous because a single storefront page render can make
 * several calls (products, then one review lookup per product — the N+1 in
 * apps/storefront/src/pages/products/index.astro). Set it too low and normal
 * browsing 429s, which is a much worse bug than no limit at all.
 */
const STORE_LIMIT = {
  max: Number(process.env.RATE_LIMIT_STORE_MAX ?? 240),
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
}

export default defineMiddlewares({
  routes: [
    /**
     * Rate limiting, applied to the whole public surface.
     *
     * No `method`, so it covers every verb. It is listed FIRST because
     * middlewares run in declaration order and there is no point validating a
     * body you are about to reject.
     *
     * Note this does not cover /admin/* — those routes already require an
     * authenticated admin, and locking your own moderators out of the dashboard
     * during a busy moment is a self-inflicted outage.
     */
    {
      matcher: "/store/*",
      middlewares: [rateLimit(STORE_LIMIT)],
    },

    // ── Store surface ──────────────────────────────────────────────────────
    {
      matcher: "/store/reviews",
      method: "GET",
      middlewares: [validateAndTransformQuery(StoreListReviewsSchema, {})],
    },
    {
      matcher: "/store/reviews",
      method: "POST",
      middlewares: [validateAndTransformBody(StoreCreateReviewSchema)],
    },

    // ── Admin surface ──────────────────────────────────────────────────────
    {
      matcher: "/admin/reviews",
      method: "GET",
      middlewares: [validateAndTransformQuery(AdminListReviewsSchema, {})],
    },
    {
      matcher: "/admin/reviews",
      method: "POST",
      middlewares: [validateAndTransformBody(AdminCreateReviewSchema)],
    },
    {
      matcher: "/admin/reviews/:id",
      method: "POST",
      middlewares: [validateAndTransformBody(AdminUpdateReviewSchema)],
    },
  ],
})
