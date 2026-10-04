/**
 * A dependency-free sliding-window rate limiter.
 *
 * ── Read this before trusting it ───────────────────────────────────────────
 *
 * The counters live in a `Map` in THIS process's memory. That has one
 * consequence you must internalise before deploying anything like it:
 *
 *   **It does not survive a second instance.**
 *
 * Run two copies of the server behind a load balancer and each keeps its own
 * counters, so a limit of 120 becomes an effective limit of 240 — and a client
 * can dodge it entirely by being routed to whichever instance it hasn't hit yet.
 * Restarting the process resets every counter to zero.
 *
 * That is exactly the same failure mode as Medusa's in-memory event bus and
 * workflow locking (see docs/learn/09-to-production.md §9.3): fine for one
 * process on one machine, wrong the moment you scale out. The real answers are
 * a shared store (Redis) or, better, limiting at the edge before the request
 * ever reaches your app.
 *
 * It is here because "no limit at all" is worse than "a limit that only works
 * on one instance", and because the mechanism is worth being able to read.
 *
 * ── Why sliding window ────────────────────────────────────────────────────
 *
 * A fixed window (reset the count every 60s on the minute) allows double the
 * intended burst across a boundary: 120 requests at 11:59:59 and 120 more at
 * 12:00:01 is 240 in two seconds, all "within limits".
 *
 * This keeps the timestamps of recent requests and drops the ones that have
 * aged out, so the window really does slide. The cost is memory proportional to
 * requests-per-window rather than a single integer — acceptable at these limits,
 * and the trade-off worth knowing.
 */

export type RateLimitConfig = {
  /** Maximum requests allowed per key, per window. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  /** Requests left in the current window. Never negative. */
  remaining: number
  /** Unix seconds at which the oldest request ages out. */
  resetAt: number
  /** Seconds the caller should wait. Only meaningful when `allowed` is false. */
  retryAfter: number
}

/** key → timestamps (ms) of requests still inside the window. */
const hits = new Map<string, number[]>()

/**
 * Running totals, so the dashboard can show that the limiter is real without
 * anyone having to trip it. Reset when the process restarts, like everything
 * else here.
 */
const stats = {
  checked: 0,
  blocked: 0,
  startedAt: Date.now(),
}

/**
 * Sweep keys that have gone quiet, so an app that has seen many distinct
 * clients does not hold their timestamps forever.
 *
 * Called opportunistically from `check` rather than on a timer: a timer would
 * keep the event loop alive and is one more thing to shut down cleanly.
 */
function evictStale(now: number, windowMs: number): void {
  for (const [key, times] of hits) {
    if (times.length === 0 || now - times[times.length - 1] > windowMs) {
      hits.delete(key)
    }
  }
}

let lastEviction = Date.now()

/**
 * Record a request against `key` and decide whether it is allowed.
 *
 * Note this MUTATES state — calling it twice for one request consumes two slots.
 * Call it exactly once per request, in the middleware.
 */
export function check(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now()
  const windowStart = now - config.windowMs

  // Cheap housekeeping, at most once per window.
  if (now - lastEviction > config.windowMs) {
    evictStale(now, config.windowMs)
    lastEviction = now
  }

  const previous = hits.get(key) ?? []
  // Drop anything that has aged out of the window.
  const current = previous.filter((t) => t > windowStart)

  stats.checked += 1

  const oldest = current[0] ?? now
  const resetAt = Math.ceil((oldest + config.windowMs) / 1000)

  if (current.length >= config.max) {
    // Rejected requests are deliberately NOT recorded. Counting them would let
    // a client that keeps hammering hold its own window open indefinitely.
    hits.set(key, current)
    stats.blocked += 1

    return {
      allowed: false,
      limit: config.max,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((oldest + config.windowMs - now) / 1000)),
    }
  }

  current.push(now)
  hits.set(key, current)

  return {
    allowed: true,
    limit: config.max,
    remaining: Math.max(0, config.max - current.length),
    resetAt,
    retryAfter: 0,
  }
}

/** The standard response headers. Sent on success as well as on 429. */
export function headers(result: RateLimitResult): Record<string, string> {
  const h: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
  }

  if (!result.allowed) {
    // Retry-After is the one a well-behaved client actually obeys.
    h['Retry-After'] = String(result.retryAfter)
  }

  return h
}

/** Snapshot for the dashboard. */
export function snapshot(): {
  checked: number
  blocked: number
  trackedKeys: number
  uptimeSeconds: number
} {
  return {
    checked: stats.checked,
    blocked: stats.blocked,
    trackedKeys: hits.size,
    uptimeSeconds: Math.floor((Date.now() - stats.startedAt) / 1000),
  }
}

/** Used by tests, and by the dashboard's "reset counters" affordance. */
export function reset(): void {
  hits.clear()
  stats.checked = 0
  stats.blocked = 0
  stats.startedAt = Date.now()
}
