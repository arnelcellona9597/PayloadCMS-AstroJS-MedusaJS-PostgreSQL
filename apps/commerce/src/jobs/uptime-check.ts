import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { OPS_MODULE } from "../modules/ops"
import type OpsModuleService from "../modules/ops/service"

/**
 * Probes every service and records the result.
 *
 * ── Why the monitor lives in Medusa and not the storefront ────────────────
 *
 * Uptime needs two things the storefront cannot provide: a scheduler, and
 * somewhere durable to keep history. Astro has neither — it renders on demand
 * and owns no database. Medusa has both.
 *
 * ── Why Redis matters here specifically ──────────────────────────────────
 *
 * With in-memory locking this job runs once per instance, so two instances
 * would record two checks a minute per target and every uptime percentage would
 * be computed from double-counted rows. The Redis locking module is what makes
 * a scheduled job singular.
 *
 * ── A caveat to state plainly ────────────────────────────────────────────
 *
 * This is in-process monitoring: Medusa is checking its own neighbours. If the
 * host dies, the monitor dies with it and records nothing — the gap in the
 * history *is* the outage, which is exactly why real uptime monitoring runs
 * somewhere else. Useful for "did Payload crash while I was editing", not for
 * an SLA.
 */

type Target = { name: string; url: string }

const TARGETS: Target[] = [
  { name: "payload", url: `${process.env.PAYLOAD_URL ?? "http://localhost:3000"}/api/posts?limit=1` },
  { name: "storefront", url: `${process.env.STOREFRONT_URL ?? "http://localhost:4321"}/api/health` },
  // Medusa checks itself. Trivially always up when the job runs — but the
  // ABSENCE of rows is the signal, so it is worth recording.
  { name: "medusa", url: `${process.env.MEDUSA_URL ?? "http://localhost:9000"}/health` },
]

const TIMEOUT_MS = 5_000

async function probe(target: Target) {
  const started = Date.now()

  try {
    /**
     * An explicit timeout is not optional. Without one, a hung service makes
     * the probe hang too, and a monitor that blocks on the thing it is
     * monitoring reports nothing at the exact moment you need it.
     */
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "apm-uptime-monitor" },
    })

    return {
      target: target.name,
      url: target.url,
      ok: response.ok,
      status_code: response.status,
      latency_ms: Date.now() - started,
      error: response.ok ? null : `HTTP ${response.status}`,
    }
  } catch (error) {
    // No status code exists here — the request never completed. That is why
    // `ok` is stored separately rather than derived from status_code.
    return {
      target: target.name,
      url: target.url,
      ok: false,
      status_code: null,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : "unknown error",
    }
  }
}

export default async function uptimeCheckJob(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const ops: OpsModuleService = container.resolve(OPS_MODULE)

  // All targets concurrently: three sequential 5s timeouts would make one slow
  // service delay the others' timestamps by up to ten seconds.
  const results = await Promise.all(TARGETS.map(probe))

  await ops.createUptimeChecks(results)

  const down = results.filter((r) => !r.ok)

  if (down.length > 0) {
    logger.warn(
      `[uptime] ${down.length}/${results.length} DOWN: ` +
        down.map((d) => `${d.target} (${d.error})`).join(", ")
    )
  } else {
    logger.info(
      `[uptime] all ${results.length} up — ` +
        results.map((r) => `${r.target} ${r.latency_ms}ms`).join(", ")
    )
  }

  // Keep the table from growing without bound. Cheap when there is nothing to
  // do, which is most runs.
  const pruned = await ops.pruneOlderThan(7)
  if (pruned > 0) {
    logger.info(`[uptime] pruned ${pruned} check(s) older than 7 days`)
  }
}

export const config = {
  name: "uptime-check",
  /**
   * Every minute. That is aggressive for production (it is 43k rows per target
   * per month) and right for learning, because a one-minute loop means you see
   * an outage appear while you are still looking at the screen.
   */
  schedule: "* * * * *",
}
