import type { CollectionConfig } from 'payload'

import { slugFrom } from '../hooks/slugify'
import { postStats } from '../endpoints/postStats'

/**
 * Posts — the CRUD centrepiece of the CMS side of this project.
 *
 * Everything interesting about Payload's architecture is visible in this one
 * object, in the order a request passes through it:
 *
 *   1. `access`   — per-operation authorisation functions
 *   2. `fields`   — schema, validation, admin UI, and generated TS types
 *   3. `hooks`    — side effects and derived data at lifecycle points
 *   4. `versions` — draft/published state machine
 *   5. `endpoints`— hand-written routes for the cases CRUD cannot express
 *
 * There is no controller, no service, no repository and no migration file. The
 * Postgres schema is derived from `fields` (via Drizzle) and pushed in dev.
 */
export const Posts: CollectionConfig = {
  slug: 'posts',

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', '_status', 'publishedAt', 'updatedAt'],
    listSearchableFields: ['title', 'excerpt'],
  },

  /**
   * Access control is a set of FUNCTIONS, one per operation — not a static role
   * matrix. Each receives the request, so a rule can depend on the user, the
   * document, or anything else reachable at request time.
   *
   * A function may also return a `Where` query instead of a boolean, which
   * filters the result set rather than rejecting the request outright. That is
   * how `read` below hides drafts from anonymous callers while still letting
   * logged-in editors see them.
   */
  access: {
    read: ({ req }) => {
      if (req.user) return true // editors and admins see drafts too

      // Anonymous callers only ever see published documents. Returning a query
      // (not `false`) means the request succeeds with drafts filtered out.
      return {
        _status: { equals: 'published' },
      }
    },
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    // Deliberately stricter than update, to show operations differ.
    delete: ({ req }) => req.user?.role === 'admin',
  },

  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      maxLength: 200,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Left blank, this is derived from the title.',
      },
      hooks: {
        // A field-level hook: the slug computes itself from `title`.
        beforeValidate: [slugFrom('title')],
      },
    },
    {
      name: 'excerpt',
      type: 'textarea',
      maxLength: 300,
      admin: {
        description: 'Short summary used in listings.',
      },
    },
    {
      name: 'content',
      type: 'richText',
      // Inherits the lexicalEditor configured globally in payload.config.ts.
      // Stored as structured JSON, NOT as an HTML string — which is why the
      // storefront has to walk the node tree to render it. See
      // apps/storefront/src/lib/lexical.ts.
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      admin: { position: 'sidebar' },
      // Returned as an ID by default; `?depth=1` on the request replaces it
      // with the full category document.
    },
    {
      name: 'coverImage',
      type: 'upload',
      relationTo: 'media',
      admin: { position: 'sidebar' },
    },
    {
      name: 'tags',
      type: 'array',
      labels: { singular: 'Tag', plural: 'Tags' },
      fields: [{ name: 'tag', type: 'text', required: true }],
      // An `array` field becomes its OWN Postgres table (posts_tags) with a
      // parent FK and an order column. Worth knowing when you write raw SQL.
    },
    {
      name: 'publishedAt',
      type: 'date',
      admin: {
        position: 'sidebar',
        date: { pickerAppearance: 'dayAndTime' },
      },
    },
  ],

  hooks: {
    /**
     * Collection-level hooks. `beforeChange` can rewrite the document; the
     * value it returns is what gets saved.
     */
    beforeChange: [
      ({ data, operation }) => {
        // Stamp a publish date the first time a post actually goes live.
        if (data._status === 'published' && !data.publishedAt) {
          data.publishedAt = new Date().toISOString()
        }
        if (operation === 'create' && !data._status) {
          data._status = 'draft'
        }
        return data
      },
    ],

    /**
     * `afterChange` runs once the write has committed. This is the seam where a
     * real deployment would invalidate downstream caches — e.g. POST to an
     * Astro revalidation endpoint. Left as a log so the lifecycle is observable
     * in the terminal without adding coupling.
     */
    afterChange: [
      ({ doc, operation, req }) => {
        req.payload.logger.info(
          `[posts.afterChange] ${operation} id=${doc.id} slug=${doc.slug} status=${doc._status}`,
        )
      },
    ],

    afterDelete: [
      ({ doc, req }) => {
        req.payload.logger.info(`[posts.afterDelete] id=${doc.id} slug=${doc.slug}`)
      },
    ],
  },

  /**
   * Drafts add a `_status` field ('draft' | 'published') and a version history
   * table. Consequences worth remembering:
   *   - reads default to published only; pass `?draft=true` (authenticated) for
   *     the latest draft
   *   - a create/update can set `_status` explicitly to publish in one call
   */
  versions: {
    drafts: true,
    maxPerDoc: 10,
  },

  /**
   * Hand-written route, mounted at /api/posts/stats.
   * Auto-generated CRUD covers the predictable 80%; this covers the rest.
   */
  endpoints: [postStats],

  timestamps: true, // createdAt / updatedAt (this is the default; explicit here)
}
