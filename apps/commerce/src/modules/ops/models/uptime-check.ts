import { model } from "@medusajs/framework/utils"

/**
 * One row per probe of one target.
 *
 * ── Why this is a second custom module, not a table bolted onto `review` ──
 *
 * Uptime has nothing to do with reviews. Putting it in the review module would
 * make that module about two unrelated things, which is exactly the coupling
 * module isolation exists to prevent. Writing the second module is also the best
 * consolidation available after chapter 4 — the mechanics are identical and this
 * time the domain is your own.
 *
 * ── Why append-only rows and not a single "current status" row ─────────────
 *
 * "Is it up?" is answerable from one row. "What is our uptime this week?" and
 * "when did it last go down?" are not. History is the product here, so every
 * probe is recorded and the aggregates are computed on read.
 *
 * The cost is unbounded growth — one row per target per minute is ~43k rows a
 * month. A real deployment prunes or downsamples; see the note in service.ts.
 */
const UptimeCheck = model
  .define("uptime_check", {
    id: model.id().primaryKey(),

    /** Logical name of what was probed: "payload", "medusa", "storefront". */
    target: model.text(),

    /** The URL probed, recorded so a config change is visible in the history. */
    url: model.text(),

    /**
     * The verdict. Stored explicitly rather than derived from status_code,
     * because a timeout has no status code at all and is still a failure.
     */
     ok: model.boolean(),

    /** Null when the request never completed (DNS failure, refused, timeout). */
    status_code: model.number().nullable(),

    latency_ms: model.number(),

    /** Populated only on failure. The reason, for the incident list. */
    error: model.text().nullable(),
  })
  /**
   * Every question this table answers is "recent checks for one target", so the
   * pair is indexed rather than either column alone.
   */
  .indexes([{ on: ["target", "created_at"] }])

export default UptimeCheck
