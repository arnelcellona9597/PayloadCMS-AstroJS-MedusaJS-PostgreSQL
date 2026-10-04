import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * GET /admin/schema — introspect Medusa's own database.
 *
 * The counterpart to apps/cms/src/endpoints/schema.ts. Same reason for existing:
 * Astro reaches backends over HTTP only, so each backend describes the database
 * it owns rather than letting the frontend open a Postgres connection.
 *
 * ── The escape hatch ──────────────────────────────────────────────────────
 *
 * Module services model their own entities and cannot see anything else — that
 * is the whole point of module isolation. Introspecting the entire database is
 * explicitly *not* a module's job, so this drops to the raw connection:
 *
 *   container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
 *
 * That is a Knex instance covering the whole schema, module boundaries and all.
 * Use it for infrastructure questions like this one; never for business data,
 * where it would bypass every rule the modules enforce.
 *
 * ── Why /admin and not /store ─────────────────────────────────────────────
 * Schema shape is infrastructure detail. Putting it under /admin/* means Medusa
 * requires an authenticated admin before the handler runs, with no auth code
 * here at all — the path does it.
 */

/** Link tables join two modules and are named `<a>_<b>` with exactly these columns. */
const LINK_TABLE_SHAPE = new Set(["id", "created_at", "updated_at", "deleted_at"])

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const knex = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)

  /**
   * One round trip. Grouping in SQL rather than looping per table matters more
   * here than in Payload's version: 145 tables would be 145 queries.
   */
  const { rows } = await knex.raw(`
    select
      c.table_name,
      count(*)::int as column_count,
      -- json_agg with an explicit ::text cast, NOT array_agg. column_name is
      -- type sql_identifier; array_agg of that yields sql_identifier[], which
      -- node-postgres has no parser for, so it arrives as the raw string
      -- '{a,b,c}' and .filter() throws "is not a function".
      json_agg(c.column_name::text order by c.ordinal_position) as column_names,
      coalesce(pg_total_relation_size(quote_ident(c.table_name)::regclass), 0)::bigint as bytes
    from information_schema.columns c
    join information_schema.tables t
      on t.table_name = c.table_name and t.table_schema = c.table_schema
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
    group by c.table_name
    order by c.table_name
  `)

  type Row = {
    table_name: string
    column_count: number
    column_names: string[]
    bytes: string
  }

  const tables = (rows as Row[]).map((row) => {
    const cols = new Set(row.column_names)
    const foreignKeyish = row.column_names.filter((n) => n.endsWith("_id"))

    /**
     * "Link-shaped": nothing but an id, timestamps, and exactly two *_id
     * columns.
     *
     * ⚠️ Shape alone cannot tell a CROSS-MODULE link from a WITHIN-MODULE join
     * table. `product_sales_channel` joins two modules; `product_tags` joins two
     * entities inside the product module. Both look identical here. The
     * authoritative list is what `npm run db:migrate` prints under "Created
     * following links tables".
     *
     * Reported honestly as `linkShaped` rather than `isLink` for that reason —
     * and the over-detection is itself worth seeing: Medusa uses the same table
     * shape for both jobs, so our product_product_review_review is not special.
     * It is the ordinary way two things are associated.
     */
    const linkShaped =
      foreignKeyish.length === 2 &&
      row.column_names.every((n) => LINK_TABLE_SHAPE.has(n) || n.endsWith("_id"))

    /**
     * Which module owns it. Medusa does not record this in the database, so it
     * is inferred from the name prefix — good enough to show the partitioning,
     * and worth knowing it is a heuristic rather than ground truth.
     */
    const module = row.table_name.split("_")[0]

    return {
      name: row.table_name,
      module,
      linkShaped,
      links: linkShaped ? foreignKeyish : undefined,
      columnCount: row.column_count,
      bytes: Number(row.bytes),
      softDeletes: cols.has("deleted_at"),
    }
  })

  const linkTables = tables.filter((t) => t.linkShaped)

  /**
   * The AUTHORITATIVE list of cross-module links.
   *
   * Shape-matching over-detects, because a within-module join table
   * (product_tags) looks identical to a cross-module link
   * (product_sales_channel). Medusa records the real ones itself, in
   * `link_module_migrations`, along with which module sits on each side:
   *
   *   { fromModule: "cart", fromModel: "cart",
   *     toModule: "payment", toModel: "payment_collection" }
   *
   * So there is no need to guess. This is what `npm run db:migrate` prints under
   * "Created following links tables", queryable after the fact.
   */
  const { rows: linkRows } = await knex.raw(`
    select table_name, link_descriptor
    from link_module_migrations
    order by table_name
  `)

  type LinkRow = {
    table_name: string
    link_descriptor: {
      fromModule?: string
      fromModel?: string
      toModule?: string
      toModel?: string
    }
  }

  const declaredLinks = (linkRows as LinkRow[]).map((row) => {
    const d = row.link_descriptor ?? {}
    return {
      table: row.table_name,
      from: `${d.fromModule ?? "?"}.${d.fromModel ?? "?"}`,
      to: `${d.toModule ?? "?"}.${d.toModel ?? "?"}`,
      /** True when the two sides really are different modules. */
      crossModule: Boolean(d.fromModule && d.toModule && d.fromModule !== d.toModule),
    }
  })

  /**
   * Medusa keeps THREE migration histories, not one — worth surfacing, because
   * it explains why `db:generate` and `db:migrate` are separate commands and
   * why links need the second but not the first.
   */
  const migrationCounts: Record<string, number> = {}
  for (const table of ["mikro_orm_migrations", "link_module_migrations", "script_migrations"]) {
    try {
      const { rows } = await knex.raw(`select count(*)::int as n from ${table}`)
      migrationCounts[table] = rows[0]?.n ?? 0
    } catch {
      migrationCounts[table] = -1 // table absent on this version
    }
  }

  const byModule = tables.reduce<Record<string, number>>((acc, t) => {
    acc[t.module] = (acc[t.module] ?? 0) + 1
    return acc
  }, {})

  res.json({
    database: "medusa_crud",
    owner: "Medusa",
    tableCount: tables.length,
    linkShapedCount: linkTables.length,
    declaredLinkCount: declaredLinks.length,
    crossModuleLinkCount: declaredLinks.filter((l) => l.crossModule).length,
    softDeleteTableCount: tables.filter((t) => t.softDeletes).length,
    /** Biggest families first — this is what module partitioning looks like. */
    byModule: Object.fromEntries(
      Object.entries(byModule)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
    ),
    /** Guessed from shape — kept so you can see the over-detection. */
    linkShapedTables: linkTables.map((t) => ({ name: t.name, links: t.links })),
    /** Medusa's own record. Trust this one. */
    declaredLinks,
    tables,
    schemaStrategy: "explicit migrations — see docs/learn/10-databases.md",
    migrationTables: migrationCounts,
    generatedAt: new Date().toISOString(),
  })
}
