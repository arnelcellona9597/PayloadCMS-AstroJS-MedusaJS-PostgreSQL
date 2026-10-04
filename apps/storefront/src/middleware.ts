import { defineMiddleware } from 'astro:middleware'

import { check, headers as rateLimitHeaders } from './lib/rate-limit'
import { record } from './lib/request-log'

/**
 * Astro middleware — runs before EVERY request, page or endpoint.
 *
 * This is the first code in the app that sees a request, which makes it the
 * right home for cross-cutting concerns: rate limiting and request logging
 * here, and in a real deployment authentication too (see
 * docs/learn/09-to-production.md §9.5 — right now anyone can delete anything).
 *
 * ── Where this sits ────────────────────────────────────────────────────────
 *
 *   browser → [ THIS FILE ] → page frontmatter / src/pages/api/* / Actions
 *
 * Because it wraps everything, a mistake here breaks the whole site — so it
 * does as little as possible and fails open on anything unexpected.
 *
 * Note this protects the ASTRO surface only. Payload (:3000) and Medusa (:9000)
 * listen on their own ports and are reachable directly; Medusa has its own
 * limiter in apps/commerce/src/api/middlewares.ts, and in production neither
 * backend should be exposed to the internet at all.
 */

const MAX = Number(import.meta.env.RATE_LIMIT_MAX ?? 120)
const WINDOW_MS = Number(import.meta.env.RATE_LIMIT_WINDOW_MS ?? 60_000)

const config = {
  max: Number.isFinite(MAX) && MAX > 0 ? MAX : 120,
  windowMs: Number.isFinite(WINDOW_MS) && WINDOW_MS > 0 ? WINDOW_MS : 60_000,
}

/**
 * The observability surface: the monitor page and the two endpoints behind it.
 *
 * ONE list, used for two exemptions, because both exist for the same reason —
 * a tool that measures the system must not become part of what it measures.
 *
 * ── Exempt from the LOG ───────────────────────────────────────────────────
 *
 * These endpoints poll. Logging them would fill the buffer with records of the
 * act of reading the buffer, and the reading would become the majority of what
 * was read.
 *
 * ── Exempt from the LIMITER ───────────────────────────────────────────────
 *
 * Found by accident and worth keeping in mind: sending 140 requests to
 * /api/reviews exhausted the budget, and the next call to /api/monitor returned
 *
 *   {"error":{"message":"Too many requests.","detail":"… Retry in 31s."}}
 *
 * The monitoring endpoint was throttled by the limiter it exists to report on.
 * Under a flood — the one moment the request log is worth reading — the way to
 * read it goes dark, and the outage looks like a total failure rather than
 * rate limiting working correctly.
 *
 * Exempting paths from a limiter is normally a mistake, since it leaves an
 * unthrottled surface. It is defensible here on three counts: these are
 * read-only, they do no backend work (the buffer is in this process), and the
 * alternative is losing visibility exactly when it matters. In production they
 * would sit behind authentication or on an internal interface instead, which is
 * the real answer — see docs/learn/12-operating-it.md §12.7.
 */
function isObservability(url: URL): boolean {
  return (
    url.pathname.startsWith('/api/monitor') ||
    url.pathname.startsWith('/api/logs') ||
    url.pathname === '/monitor'
  )
}

/**
 * Which requests count against the limit.
 *
 * Deliberately NOT plain page views. Reading the site is cheap and someone
 * clicking around the docs should never see a 429 — the expensive, abusable
 * surface is the one that writes: the REST endpoints and the Actions.
 */
function isLimited(url: URL, method: string): boolean {
  if (isObservability(url)) return false

  if (url.pathname.startsWith('/api/')) return true

  // Astro Actions post to the same page URL with ?_action=<name>.
  if (method === 'POST' && url.searchParams.has('_action')) return true

  return false
}

function isLogged(url: URL): boolean {
  return !isObservability(url)
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, clientAddress } = context

  const started = Date.now()
  const logThis = isLogged(url)

  /**
   * Requests that skip the rate limiter still get logged — the whole point of
   * the log is to see everything, including the page views the limiter ignores.
   * So the two concerns are separated here rather than nested.
   */
  if (!isLimited(url, request.method)) {
    const response = await next()

    if (logThis) {
      record({
        method: request.method,
        path: url.pathname,
        status: response.status,
        durationMs: Date.now() - started,
        limited: false,
      })
    }

    return response
  }

  /**
   * `clientAddress` comes from the adapter. Behind a reverse proxy every
   * request appears to come from the proxy, so a real deployment must trust and
   * read `X-Forwarded-For` instead — and must be certain the proxy overwrites
   * it, because a client can otherwise forge the header and mint a fresh
   * identity per request.
   *
   * Left as the direct address here: locally it is the actual client, and
   * getting the forwarded-header handling subtly wrong is worse than not doing
   * it at all.
   */
  let key: string
  try {
    key = clientAddress || 'unknown'
  } catch {
    // Some adapters throw rather than return undefined when the address is
    // unavailable. Fail open — a broken limiter must not take the site down.
    key = 'unknown'
  }

  const result = check(`astro:${key}`, config)
  const limitHeaders = rateLimitHeaders(result)

  if (!result.allowed) {
    // Logged with limited:true so throttling is visible as its own thing rather
    // than as an anonymous pile of 429s.
    if (logThis) {
      record({
        method: request.method,
        path: url.pathname,
        status: 429,
        durationMs: Date.now() - started,
        limited: true,
      })
    }

    return new Response(
      JSON.stringify({
        error: {
          message: 'Too many requests.',
          detail: `Limit is ${result.limit} requests per ${config.windowMs / 1000}s. Retry in ${result.retryAfter}s.`,
        },
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json', ...limitHeaders },
      },
    )
  }

  const response = await next()

  if (logThis) {
    record({
      method: request.method,
      path: url.pathname,
      status: response.status,
      durationMs: Date.now() - started,
      limited: false,
    })
  }

  // Advertise the budget on successful responses too, so a client can pace
  // itself instead of discovering the limit by hitting it.
  for (const [name, value] of Object.entries(limitHeaders)) {
    response.headers.set(name, value)
  }

  return response
})
