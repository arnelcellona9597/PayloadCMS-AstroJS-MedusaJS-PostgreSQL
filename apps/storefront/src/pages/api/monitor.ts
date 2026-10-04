import type { APIRoute } from 'astro'

import { query, summary } from '../../lib/request-log'

export const prerender = false

/**
 * GET /api/monitor?klass=errors&limit=50
 *
 * The request log, which lives in this process's memory (see
 * lib/request-log.ts). Deliberately separate from /api/health, which answers
 * "are the backends up" — this answers "what has this server been serving".
 *
 * Excluded from the log it reports on, so polling it does not pollute it.
 */
export const GET: APIRoute = async ({ url }) => {
  const klass = url.searchParams.get('klass') ?? undefined
  const path = url.searchParams.get('path') ?? undefined
  const limit = Number(url.searchParams.get('limit') ?? 100)

  return Response.json({
    summary: summary(),
    requests: query({ klass, path, limit }),
    /**
     * Said out loud, because a monitoring endpoint that quietly loses history
     * is worse than one that admits it.
     */
    caveat:
      'In-memory and per-process: this resets on restart and a second instance would report only its own traffic.',
    generatedAt: new Date().toISOString(),
  })
}
