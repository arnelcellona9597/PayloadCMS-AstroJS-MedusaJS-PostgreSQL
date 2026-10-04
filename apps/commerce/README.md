# apps/commerce — Medusa 2

The commerce backend. Owns `Product` (built in) and `Review` (a custom module,
linked to Product).

Runs on **http://localhost:9000** · admin dashboard at `/app`

See the root [`README.md`](../../README.md) for the architecture, and
[`docs/architecture.md`](../../docs/architecture.md) §1 for the module/link/
workflow model in detail.

## Layout

Medusa discovers everything by **convention** from the filesystem. `medusa-config.ts`
only lists modules; the behaviour lives here:

```
src/modules/review/     data model + service     (business logic)
src/links/              associations between modules
src/workflows/          orchestration + rollback
src/api/                HTTP routes — file path = URL path
src/admin/widgets/      React injected into the dashboard
src/scripts/            things you run with `medusa exec`
```

## Read these, in order

1. `src/modules/review/models/review.ts` — the DML model
2. `src/modules/review/service.ts` — CRUD generated from it, then extended
3. `src/links/product-review.ts` — **the key idea**: modules are isolated, a link
   table joins them
4. `src/workflows/steps/` — compensation, one file per verb. Compare
   `create-review.ts` (undo = delete) with `update-review.ts` (undo = restore the
   previous values it had to read first)
5. `src/api/middlewares.ts` — zod validation, wired centrally
6. `src/api/store/products/[id]/reviews/route.ts` — `query.graph` reading across
   the link, plus the reason that array can contain holes

## Commands

```bash
npm run dev              # :9000
npm run db:generate      # migration for the review module, after a model change
npm run db:migrate       # apply migrations AND sync link tables
npm run seed             # products, regions, sales channel
npm run seed:reviews     # reviews, created through the workflow
npm run bootstrap        # print the publishable API key the storefront needs
npm run user -- -e a@b.c -p secret
```

## Watch the rollback

Set `DEMO_FAIL_LINK_STEP=1` in `.env`, restart, and POST a review. The link step
throws on purpose, the create step's compensation removes the row it inserted, and
the database is left exactly as it was. Details in the root README.

## A note on the scaffold

This started from `medusajs/medusa-starter-default`, which upstream now marks as
deprecated in favour of a DTC starter. The flat layout it produces
(`src/modules`, `src/api`, `src/workflows` at the project root) is deliberately
kept, because it matches the paths used throughout the Medusa documentation. The
newer starter nests the backend inside a monorepo, which adds a directory level
between you and every file the docs reference.
