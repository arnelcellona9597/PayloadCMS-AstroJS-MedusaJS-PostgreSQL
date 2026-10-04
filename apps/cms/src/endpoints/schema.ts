import type { Endpoint } from 'payload'
import { sql } from 'drizzle-orm'

/**
 * GET /api/schema — introspect Payload's own database.
 *
 * ── Why this lives here, and not in the storefront ────────────────────────
 *
 * Astro could technically open a Postgres connection and read both databases
 * directly. It deliberately does not. The whole architecture of this repo rests
 * on one rule — **Astro owns no data and reaches backends only over HTTP** — and
 * a shortcut here would quietly break the thing the repo exists to teach.
 *
 * So each backend introspects the database it owns and exposes the result. Astro
 * composes the two at /schema. Medusa's equivalent is
 * apps/commerce/src/api/admin/schema/route.ts.
 *
 * ── The escape hatch ──────────────────────────────────────────────────────
 *
 * Payload's Local API models documents, not tables, so there is no
 * `payload.findTables()`. For genuine SQL you drop to the adapter's Drizzle
 * instance:
 *
 *   payload.db.drizzle.execute(sql`…`)
 *
 * That is the deepest layer available and it is escaping the abstraction on
 * purpose — appropriate for introspection, and the wrong tool for anything the
 * Local API can already express.
 *
 * Read-only by construction: it queries `information_schema`, which describes
 * the database without touching application data.
 */
export const schemaEndpoint: Endpoint = {
  path: '/schema',
  method: 'get',
  handler: async (req) => {
    const { payload, user } = req

    // Schema shape is infrastructure detail — not something to hand anonymous
    // callers. Everything else in this repo is readable; this is not.
    if (!user) {
      return Response.json(
        { error: 'Authentication required. Send the users API-Key header.' },
        { status: 401 },
      )
    }

    const db = payload.db as unknown as {
      drizzle: { execute: (q: unknown) => Promise<{ rows: Record<string, unknown>[] }> }
    }

    /**
     * One query, not one per table. The obvious implementation — list tables,
     * then loop asking for each table's columns — is an N+1 against your own
     * database, and it is the same mistake the /products page makes against
     * Medusa (see docs/learn/05-astro.md §5.9).
     */
    const result = await db.drizzle.execute(sql`
      select
        c.table_name,
        count(*)::int                                        as column_count,
        coalesce(
          json_agg(
            json_build_object(
              'name', c.column_name,
              'type', c.data_type,
              'nullable', c.is_nullable = 'YES',
              'default', c.column_default
            )
            order by c.ordinal_position
          ) filter (where c.column_name is not null),
          '[]'
        )                                                    as columns,
        coalesce(pg_total_relation_size(quote_ident(c.table_name)::regclass), 0)::bigint as bytes
      from information_schema.columns c
      join information_schema.tables t
        on t.table_name = c.table_name and t.table_schema = c.table_schema
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      group by c.table_name
      order by c.table_name
    `)

    const tables = (result.rows ?? []).map((row) => {
      const name = String(row.table_name)

      /**
       * Classify each table by what produced it. This is the part that turns a
       * flat list into a lesson: four declared collections became fourteen
       * tables, and every extra one has a cause.
       */
      let kind: string
      let origin: string

      if (name.startsWith('payload_')) {
        kind = 'internal'
        origin = "Payload's own bookkeeping — not from your config"
      } else if (name.startsWith('_') && name.includes('_v')) {
        kind = 'versions'
        origin = 'drafts/versions enabled on the matching collection'
      } else if (name.includes('_rels')) {
        kind = 'relationships'
        origin = 'polymorphic relationship storage'
      } else if (name.endsWith('_sessions')) {
        kind = 'auth'
        origin = 'auth: true on a collection'
      } else if (/^[a-z]+_[a-z]+$/.test(name) && !name.startsWith('payload')) {
        kind = 'sub-table'
        origin = 'an array or blocks field — each row of the array is a row here'
      } else {
        kind = 'collection'
        origin = 'declared in payload.config.ts'
      }

      return {
        name,
        kind,
        origin,
        columnCount: Number(row.column_count),
        bytes: Number(row.bytes),
        columns: row.columns,
      }
    })

    const byKind = tables.reduce<Record<string, number>>((acc, t) => {
      acc[t.kind] = (acc[t.kind] ?? 0) + 1
      return acc
    }, {})

    return Response.json({
      database: 'payload_crud',
      owner: 'Payload',
      /**
       * Worth separating, because the raw list surprises people:
       * `payload.config.collections` contains Payload's OWN injected
       * collections alongside yours — payload-kv, payload-locked-documents,
       * payload-preferences, payload-migrations. You declared four; the config
       * reports eight.
       */
      collections: {
        yours: payload.config.collections
          .map((c) => c.slug)
          .filter((slug) => !slug.startsWith('payload-')),
        injectedByPayload: payload.config.collections
          .map((c) => c.slug)
          .filter((slug) => slug.startsWith('payload-')),
      },
      globals: payload.config.globals.map((g) => g.slug),
      tableCount: tables.length,
      byKind,
      tables,
      /**
       * Payload derives the schema from the config, so there is no separate
       * migration list to report in dev — `push` leaves no artefact. The
       * `payload_migrations` table exists all the same; see chapter 10.
       */
      schemaStrategy: 'push (development) — see docs/learn/10-databases.md',
      generatedAt: new Date().toISOString(),
    })
  },
}
