/**
 * A ring buffer of recent HTTP requests, recorded by src/middleware.ts.
 *
 * ── Why in memory, when the repo insists Astro owns no data ───────────────
 *
 * Because a log write must be cheaper than the thing it is logging. Persisting
 * one row per request would mean an HTTP round trip to a backend on every
 * request — often slower than the request being recorded, and it would make the
 * storefront's availability depend on a backend being up in order to serve a
 * page that does not need it.
 *
 * This is the same trade-off, and the same honest limitation, as
 * lib/rate-limit.ts:
 *
 *   • it resets on restart
 *   • it is per-process, so two instances each see only their own traffic
 *   • it holds the last N requests, not all of them
 *
 * Contrast uptime history, which genuinely needs durability and therefore lives
 * in a Medusa module with a real table. **Where monitoring data belongs depends
 * on whether you need to answer questions about the past.** Request rates are a
 * right-now question; uptime is a history question.
 *
 * For production this is the wrong shape entirely — you emit structured logs and
 * let something else aggregate them (docs/learn/09-to-production.md §9.8).
 *
 * ── The blind spot: it only sees what reaches the middleware ──────────────
 *
 * Astro's origin check (`security.checkOrigin`, on by default for SSR) rejects
 * any non-GET request whose `Origin` header does not match the site — and it
 * does so **upstream of middleware**, so this buffer never hears about it.
 *
 * Demonstrable in one pair of commands:
 *
 *   curl -X DELETE localhost:4321/api/reviews/nope
 *     → 403, and NOT in this buffer
 *   curl -X DELETE -H 'Origin: http://localhost:4321' localhost:4321/api/reviews/nope
 *     → reaches the endpoint, and IS in this buffer
 *
 * The lesson generalises past Astro: **application-level request logging cannot
 * see what was rejected before the application ran.** The same hole swallows
 * anything a reverse proxy, WAF or load balancer turns away. If your traffic
 * graph and your users disagree about whether requests are arriving, this gap
 * is where to look — the framework's own log (here `.astro/dev.log`, via
 * lib/log-reader.ts) sits further out and does record them.
 */

export type RequestRecord = {
  at: number
  method: string
  path: string
  status: number
  durationMs: number
  /** 2xx | 3xx | 4xx | 5xx — precomputed so consumers do not each derive it. */
  klass: string
  /** True when the rate limiter rejected it, so throttling is distinguishable. */
  limited: boolean
}

/**
 * 500 is a deliberate compromise: enough to see a pattern across a few minutes
 * of clicking, small enough that the buffer stays trivial to hold and scan.
 */
const CAPACITY = 500

/**
 * A plain array used as a ring. `shift()` on a 500-element array is fast enough
 * that the cleverer fixed-array-with-a-cursor version would be optimising the
 * wrong thing — and it would be harder to read, which matters more here.
 */
const buffer: RequestRecord[] = []

const totals = {
  count: 0,
  byClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 } as Record<string, number>,
  limited: 0,
  startedAt: Date.now(),
}

function classify(status: number): string {
  if (status >= 500) return '5xx'
  if (status >= 400) return '4xx'
  if (status >= 300) return '3xx'
  return '2xx'
}

export function record(entry: Omit<RequestRecord, 'at' | 'klass'>): void {
  const klass = classify(entry.status)

  buffer.push({ ...entry, at: Date.now(), klass })

  if (buffer.length > CAPACITY) {
    buffer.shift()
  }

  // Running totals are kept separately from the buffer because they must
  // survive eviction — otherwise "requests since start" would silently become
  // "requests in the last 500 requests".
  totals.count += 1
  totals.byClass[klass] = (totals.byClass[klass] ?? 0) + 1
  if (entry.limited) totals.limited += 1
}

export type RequestLogQuery = {
  /** '2xx' | '4xx' | … | 'errors' (4xx and 5xx together) */
  klass?: string
  /** Substring match on the path. */
  path?: string
  limit?: number
}

export function query({ klass, path, limit = 100 }: RequestLogQuery = {}) {
  let rows = [...buffer].reverse() // newest first

  if (klass === 'errors') {
    rows = rows.filter((r) => r.status >= 400)
  } else if (klass) {
    rows = rows.filter((r) => r.klass === klass)
  }

  if (path) {
    const needle = path.toLowerCase()
    rows = rows.filter((r) => r.path.toLowerCase().includes(needle))
  }

  return rows.slice(0, Math.min(500, Math.max(1, limit)))
}

export function summary() {
  const now = Date.now()
  const lastMinute = buffer.filter((r) => now - r.at < 60_000)
  const durations = buffer.map((r) => r.durationMs).sort((a, b) => a - b)

  return {
    /** Since the process started — not limited by the buffer. */
    totalRequests: totals.count,
    byClass: { ...totals.byClass },
    rateLimited: totals.limited,

    /** Windowed, so these describe now rather than all history. */
    buffered: buffer.length,
    capacity: CAPACITY,
    lastMinute: lastMinute.length,
    errorsLastMinute: lastMinute.filter((r) => r.status >= 400).length,

    /**
     * p50 and p95 rather than a mean. An average hides the slow tail, which is
     * the only part anyone complains about.
     */
    p50Ms: durations.length ? durations[Math.floor(durations.length * 0.5)] : 0,
    p95Ms: durations.length ? durations[Math.floor(durations.length * 0.95)] : 0,

    uptimeSeconds: Math.floor((now - totals.startedAt) / 1000),
  }
}

/** Used by tests. */
export function reset(): void {
  buffer.length = 0
  totals.count = 0
  totals.byClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
  totals.limited = 0
  totals.startedAt = Date.now()
}
