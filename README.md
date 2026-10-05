# Astro + Payload + Medusa — a stack you can read

A working three-service application, built so the **architectural differences
between the three frameworks are visible by comparison** rather than described in
prose.

The same problem — CRUD plus a REST API — is solved three times, each time in the
idiom the framework actually wants:

| Service | Role | Owns | Port |
|---|---|---|---|
| **Payload 3.88** | headless CMS, config-as-code | `Post`, `Category`, `Media`, `User` | 3000 |
| **Medusa 2.19** | commerce engine, DDD modules + workflows | `Review` (custom module, linked to `Product`) | 9000 |
| **Astro 7.2** | SSR frontend + BFF | nothing — it is a client of both | 4321 |

The interesting part is not that it works. It is *how differently* the two
backends get you to the same five verbs, and what each choice costs.

> ### 👋 New to this stack?
>
> This README compares the three frameworks and assumes you already know terms
> like *module*, *migration*, *BFF* and *compensation*.
>
> If any of those are unfamiliar, **start with the course instead:**
> **[docs/learn/](docs/learn/)** — foundations, infrastructure, a chapter per
> framework, and 10 verified hands-on labs. Come back here afterwards; it reads
> very differently once the vocabulary is in place.
>
> If you are coming from **WordPress**, there is a track written for you:
> **[docs/from-wordpress/](docs/from-wordpress/)** — every concept introduced
> by naming its WordPress counterpart first, from ACF and custom post types to
> WooCommerce. Neither track is a prerequisite for the other.
>
> If you already know what you want to build, **[docs/how-to/](docs/how-to/)**
> is the cookbook — numbered steps for one specific task, from creating a post
> type to registering a payment provider.

---

## Quick start

```bash
git clone git@github.com:arnelcellona9597/PayloadCMS-AstroJS-MedusaJS-PostgreSQL.git
cd PayloadCMS-AstroJS-MedusaJS-PostgreSQL
```

```bash
npm install && npm run setup
```

That brings up Postgres, installs all three apps, migrates, seeds, creates admin
users, and writes the API keys into `apps/storefront/.env`. Then:

```bash
npm run dev
```

| | URL | Login |
|---|---|---|
| Storefront | http://localhost:4321 | — |
| CMS admin | http://localhost:3000/admin | `admin@local.test` / `supersecret` |
| Medusa admin | http://localhost:9000/app | `admin@local.test` / `supersecret` |

### What the seed gives you

The databases are not empty — they hold a working knowledge base and catalogue:

| | Content |
|---|---|
| **Payload** | **32 developer guides** across 6 categories, each with a generated cover image. 29 published, 3 drafts left unpublished so the access-control rules have something to hide. |
| **Medusa** | **15 infrastructure products** — VPS and managed hosting, managed PostgreSQL, CDN, WAF, monitoring, backups, premium plugins — with 40 plan tiers, prices in EUR and USD, and 45 reviews across approved, pending and rejected. |

The guides answer the questions a WordPress developer actually asks on arriving
here: how to create a post type, where `wp-config.php` went, whether there are
SEO plugins, how to add a payment gateway. Content lives in
[`apps/cms/src/scripts/guides.ts`](apps/cms/src/scripts/guides.ts) and
[`apps/commerce/src/scripts/catalogue.ts`](apps/commerce/src/scripts/catalogue.ts) —
edit those and re-run the seed.

Start at the storefront home page: it health-checks both backends and links to
everything else. Then work through [`docs/requests.http`](docs/requests.http),
which exercises every endpoint in the stack.

---

## The one diagram worth internalising

```
                     ┌──────────────────────────────┐
   browser  ────────▶│   Astro 7      :4321         │
                     │   ─────────────────────      │
                     │   • server-rendered pages    │
                     │   • Actions   (posts)        │
                     │   • /api/**   (reviews)      │
                     │                              │
                     │   holds BOTH sets of         │
                     │   credentials, ships NEITHER │
                     └───────┬──────────────┬───────┘
                             │              │
            Authorization:   │              │  x-publishable-api-key
            users API-Key    │              │  Authorization: Bearer <JWT>
                             ▼              ▼
             ┌───────────────────┐   ┌───────────────────┐
             │  Payload   :3000  │   │  Medusa    :9000  │
             │  ───────────────  │   │  ───────────────  │
             │  collections      │   │  modules          │
             │  → REST + GraphQL │   │  → links          │
             │  → admin UI       │   │  → workflows      │
             │  → SQL schema     │   │  → api routes     │
             │  → TS types       │   │  → admin widgets  │
             └─────────┬─────────┘   └─────────┬─────────┘
                       │                       │
                  payload_crud            medusa_crud
                       └───────── ✗ ──────────┘
                        no shared tables, ever
```

**Two databases, deliberately.** Payload and Medusa each own their own schema and
migration history and cannot read each other's tables. Every piece of integration
happens over HTTP, in the Astro layer — which means there is exactly one place to
look when data from both appears on one page.

---

## The comparison this repo exists for

### How do you add a field?

This single question exposes the whole trade-off.

**Payload** — one line, one file:

```ts
// apps/cms/src/collections/Posts.ts
{ name: 'readingTime', type: 'number' }
```

Done. In dev, `push` diffs the config against Postgres and applies the change.
The REST API accepts it, the admin UI renders an input for it, GraphQL exposes
it, and `payload-types.ts` picks it up on the next `generate:types`.

**Medusa** — six touch points:

```
1. src/modules/review/models/review.ts    add the column to the DML model
2. npm run db:generate                    write a migration file
3. npm run db:migrate                     apply it
4. src/api/**/validators.ts               extend the zod schema
5. src/workflows/steps/*.ts               thread it through the step
6. src/api/**/route.ts                    include it in the response
```

Neither is "better". They optimise for different things:

- Payload assumes **content shape changes often** and that generated CRUD is
  what you want. It is astonishingly fast, and you give up control over the
  edges.
- Medusa assumes it is handling **money and inventory**, where every mutation
  should be explicit, validated, named, and reversible. Six steps is the price of
  a rollback story.

Reach for the wrong one and you will feel it: hand-writing six layers for a blog,
or discovering that your order-fulfilment endpoint has no compensation path.

### Where the behaviour lives

| | Payload | Medusa |
|---|---|---|
| Schema | `fields` in the collection config | `model.define` + generated migration |
| Business logic | `hooks` (`beforeChange`, `afterChange`…) | module service + workflow steps |
| Authorisation | `access` functions, per operation | the route tree (`/store/*` vs `/admin/*`) |
| Validation | field config (`required`, `min`, `max`) | zod schemas wired in `middlewares.ts` |
| Cross-entity reads | `relationship` field + `?depth=` | `defineLink` + `query.graph` |
| Rollback | none (single write) | step compensation functions |
| Update verb | `PATCH` | `POST` |
| Config file size | **86 lines — it *is* the app** | **50 lines — it just lists modules** |

That last row is the tell. Payload's config *is* the application. Medusa's config
barely does anything, because behaviour is discovered by convention from the
filesystem.

---

## Request traces

Read these next to the files they name. They are the fastest way to understand
each stack.

### Creating a post — Payload, through an Astro Action

```
browser  POST /posts/new?_action=post.create   (a plain HTML form)
   │
   ├─▶ src/actions/index.ts
   │     zod parses FormData → coerces, applies defaults, normalises '' to null
   │     on failure: re-render the page with per-field errors, no redirect
   │
   ├─▶ src/lib/payload.ts
   │     adds  Authorization: users API-Key <key>
   │     converts the textarea into a Lexical node tree
   │
   ├─▶ POST http://localhost:3000/api/posts        ← generated, no handler written
   │     access.create   → is there a user?
   │     beforeValidate  → slug derived from title (field-level hook)
   │     beforeChange    → stamp publishedAt if going live
   │     Drizzle INSERT  → payload_crud
   │     afterChange     → logs in the CMS terminal
   │
   └─▶ 302 /posts?created=<id>
```

**Four files, one of which is generated.** No route file, no controller, no
migration.

### Creating a review — Medusa, through Astro's own endpoint

```
browser  POST /api/reviews   (fetch, or a plain form — the endpoint takes both)
   │
   ├─▶ src/pages/api/reviews/index.ts
   │     zod validates; 422 with field-level detail on failure
   │
   ├─▶ src/lib/medusa.ts
   │     sdk.client.fetch adds  x-publishable-api-key
   │     ↑ required on EVERY /store/* route, custom ones included
   │
   ├─▶ POST http://localhost:9000/store/reviews
   │     │
   │     ├─ src/api/middlewares.ts
   │     │    validateAndTransformBody(StoreCreateReviewSchema)
   │     │    .strict() → rejects `status`, so nobody self-publishes
   │     │    → req.validatedBody
   │     │
   │     ├─ src/api/store/reviews/route.ts
   │     │    forces status: 'pending', runs the workflow
   │     │
   │     └─ src/workflows/create-review.ts
   │          step 1  validateProductStep     read-only → no compensation
   │          step 2  createReviewStep        INSERT  ⟲ compensation: hard delete
   │          step 3  linkReviewToProductStep LINK    ⟲ compensation: dismiss
   │
   └─▶ 201 { review, message }
```

**Nine files.** In exchange: if step 3 fails, step 2 is undone and the database
is byte-for-byte as it was.

---

## Prove the rollback

This is the payoff for Medusa's extra layers, and it takes thirty seconds.

```bash
# 1. count what is there
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select count(*) from review;' \
  -c 'select count(*) from product_product_review_review;'
```

Set `DEMO_FAIL_LINK_STEP=1` in `apps/commerce/.env`, restart Medusa, then submit
a review from http://localhost:4321/reviews.

Step 3 throws on purpose. Re-run the counts: **both are unchanged.** No orphan
review, no orphan link — and the failed row does not exist even as a soft delete,
because create's compensation is a hard delete.

Now imagine that endpoint without a workflow: two sequential writes with no
transaction between them, and a failure in the middle leaves a review attached to
nothing. That is what the ceremony buys.

Set the flag back to `0` when you are done.

---

## The two frontend patterns

Both are implemented, on purpose, so you can compare them in the same codebase.

### Pattern A — Astro Actions (posts)

`src/actions/index.ts`

```ts
create: defineAction({
  accept: 'form',
  input: z.object({ title: z.string().min(3), ... }),
  handler: async (input) => createPost(input),
})
```

- Typed end to end; the page calls `actions.post.create` with no string URLs
- zod gives **per-field** errors via `isInputError(error)`
- **Works with JavaScript disabled** — in the production build the `/posts` pages
  ship **0** `<script>` tags. (`npm run build && node dist/server/entry.mjs` to
  confirm; the dev server adds Vite's HMR client, so count it there and you get 2.)
- Callable only from this app

### Pattern B — your own REST endpoints (reviews)

`src/pages/api/reviews/index.ts`

```ts
export const GET: APIRoute = async ({ url }) => { ... return Response.json(...) }
export const POST: APIRoute = async ({ request }) => { ... }
```

- A **real HTTP surface** — curl, a mobile app, another service can all call it
- Can compose: `?include_pending=true` merges Medusa's store and admin surfaces
  into one response that no single Medusa route offers
- You write the parsing, status codes and error envelope yourself
- No progressive enhancement: the `/reviews` page needs **1** client script,
  because HTML forms cannot issue `PATCH` or `DELETE`

**The rule of thumb:** if only your own pages call it, use an Action. If anything
else might, write the endpoint.

### Why both hide their credentials

Every page is `output: 'server'`, so the keys read from `import.meta.env` never
reach the browser. A visitor calling `/api/reviews` sends **no credential at
all** — Astro adds Medusa's publishable key server-side. That is the BFF pattern's
main structural benefit, and it is why none of the env vars here are prefixed
`PUBLIC_`.

---

## Gotchas that cost real time

Every one of these was hit while building this repo.

| Symptom | Cause |
|---|---|
| `400 Publishable API key required` | Medusa needs `x-publishable-api-key` on **every** `/store/*` route, including your own custom ones. `npm run bootstrap` prints it. |
| Medusa returns products but the list is empty | The publishable key exists but is not linked to a sales channel. It authenticates, then scopes you to nothing. |
| Payload writes 403 with a valid key | The header is `Authorization: users API-Key <key>`. The `users ` collection-slug prefix is mandatory; `Bearer` does not work. |
| `missing secret key` when Payload starts | `secret` is absent from `buildConfig`. Also: `payload run` does **not** load `.env`, and it evaluates the config *before* your script runs — so `dotenv` inside the script is too late. Use `dotenv -e .env -- payload run …`. |
| Payload config silently ignores the DB | The key is `db`, not `database`. |
| `output: 'hybrid'` is invalid | Removed in Astro 5. Astro 7 has only `'static'` and `'server'`. |
| Payload will not run standalone | Payload 3 **requires** Next.js. It mounts into an app's `(payload)` route group. |
| Astro Action rejects an omitted optional field | An absent form field arrives as `null`, and `.optional()` accepts only `undefined`. Use `.nullish()`. |
| `403 Cross-site DELETE form submissions are forbidden` | Astro's CSRF check needs an `Origin` header on `DELETE` (and on Action form POSTs). Browsers send it; curl does not. |
| `curl: bad range in URL position` | curl globs `[` `]`. Pass `-g`. Affects every Payload `where[...]` query. |
| Medusa CLI dies with `swc compiler requires @swc/core` | `@swc/core` is not optional — the CLI transpiles TypeScript through ts-node + swc. |
| `Cannot read properties of undefined (reading 'status')` reading linked reviews | A soft-deleted review keeps its link row, so `query.graph` returns a **hole** in the array. Filter nullish entries. See `apps/commerce/src/api/store/products/[id]/reviews/route.ts`. |
| Two incompatible `ZodType` errors | Import zod from `@medusajs/framework/zod` inside Medusa and from `astro/zod` inside Astro. Never mix copies. |

---

## Layout

```
astro-payload-medusa/
├── infra/                     Postgres 17 on :5433 (avoids the host's 5432)
├── scripts/setup.sh           idempotent one-shot setup
├── docs/
│   ├── learn/                 the beginner-to-expert course (start here)
│   ├── from-wordpress/        the same stack, mapped onto WordPress
│   ├── how-to/                recipes: the exact steps for one specific task
│   ├── architecture.md        deeper dives into each framework's model
│   ├── rest-api.md            every endpoint in the stack, one table
│   └── requests.http          runnable requests for all of it
├── postman/                   importable collection + environment (49 requests)
└── apps/
    ├── cms/                   Payload 3 + Next 16       :3000
    │   └── src/scripts/       seed.ts · guides.ts (32 guides) · placeholders.ts
    ├── commerce/              Medusa 2                  :9000
    │   └── src/scripts/       seed.ts · catalogue.ts (15 products) · seed-reviews.ts
    └── storefront/            Astro 7 (node standalone) :4321
        └── public/products/   generated product images, served to Medusa
```

Three **independent** npm projects, not a workspace. Medusa builds into its own
`.medusa` directory and is unreliable under hoisted `node_modules`; Payload+Next
and Astro each want their own resolution. The root `package.json` only
orchestrates, via `concurrently`.

### Files worth reading, in order

**Medusa** — the steepest curve, so follow the layers:

1. `apps/commerce/src/modules/review/models/review.ts` — the DML model
2. `apps/commerce/src/modules/review/service.ts` — CRUD generated from it
3. `apps/commerce/src/links/product-review.ts` — **the key idea**: modules are
   isolated, links join them
4. `apps/commerce/src/workflows/steps/` — compensation, one file per verb
5. `apps/commerce/src/api/middlewares.ts` — validation, wired centrally
6. `apps/commerce/src/api/store/products/[id]/reviews/route.ts` — `query.graph`
   reading across the link
7. `apps/commerce/src/admin/widgets/product-reviews.tsx` — React injected into
   the dashboard

**Payload** — read the config and you have read the app:

1. `apps/cms/src/collections/Posts.ts` — access, fields, hooks, drafts, endpoints
2. `apps/cms/src/payload.config.ts` — compare its size with `medusa-config.ts`
3. `apps/cms/src/endpoints/postStats.ts` — the Local API, for what CRUD cannot do

**Astro** — the two patterns, side by side:

1. `apps/storefront/src/actions/index.ts` — Pattern A
2. `apps/storefront/src/pages/api/reviews/index.ts` — Pattern B
3. `apps/storefront/src/lib/` — where both backends' quirks get normalised

---

## Commands

```bash
npm run dev              # all three, colour-coded
npm run dev:cms          # just one
npm run setup            # idempotent full setup
npm run typecheck        # tsc + astro check across all three

npm run db:up            # Postgres + Redis
npm run db:psql          # a shell in it
npm run db:reset         # destroy the volume and start clean

npm run db:export        # dump both databases + media + a manifest
npm run db:import        # restore the newest backup (verifies, then confirms)

npm run logs             # tail all three services
npm run logs:errors      # just the warnings and errors

npm test                 # 20 unit tests + the compensation test
npm run postman:test     # 49 requests, 104 assertions, via newman
npm run postman:env      # regenerate Postman's env after a reset or restore
```

Operational state is also visible in the browser at
[/monitor](http://localhost:4321/monitor) — uptime, request classes, workflow
states, log levels and backup age. See
[docs/learn/12-operating-it.md](docs/learn/12-operating-it.md).

Per app:

```bash
npm --prefix apps/cms run seed              # content + print the API key
npm --prefix apps/cms run generate:types    # after any field change

npm --prefix apps/commerce run db:generate  # migration for the review module
npm --prefix apps/commerce run db:migrate   # apply it, and sync link tables
npm --prefix apps/commerce run seed         # products, regions, sales channel
npm --prefix apps/commerce run seed:reviews # reviews, via the workflow
npm --prefix apps/commerce run bootstrap    # print the publishable key
```

---

## Deploying

Three services, two databases and one reverse proxy on a single VPS —
[`docs/learn/13-deploying-it.md`](docs/learn/13-deploying-it.md) has the whole
sequence, sized from measured numbers rather than estimates:

| | Measured |
|---|---|
| Runtime, all three services | **834 MB** |
| Build peak (Payload/Next, the binding constraint) | **2.34 GB** |

⚠️ **Buy 4 GB, not 2.** 2 GB runs the stack and then fails on the first build —
which is exactly why shared hosting that looks adequate is not.

---

## Branches and contributing

Three tiers, and work only ever enters at the bottom.

| Branch | Role | Who merges into it |
|---|---|---|
| `main` | **live** — deployed, always releasable | `development`, via a reviewed PR |
| `development` | **staging** — integration and QA | `feature/*`, `bugfix/*`, `update/*` |
| `feature/*` · `bugfix/*` · `update/*` | the working branches | you, locally |

**Never commit to `main` or `development` directly.** Branch from `development`,
open the PR back into `development`, and promote to `main` only once staging is
green.

```bash
git checkout development && git pull
git checkout -b feature/short-description
```

Naming: `feature/` for new capability, `bugfix/` for a defect, `update/` for
dependency bumps, content and documentation. Keep the suffix short and
hyphenated — `feature/stripe-payment-provider`, not `feature/new-stuff`.

### Before you open a PR

The repo checks itself; run all of it:

```bash
npm run typecheck && npm test && npm run postman:test
```

Expect **0 type errors**, **20 unit tests + the compensation test**, and
**49 requests / 104 assertions / 0 failures** from newman.

⚠️ **Leave 60 seconds between newman runs.** Three runs inside a minute exhaust
the storefront's 120-per-60s rate limiter and produce failures that are not real.

⚠️ **Never commit a `.env`.** All three are gitignored, and `npm run setup`
regenerates both API keys — they live in the databases, so a `db:reset`
invalidates whatever you had.

### If you change seed content

Re-run the seed and then re-check the documentation, because several chapters
quote real row counts and real output:

```bash
npm run reset:all && npm run db:export
```

---

## Versions

Node 22.22 · Astro 7.2.4 · Payload 3.88.0 (Next 16.3) · Medusa 2.19.0 ·
Postgres 17
