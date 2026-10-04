import type { APIRoute } from 'astro'

import { payloadHealth } from '../../lib/payload'
import { medusaHealth } from '../../lib/medusa'

export const prerender = false

/**
 * GET /api/health
 *
 * Checks both backends and reports each independently. Useful because the three
 * services start at different speeds, and "the storefront is broken" is almost
 * always "one backend is not up yet or a key is stale".
 *
 * Returns 200 when both are reachable, 503 otherwise — so it is usable as a
 * readiness probe, not just as a debugging page.
 */
export const GET: APIRoute = async () => {
  const [payload, medusa] = await Promise.all([payloadHealth(), medusaHealth()])

  const ok = payload.ok && medusa.ok

  return Response.json(
    {
      ok,
      services: {
        payload: { ...payload, url: 'http://localhost:3000' },
        medusa: { ...medusa, url: 'http://localhost:9000' },
      },
      checkedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  )
}
