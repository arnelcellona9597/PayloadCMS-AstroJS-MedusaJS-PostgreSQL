# 8 · Glossary

Every term used in this repo, defined plainly. Where a definition is
repo-specific it says so.

---

### Access control
In Payload, per-operation functions (`read`, `create`, `update`, `delete`) that
decide whether a request is allowed. Returning `true`/`false` allows or denies;
returning a **`Where` query** filters results instead. → [03](03-payload.md#34-access-control-functions-not-a-role-matrix)

### Action (Astro)
A typed server function callable from a form or from JavaScript, with zod
validation and per-field errors. Works without client JavaScript. Callable only
from the app that defines it. → [05](05-astro.md#54-pattern-a--astro-actions-posts)

### Adapter (Astro)
Teaches Astro to run on a specific host. This repo uses `@astrojs/node` in
`standalone` mode, producing a self-contained server.

### API key
A long-lived credential identifying a machine acting as a user. Payload's format
is exact: `Authorization: users API-Key <key>` — the `users` prefix is the
collection slug and is mandatory.

### BFF (Backend For Frontend)
A server between your UI and your real backends, existing to serve one frontend.
Here, Astro: it holds credentials, normalises the two backends' conventions, and
composes responses. → [01](01-foundations.md#14-bff--backend-for-frontend)

### Collection (Payload)
A group of records sharing a schema — the equivalent of a table. One config file
generates the SQL table, REST + GraphQL APIs, admin UI and TypeScript types.

### Compensation (Medusa)
A function attached to a workflow step describing how to undo it. Runs
automatically when a **later** step fails. The reason Medusa's ceremony exists.
→ [04](04-medusa.md#46-workflows--the-payoff)

### Composable / MACH
Marketing terms for an architecture assembled from several headless services.
Exactly what this repo is.

### Container (DI container)
Medusa's registry of services, addressed by name:
`req.scope.resolve(REVIEW_MODULE)`. Indirection that makes modules swappable.

### CORS
Browser rule restricting which origins may call an API. Configured in both
backends. **Irrelevant to server-side fetches** — which is why this repo's SSR
pages never hit it.

### CSR (Client-Side Rendering)
The browser builds the page from a JavaScript bundle. Implies the browser holds
any credentials the API needs. Not used here.

### CSRF (Cross-Site Request Forgery)
An attack exploiting browsers' automatic cookie sending. Astro defends by
checking the `Origin` header — which is why curl `DELETE`s need it added
manually.

### deleted_at
Column added to every Medusa data model, enabling soft delete.

### depth (Payload)
Query param controlling relationship expansion. `depth=0` returns ids; `depth=1`
returns documents; `depth=2` expands their relationships too.

### DML (Data Modelling Language)
Medusa's `model.define(...)` syntax. A *description* from which Medusa derives
the ORM entity, the SQL table and the migration.

### Drafts (Payload)
`versions: { drafts: true }` adds a `_status` field and a version-history table.
Reads return published documents by default. **Creates a second table**
(`_posts_v`) — relevant when cleaning up columns.

### Drizzle
The ORM Payload uses for Postgres.

### Endpoint (Astro)
A file in `src/pages/api/` exporting HTTP-verb functions and returning a
`Response`. A real HTTP surface anything can call. → [05](05-astro.md#55-pattern-b--your-own-rest-endpoints-reviews)

### Endpoint (Payload)
A hand-written route attached to a collection, for the cases generated CRUD can't
express — e.g. `/api/posts/stats`.

### Environment variable
Config supplied outside the code. Only `PUBLIC_`-prefixed vars reach the browser
in Astro (`NEXT_PUBLIC_` in Next). That prefix is a **security boundary**.

### Frontmatter (Astro)
The `---` block at the top of an `.astro` file. Runs **on the server**, once per
request. Never reaches the browser.

### GraphQL
Query language exposing one endpoint where the client specifies exactly what it
wants. Payload generates one; this repo's storefront uses REST instead.

### Headless
A backend that owns data and logic but not HTML, exposing everything over HTTP.
The "head" (UI) is a separate program. → [01](01-foundations.md#11-headless-and-what-it-replaced)

### Hook (Payload)
Your code injected into the document lifecycle. **Field hooks** operate on one
field (the slug derives itself this way); **collection hooks**
(`beforeChange`, `afterChange`, …) operate on the whole document.

### Idempotent
Safe to repeat. `GET`, `PUT`, `PATCH`, `DELETE` are; `POST` is not. Matters
because networks retry.

### isList (Medusa)
Option on `defineLink` marking which side may have many records. `isList: true`
on reviews = one product, many reviews.

### JWT (JSON Web Token)
A signed token proving identity for a period. **Signed, not encrypted** — anyone
can read the payload. Used for Medusa's `/admin/*`.

### Lexical
Payload's rich-text editor. Stores a **node tree** as JSON, not HTML. Consumers
walk the tree; text formatting is a bitmask per node. → [03](03-payload.md#37-rich-text-is-a-tree)

### Link (Medusa)
A third table joining two modules' records without either gaining a dependency.
Created by `defineLink`, written via the Link service, read via Query.
**The central idea in Medusa v2.** → [04](04-medusa.md#44-links--associating-without-coupling)

### Link service — `create` / `dismiss` / `delete`
`create` associates; **`dismiss` removes the association leaving both records**;
`delete` cascades into them. To undo an association you want `dismiss`.

### Local API (Payload)
In-process calls (`payload.find(...)`) using the same query language as REST but
no HTTP. **Bypasses access control by default** — pass `overrideAccess: false`
and a `user` to enforce it.

### Medusa
Headless commerce engine. Pre-built commerce plus a framework for isolated custom
modules. Port 9000.

### MikroORM
The ORM Medusa uses.

### Migration
A versioned script changing the database schema, with `up` and `down`. Medusa
generates one per model change; Payload's dev `push` skips them entirely.

### Module (Medusa)
A self-contained unit with its own data models, service and migrations. **Cannot
import or reference another module.** Everything distinctive about Medusa follows
from this. → [04](04-medusa.md#41-why-isolation)

### Module isolation
The rule that modules know nothing about each other. Necessitates links, Query,
the container and workflows.

### N+1
Fetching a list, then making one query per item. `/products` has one, left in
deliberately and labelled. → [05](05-astro.md#59-the-n1-on-products)

### ORM
Library mapping database rows to objects so you write method calls instead of
SQL.

### Payload
Headless CMS where a config file generates schema, APIs, admin UI and types.
**Requires Next.js** — it is not standalone. Port 3000.

### Publishable API key
Medusa credential identifying a **sales channel**, not a person. Required on every
`/store/*` route including custom ones. Safe in a browser; useless for `/admin/*`.
Must be **linked to a sales channel** or it scopes you to nothing.

### push (Payload)
Dev-mode schema sync: diffs the config against the database and applies the
difference. Adds columns freely; **won't drop them** without an interactive
prompt. Disable with `push: false` in production.

### Query / `query.graph` (Medusa)
The read layer that resolves fields across module boundaries via link tables. Give
it a root entity and a field list. Returns **data, not policy** — and can return
holes. → [04](04-medusa.md#45-query--reading-across-the-boundary)

### REST
Using HTTP verbs and URLs to mean things, with JSON bodies.

### Sales channel (Medusa)
A storefront context (web, mobile, POS). Publishable keys are scoped to one.

### Service (Medusa)
A module's public interface. `MedusaService({ Review })` generates CRUD methods;
you extend the class to add your own. Note the pluralisation:
`retrieveReview` but `createReviews`.

### Session cookie
Credential the browser attaches automatically. Used by both admin panels. The
reason CSRF protection exists.

### Slug
A URL-safe identifier (`what-are-payload-cms-collections`). Derived from the
title by a field hook here.

### Soft delete
Setting `deleted_at` instead of removing the row. Automatically filtered from
queries, and **trivially reversible** — which is what makes workflow rollback
cheap.

### SSG (Static Site Generation)
Rendering at build time to static files. Fastest, but data is frozen until
rebuild. Astro's `output: 'static'`.

### SSR (Server-Side Rendering)
Rendering HTML per request on the server. What this repo uses (`output:
'server'`), and the reason credentials never reach the browser.

### Step (Medusa)
One unit of a workflow: an invoke function plus an optional compensation
function. Read-only steps need no compensation.

### StepResponse
`new StepResponse(output, compensateInput)`. The two arguments differ: output is
what later steps see; compensateInput is what *this* step's rollback receives.

### `.strict()` (zod)
Rejects unknown fields. Used on Medusa's store schema so a public caller can't
sneak in `status` — a security control, not a typo check.

### Transform (`transform()`)
Medusa's SDK helper for computing on step output. Needed because workflow bodies
build a graph rather than executing — step results are proxies.

### Validator
A zod schema. In Medusa they live beside routes and are wired in
`src/api/middlewares.ts`; handlers then read `req.validatedBody`.

### Volume (Docker)
Storage kept outside a container so data survives restarts. `docker compose down`
keeps it; `down -v` deletes it. `npm run db:reset` is the second.

### Where query (Payload)
A filter object. Notably, an access function may **return** one to narrow results
rather than deny the request.

### Widget (Medusa admin)
A React component compiled into the admin dashboard at a declared `zone`, e.g.
`product.details.after`. Not a fork of the dashboard.

### Workflow (Medusa)
A named sequence of steps with automatic rollback. Every mutation in this repo
goes through one. → [04](04-medusa.md#46-workflows--the-payoff)

### zod
Schema validation library. **Each project pins its own copy** — import from
`@medusajs/framework/zod` in Medusa and `astro/zod` in Astro. Mixing them
produces incompatible types.

---

**Next:** [09-to-production.md](09-to-production.md) — the gap between this repo
and something you could deploy.
