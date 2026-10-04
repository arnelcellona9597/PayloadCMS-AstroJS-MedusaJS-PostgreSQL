import { env } from './env'
import type { AdminReview, ReviewStatus } from './types'

/**
 * Client for Medusa's ADMIN surface.
 *
 * A separate file from medusa.ts because the auth model is genuinely different,
 * and blurring them is how credentials end up somewhere they should not be:
 *
 *   /store/*  →  x-publishable-api-key   public, sales-channel scoped
 *   /admin/*  →  Authorization: Bearer <JWT>   full access
 *
 * The JWT comes from POST /auth/user/emailpass. It is cached in module scope for
 * its lifetime, so a burst of admin calls performs one login rather than N.
 *
 * ── Where this can and cannot be used ──────────────────────────────────────
 * Only from server-side code: Astro pages, Actions, and src/pages/api/** routes.
 * If any of this reached the browser, a visitor would hold admin credentials.
 * Astro's `import.meta.env` (no PUBLIC_ prefix) is what enforces that.
 */

const BASE = env.medusa.url

let cachedToken: { value: string; expiresAt: number } | null = null

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value
  }

  const res = await fetch(`${BASE}/auth/user/emailpass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: env.medusa.adminEmail,
      password: env.medusa.adminPassword,
    }),
  })

  if (!res.ok) {
    throw new MedusaAdminError(
      `Admin login failed (${res.status}). Create the user with: cd apps/commerce && npm run user -- -e ${env.medusa.adminEmail} -p ${env.medusa.adminPassword}`,
      res.status,
    )
  }

  const { token } = (await res.json()) as { token: string }

  // Medusa's default is 24h; re-login well before that rather than parsing the
  // JWT's exp claim, which would couple us to its payload shape.
  cachedToken = { value: token, expiresAt: Date.now() + 30 * 60 * 1000 }

  return token
}

export class MedusaAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'MedusaAdminError'
  }
}

async function adminRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { method = 'GET', body, query } = options
  const token = await getToken()

  const url = new URL(`${BASE}${path}`)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null

  if (!res.ok) {
    const message = (parsed as { message?: string } | null)?.message ?? `Medusa admin returned ${res.status}`
    throw new MedusaAdminError(message, res.status, parsed)
  }

  return parsed as T
}

export type AdminListReviewsResult = {
  reviews: AdminReview[]
  count: number
  limit: number
  offset: number
}

export function listAdminReviews(
  options: {
    status?: ReviewStatus
    productId?: string
    q?: string
    limit?: number
    offset?: number
    order?: string
  } = {},
): Promise<AdminListReviewsResult> {
  const { status, productId, q, limit = 20, offset = 0, order = '-created_at' } = options

  return adminRequest<AdminListReviewsResult>('/admin/reviews', {
    query: { status, product_id: productId, q, limit, offset, order },
  })
}

export function getAdminReview(id: string): Promise<{ review: AdminReview }> {
  return adminRequest<{ review: AdminReview }>(`/admin/reviews/${id}`)
}

export type AdminUpdateReviewInput = {
  title?: string
  content?: string
  rating?: number
  author_name?: string
  author_email?: string | null
  status?: ReviewStatus
}

/**
 * Update a review.
 *
 * POST rather than PATCH — Medusa's admin convention. Payload's equivalent uses
 * PATCH. Normalising that inconsistency behind these two client modules is
 * precisely the job of a BFF: pages call `updateReview(...)` and never learn
 * which verb the backend happened to choose.
 */
export function updateAdminReview(id: string, input: AdminUpdateReviewInput): Promise<{ review: AdminReview }> {
  return adminRequest<{ review: AdminReview }>(`/admin/reviews/${id}`, {
    method: 'POST',
    body: input,
  })
}

export function deleteAdminReview(id: string): Promise<{ id: string; deleted: boolean }> {
  return adminRequest<{ id: string; deleted: boolean }>(`/admin/reviews/${id}`, {
    method: 'DELETE',
  })
}

// ── Schema introspection ────────────────────────────────────────────────────

export type MedusaSchema = {
  database: string
  tableCount: number
  linkShapedCount: number
  declaredLinkCount: number
  crossModuleLinkCount: number
  softDeleteTableCount: number
  byModule: Record<string, number>
  migrationTables: Record<string, number>
  linkShapedTables: { name: string; links: string[] }[]
  declaredLinks: { table: string; from: string; to: string; crossModule: boolean }[]
  tables: {
    name: string
    module: string
    linkShaped: boolean
    links?: string[]
    columnCount: number
    bytes: number
    softDeletes: boolean
  }[]
  schemaStrategy: string
}

/** Medusa's own description of its database. Admin-only — schema is infra detail. */
export function getMedusaSchema(): Promise<MedusaSchema> {
  return adminRequest<MedusaSchema>('/admin/schema')
}

// ─────────────────────────────────────────────────────────────────────────────
// Operations
//
// Uptime history and workflow executions both live behind /admin/*, so they
// reuse adminRequest and its cached JWT. Nothing new about the transport —
// the point is that the storefront reads these over HTTP like everything else,
// rather than opening its own connection to Medusa's database.
// ─────────────────────────────────────────────────────────────────────────────

export type UptimeTarget = {
  target: string
  url: string
  checks: number
  failures: number
  uptimePercent: number
  avgLatencyMs: number
  /** Consecutive checks in the current state — how long it has been like this. */
  streak: number
  currentlyUp: boolean
  lastIncidentAt: string | null
  lastIncidentError: string | null
  lastCheckedAt: string | null
}

export type UptimeSummary = {
  windowHours: number
  targets: UptimeTarget[]
  /**
   * False means the job has never recorded a check. Distinguishing that from
   * "100% uptime" is the whole reason this flag is sent over the wire.
   */
  monitoring: boolean
  note?: string
  incidents: { target: string; error: string | null; statusCode: number | null; at: string }[]
  generatedAt: string
}

export function getUptime(hours = 24): Promise<UptimeSummary> {
  return adminRequest<UptimeSummary>('/admin/uptime', { query: { hours } })
}

export type WorkflowStep = {
  name: string
  depth: number
  invoke: string | null
  invokeStatus: string | null
  compensate: string | null
}

export type WorkflowExecution = {
  workflowId: string
  transactionId: string
  state: string
  steps: WorkflowStep[]
  startedAt: string
  updatedAt: string
}

export type WorkflowSummary = {
  /** `reverted` is kept apart from `failed` — see api/admin/workflows/route.ts. */
  counts: { successful: number; pending: number; reverted: number; failed: number }
  byState: Record<string, number>
  byWorkflow: Record<string, Record<string, number>>
  executions: WorkflowExecution[]
  retaining: boolean
  note?: string
  generatedAt: string
}

export function getWorkflows(limit = 20): Promise<WorkflowSummary> {
  return adminRequest<WorkflowSummary>('/admin/workflows', { query: { limit } })
}
