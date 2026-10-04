import type { APIRoute } from 'astro'
import { resolve } from 'node:path'

import { readLogs, type LogLevel } from '../../lib/log-reader'

export const prerender = false

/**
 * GET /api/logs?level=error&service=commerce&search=redis
 *
 * Reads the files `npm run dev` tees to `logs/`. Dev-only by nature — see the
 * note at the top of lib/log-reader.ts.
 *
 * Excluded from the request log in src/middleware.ts: polling this endpoint
 * would otherwise be most of what the request log contains.
 */
export const GET: APIRoute = async ({ url }) => {
  const level = (url.searchParams.get('level') ?? 'all') as LogLevel | 'all'
  const service = url.searchParams.get('service') ?? undefined
  const search = url.searchParams.get('search') ?? undefined
  const limit = Number(url.searchParams.get('limit') ?? 200)

  /**
   * Paths in log-reader.ts are relative to the REPOSITORY ROOT, because the
   * three services keep their logs in two different places (see SOURCES there).
   *
   * Resolved from `process.cwd()` — the storefront app directory when started
   * by npm — rather than from `import.meta.url`, which points into `dist/`
   * after a build and so sits at a different depth.
   */
  const repoRoot = resolve(process.cwd(), '../..')

  try {
    const result = await readLogs(repoRoot, { level, service, search, limit })

    return Response.json({
      ...result,
      repoRoot,
      note:
        result.sources.length === 0
          ? 'No log files found. They are written by `npm run dev`; a service started directly does not have its output teed.'
          : undefined,
    })
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'Could not read logs' } },
      { status: 500 },
    )
  }
}
