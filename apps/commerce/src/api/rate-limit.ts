import type {
  MedusaNextFunction,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

/**
 * The same sliding-window limiter as the storefront's, in Medusa's idiom.
 *
 * Worth reading side by side with apps/storefront/src/{middleware.ts,lib/rate-limit.ts}:
 * identical algorithm, completely different registration.
 *
 *   Astro   — one `onRequest` in src/middleware.ts wraps EVERY request
 *             automatically, and returns a Response to short-circuit.
 *
 *   Medusa  — an Express-style `(req, res, next)` function that does nothing
 *             until you wire it to a path matcher in src/api/middlewares.ts,
 *             and short-circuits by writing to `res` and NOT calling `next()`.
 *
 * Neither is better. Astro's is impossible to forget and therefore easy to
 * apply too broadly; Medusa's is explicit per route and therefore easy to
 * forget on a route you add later.
 *
 * ── The same caveat as the storefront's ────────────────────────────────────
 * Counters live in this process's memory. Two Medusa instances means two
 * independent limits — exactly like the in-memory event bus and workflow
 * locking Medusa warns about on every boot. See docs/learn/09-to-production.md.
 */

type Config = { max: number; windowMs: number }

const hits = new Map<string, number[]>()

const stats = { checked: 0, blocked: 0 }

let lastEviction = Date.now()

function evictStale(now: number, windowMs: number): void {
  for (const [key, times] of hits) {
    if (times.length === 0 || now - times[times.length - 1] > windowMs) {
      hits.delete(key)
    }
  }
}

function check(key: string, config: Config) {
  const now = Date.now()
  const windowStart = now - config.windowMs

  if (now - lastEviction > config.windowMs) {
    evictStale(now, config.windowMs)
    lastEviction = now
  }

  const current = (hits.get(key) ?? []).filter((t) => t > windowStart)
  stats.checked += 1

  const oldest = current[0] ?? now
  const resetAt = Math.ceil((oldest + config.windowMs) / 1000)

  if (current.length >= config.max) {
    // Blocked requests are not recorded — otherwise a client that keeps
    // hammering holds its own window open forever.
    hits.set(key, current)
    stats.blocked += 1
    return {
      allowed: false as const,
      limit: config.max,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)),
    }
  }

  current.push(now)
  hits.set(key, current)

  return {
    allowed: true as const,
    limit: config.max,
    remaining: Math.max(0, config.max - current.length),
    resetAt,
    retryAfter: 0,
  }
}

/**
 * Identify the caller.
 *
 * For a storefront, the publishable API key is a better key than the IP: every
 * browser behind one office NAT shares an IP, but they share a sales channel
 * legitimately. Falling back to IP covers callers that have not sent one yet
 * (which Medusa is about to reject anyway).
 */
function clientKey(req: MedusaRequest): string {
  const pk = req.headers["x-publishable-api-key"]
  if (typeof pk === "string" && pk.length > 0) {
    // Only the tail — enough to distinguish callers, never the whole secret in
    // a Map that might end up in a heap dump.
    return `pk:${pk.slice(-12)}`
  }

  const forwarded = req.headers["x-forwarded-for"]
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return `ip:${forwarded.split(",")[0].trim()}`
  }

  return `ip:${req.ip ?? "unknown"}`
}

/**
 * Build a middleware. Register it in src/api/middlewares.ts against a matcher.
 *
 *   { matcher: "/store/*", middlewares: [rateLimit({ max: 240, windowMs: 60_000 })] }
 */
export function rateLimit(config: Config) {
  return (req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) => {
    const result = check(clientKey(req), config)

    res.setHeader("X-RateLimit-Limit", String(result.limit))
    res.setHeader("X-RateLimit-Remaining", String(result.remaining))
    res.setHeader("X-RateLimit-Reset", String(result.resetAt))

    if (!result.allowed) {
      res.setHeader("Retry-After", String(result.retryAfter))

      // Short-circuit by responding and NOT calling next(). Calling next() here
      // would run the route handler anyway and then fail trying to send twice.
      res.status(429).json({
        type: "rate_limited",
        message: `Too many requests. Limit is ${result.limit} per ${
          config.windowMs / 1000
        }s. Retry in ${result.retryAfter}s.`,
      })
      return
    }

    next()
  }
}

/** Exposed so the storefront dashboard can show Medusa's side of the picture. */
export function rateLimitStats() {
  return { ...stats, trackedKeys: hits.size }
}
