import { MedusaService } from "@medusajs/framework/utils"

import UptimeCheck from "./models/uptime-check"

/**
 * Generated CRUD plus the aggregates a status page actually needs.
 *
 * The generated methods give you `createUptimeChecks`, `listUptimeChecks` and
 * the rest. What they cannot give you is "uptime percentage" or "when did it
 * last break" — those are domain questions, and this is where they belong
 * rather than in a route handler, so every caller gets the same arithmetic.
 */
class OpsModuleService extends MedusaService({
  UptimeCheck,
}) {
  /**
   * Summarise recent history per target.
   *
   * Reads the window once and aggregates in memory rather than issuing a query
   * per statistic. At one row per minute per target, a 24h window is ~1,440
   * rows per target — small enough that the round trips would cost more than
   * the arithmetic.
   */
  async uptimeSummary(windowHours = 24): Promise<
    {
      target: string
      url: string
      checks: number
      failures: number
      uptimePercent: number
      avgLatencyMs: number
      currentlyUp: boolean | null
      /** Consecutive checks in the current state — "up for 37 checks". */
      streak: number
      lastIncidentAt: string | null
      lastIncidentError: string | null
      lastCheckedAt: string | null
    }[]
  > {
    const since = new Date(Date.now() - windowHours * 3_600_000)

    const rows = await this.listUptimeChecks(
      { created_at: { $gte: since } },
      { order: { created_at: "DESC" }, take: 20_000 }
    )

    const byTarget = new Map<string, typeof rows>()
    for (const row of rows) {
      const list = byTarget.get(row.target) ?? []
      list.push(row)
      byTarget.set(row.target, list)
    }

    return [...byTarget.entries()]
      .map(([target, checks]) => {
        // `checks` is newest-first, which is what streak detection wants.
        const failures = checks.filter((c) => !c.ok)
        const newest = checks[0]

        let streak = 0
        for (const check of checks) {
          if (check.ok !== newest.ok) break
          streak += 1
        }

        const lastFailure = failures[0]

        return {
          target,
          url: String(newest.url),
          checks: checks.length,
          failures: failures.length,
          uptimePercent:
            checks.length === 0
              ? 0
              : Math.round(((checks.length - failures.length) / checks.length) * 1000) / 10,
          avgLatencyMs: Math.round(
            checks.reduce((sum, c) => sum + Number(c.latency_ms), 0) / checks.length
          ),
          currentlyUp: Boolean(newest.ok),
          streak,
          lastIncidentAt: lastFailure ? new Date(lastFailure.created_at).toISOString() : null,
          lastIncidentError: lastFailure ? (lastFailure.error as string | null) : null,
          lastCheckedAt: new Date(newest.created_at).toISOString(),
        }
      })
      .sort((a, b) => a.target.localeCompare(b.target))
  }

  /**
   * Drop checks older than `keepDays`.
   *
   * Called by the scheduled job, because an append-only table with no pruning
   * is a slow-motion disk problem: one row per target per minute is roughly
   * 43,000 rows per target per month.
   *
   * Note this HARD deletes. A soft delete would keep the rows on disk and
   * defeat the entire purpose.
   */
  async pruneOlderThan(keepDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - keepDays * 86_400_000)

    const stale = await this.listUptimeChecks(
      { created_at: { $lt: cutoff } },
      { select: ["id"], take: 10_000 }
    )

    if (stale.length === 0) {
      return 0
    }

    await this.deleteUptimeChecks(stale.map((c) => c.id))

    return stale.length
  }
}

export default OpsModuleService
