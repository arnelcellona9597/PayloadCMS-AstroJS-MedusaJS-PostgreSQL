import { env } from './env'
import type { Category, LexicalRoot, PaginatedDocs, Post, PostStats } from './types'

/**
 * Typed client for the Payload CMS REST API.
 *
 * ── The one thing to get right: the auth header ─────────────────────────────
 *
 *   Authorization: users API-Key <key>
 *                  ^^^^^ the COLLECTION SLUG of the auth collection
 *
 * Not `Bearer <key>`. Not `API-Key <key>`. The collection slug prefix is
 * mandatory, because Payload supports API keys on ANY auth-enabled collection and
 * needs to know which one to look in. Get it wrong and every write returns 403
 * with no hint as to why.
 *
 * Everything here runs server-side only. The key is never sent to the browser.
 */

const BASE = `${env.payload.url}/api`

const authHeader = { Authorization: `users API-Key ${env.payload.apiKey}` }

export class PayloadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message)
    this.name = 'PayloadError'
  }
}

type RequestOptions = {
  method?: string
  body?: unknown
  /** Send the API key. Off by default so pages can prove what is public. */
  authenticated?: boolean
  query?: Record<string, string | number | boolean | undefined>
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, authenticated = false, query } = options

  const url = new URL(`${BASE}${path}`)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value))
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(authenticated ? authHeader : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null

  if (!res.ok) {
    const payloadErrors = (parsed as { errors?: { message: string }[] } | null)?.errors
    const message = payloadErrors?.map((e) => e.message).join('; ') || `Payload returned ${res.status}`

    throw new PayloadError(message, res.status, parsed)
  }

  return parsed as T
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * List posts.
 *
 * `depth` is Payload's relationship-expansion control and the single most useful
 * query param to understand:
 *   depth=0 → `category: 3`                 (just the id — one query)
 *   depth=1 → `category: { id: 3, name … }` (the document — joined)
 *   depth=2 → also expands relationships INSIDE category
 *
 * Default it low and raise it only where the page actually renders the related
 * data, or you will fetch a tree you never look at.
 */
export function listPosts(options: {
  limit?: number
  page?: number
  sort?: string
  depth?: number
  /** With the API key, drafts are included. Without it, access control hides them. */
  includeDrafts?: boolean
  search?: string
  categoryId?: number
} = {}): Promise<PaginatedDocs<Post>> {
  const { limit = 20, page = 1, sort = '-updatedAt', depth = 1, includeDrafts = false, search, categoryId } = options

  const query: Record<string, string | number> = { limit, page, sort, depth }

  // Payload's `where` is expressed as bracketed query params:
  //   ?where[title][contains]=astro
  if (search) {
    query['where[title][contains]'] = search
  }

  if (categoryId !== undefined) {
    query['where[category][equals]'] = categoryId
  }

  return request<PaginatedDocs<Post>>('/posts', {
    query,
    authenticated: includeDrafts,
  })
}

export function getPost(id: number | string, depth = 1): Promise<Post> {
  return request<Post>(`/posts/${id}`, { query: { depth }, authenticated: true })
}

/**
 * Fetch by slug. There is no /posts/slug/:slug route — you filter the list and
 * take the first result, which is the idiomatic Payload approach.
 */
export async function getPostBySlug(slug: string, options: { includeDrafts?: boolean } = {}): Promise<Post | null> {
  const result = await request<PaginatedDocs<Post>>('/posts', {
    query: { 'where[slug][equals]': slug, depth: 2, limit: 1 },
    authenticated: options.includeDrafts ?? false,
  })

  return result.docs[0] ?? null
}

export function listCategories(): Promise<PaginatedDocs<Category>> {
  return request<PaginatedDocs<Category>>('/categories', { query: { limit: 100, sort: 'name' } })
}

/** The hand-written endpoint in apps/cms/src/endpoints/postStats.ts. */
export function getPostStats(options: { authenticated?: boolean } = {}): Promise<PostStats> {
  return request<PostStats>('/posts/stats', { authenticated: options.authenticated ?? true })
}

// ── Writes ──────────────────────────────────────────────────────────────────

export type PostInput = {
  title: string
  excerpt?: string | null
  /** Plain text; converted to a minimal Lexical tree by `toLexical`. */
  body?: string | null
  category?: number | null
  status?: 'draft' | 'published'
}

/**
 * Lexical stores rich text as a node tree, not as HTML or Markdown. This builds
 * the minimum valid tree for a set of paragraphs so a plain <textarea> can feed
 * a richText field.
 *
 * A production editor would render Lexical properly rather than round-tripping
 * through plain text — this is the smallest thing that is actually correct.
 */
export function toLexical(text: string) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)

  return {
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: paragraphs.map((paragraph) => ({
        type: 'paragraph',
        format: '',
        indent: 0,
        version: 1,
        direction: 'ltr',
        textFormat: 0,
        children: [
          {
            type: 'text',
            detail: 0,
            format: 0,
            mode: 'normal',
            style: '',
            text: paragraph.trim(),
            version: 1,
          },
        ],
      })),
    },
  }
}

function toPayloadBody(input: PostInput) {
  return {
    title: input.title,
    excerpt: input.excerpt || undefined,
    ...(input.body ? { content: toLexical(input.body) } : {}),
    ...(input.category ? { category: input.category } : { category: null }),
    _status: input.status ?? 'draft',
  }
}

export async function createPost(input: PostInput): Promise<Post> {
  const result = await request<{ doc: Post }>('/posts', {
    method: 'POST',
    body: toPayloadBody(input),
    authenticated: true,
  })

  return result.doc
}

/** Payload uses PATCH for updates. Medusa uses POST. See src/lib/medusa.ts. */
export async function updatePost(id: number | string, input: PostInput): Promise<Post> {
  const result = await request<{ doc: Post }>(`/posts/${id}`, {
    method: 'PATCH',
    body: toPayloadBody(input),
    authenticated: true,
  })

  return result.doc
}

export async function deletePost(id: number | string): Promise<void> {
  await request(`/posts/${id}`, { method: 'DELETE', authenticated: true })
}

/** Used by the health dashboard on the home page. */
export async function payloadHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const stats = await getPostStats({ authenticated: true })
    return {
      ok: true,
      detail: `${stats.counts.posts} posts (${stats.counts.drafts} draft), authenticated as ${
        stats.authenticatedAs?.email ?? 'nobody'
      }`,
    }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'unreachable' }
  }
}

// ── Schema introspection ────────────────────────────────────────────────────

export type PayloadSchema = {
  database: string
  collections: { yours: string[]; injectedByPayload: string[] }
  globals: string[]
  tableCount: number
  byKind: Record<string, number>
  tables: {
    name: string
    kind: string
    origin: string
    columnCount: number
    bytes: number
    columns: { name: string; type: string; nullable: boolean; default: string | null }[]
  }[]
  schemaStrategy: string
}

/**
 * Payload's own description of its database.
 *
 * Astro never opens a Postgres connection — that would break the rule the whole
 * repo teaches, that the frontend reaches backends over HTTP only. Each backend
 * introspects the database it owns; this just asks.
 */
export function getPayloadSchema(): Promise<PayloadSchema> {
  return request<PayloadSchema>('/schema', { authenticated: true })
}

// ── Globals and block-built pages ───────────────────────────────────────────

export type SiteSettings = {
  siteName: string
  tagline?: string | null
  announcement?: { enabled?: boolean; message?: string | null; tone?: 'info' | 'warning' } | null
  socialLinks?: { label: string; url: string }[] | null
}

/**
 * A global has no id and no list — there is exactly one, always.
 *
 * Note the URL shape: `/api/globals/<slug>`, not `/api/<slug>`. And there is no
 * "not found" case to handle; Payload returns field defaults before anyone has
 * ever saved the record.
 */
export function getSiteSettings(): Promise<SiteSettings> {
  return request<SiteSettings>('/globals/site-settings')
}

/** One entry per block type in the Pages `layout` field. */
export type PageBlock =
  | { blockType: 'hero'; id?: string; heading: string; subheading?: string | null; align?: 'left' | 'center' }
  | { blockType: 'prose'; id?: string; body?: LexicalRoot | null }
  | { blockType: 'stats'; id?: string; items?: { id?: string; value: string; label: string }[] }

export type Page = {
  id: number
  title: string
  slug: string
  layout?: PageBlock[] | null
  updatedAt: string
}

export function listPages(): Promise<PaginatedDocs<Page>> {
  return request<PaginatedDocs<Page>>('/pages', { query: { limit: 50, sort: 'title', depth: 1 } })
}

export async function getPageBySlug(slug: string): Promise<Page | null> {
  const result = await request<PaginatedDocs<Page>>('/pages', {
    query: { 'where[slug][equals]': slug, limit: 1, depth: 2 },
  })

  return result.docs[0] ?? null
}
