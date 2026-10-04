import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { OPS_MODULE } from "../../../modules/ops"
import type OpsModuleService from "../../../modules/ops/service"

/**
 * GET /admin/uptime?hours=24
 *
 * Under /admin because uptime history is infrastructure detail, and putting it
 * there means Medusa enforces authentication before this handler runs.
 *
 * The aggregation lives in the module service, not here — so the storefront,
 * a CLI script and the admin dashboard would all get identical arithmetic.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const ops: OpsModuleService = req.scope.resolve(OPS_MODULE)

  const hours = Math.min(168, Math.max(1, Number(req.query.hours ?? 24) || 24))

  const summary = await ops.uptimeSummary(hours)

  // Recent failures across all targets — the incident list.
  const incidents = await ops.listUptimeChecks(
    { ok: false },
    { order: { created_at: "DESC" }, take: 20 }
  )

  res.json({
    windowHours: hours,
    targets: summary,
    /**
     * Stated explicitly so a consumer can tell "monitored and healthy" from
     * "never monitored". An empty targets array with monitoring:false means the
     * job has not run yet — a very different thing from 100% uptime.
     */
    monitoring: summary.length > 0,
    note:
      summary.length === 0
        ? "No checks recorded yet. The uptime job runs every minute — wait for the next tick, or check that Medusa started cleanly."
        : undefined,
    incidents: incidents.map((i) => ({
      target: i.target,
      error: i.error,
      statusCode: i.status_code,
      at: new Date(i.created_at).toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  })
}
