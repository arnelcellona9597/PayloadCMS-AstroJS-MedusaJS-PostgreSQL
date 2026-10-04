import type { Endpoint } from 'payload'

/**
 * GET /api/posts/stats
 *
 * Why this file exists: auto-generated CRUD is excellent at "give me documents
 * matching a query" and useless at "give me an aggregate". Custom endpoints are
 * the escape hatch, and they are where Payload's LOCAL API earns its place.
 *
 * `req.payload.count(...)` and `req.payload.find(...)` run in-process against
 * the database. No HTTP hop, no serialisation, no re-authentication — but the
 * SAME query language as the REST API. That is the whole point of the Local API:
 * one mental model, two transports.
 *
 * Note `overrideAccess: false` below. Local API calls bypass access control by
 * DEFAULT because they are trusted server code. Passing the incoming `user` and
 * disabling the override makes this endpoint respect the same rules as REST —
 * so an anonymous caller counts only published posts.
 */
export const postStats: Endpoint = {
  path: '/stats',
  method: 'get',
  handler: async (req) => {
    const { payload, user } = req

    const [total, published, drafts, categories, recent] = await Promise.all([
      payload.count({ collection: 'posts', overrideAccess: false, user }),
      payload.count({
        collection: 'posts',
        where: { _status: { equals: 'published' } },
        overrideAccess: false,
        user,
      }),
      // Drafts are invisible to anonymous callers, so this legitimately
      // returns 0 for them — a live demonstration of access control.
      payload.count({
        collection: 'posts',
        where: { _status: { equals: 'draft' } },
        overrideAccess: false,
        user,
      }),
      payload.count({ collection: 'categories', overrideAccess: false, user }),
      payload.find({
        collection: 'posts',
        limit: 5,
        sort: '-updatedAt',
        depth: 0,
        select: { title: true, slug: true, updatedAt: true },
        overrideAccess: false,
        user,
      }),
    ])

    return Response.json({
      counts: {
        posts: total.totalDocs,
        published: published.totalDocs,
        drafts: drafts.totalDocs,
        categories: categories.totalDocs,
      },
      recent: recent.docs,
      // Handy when debugging the storefront's API-key header.
      authenticatedAs: user ? { id: user.id, email: user.email } : null,
      generatedAt: new Date().toISOString(),
    })
  },
}
