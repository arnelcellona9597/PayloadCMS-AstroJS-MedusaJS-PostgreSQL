# Architecture notes

Deeper dives into each framework's model. Read [`../README.md`](../README.md)
first for the comparison and the request traces; this file explains *why* each
framework is shaped the way it is.

---

## 1. Medusa 2 — module isolation is the whole design

Everything strange about Medusa v2 follows from one commitment: **a module knows
nothing about any other module.**

The review module has no `product_id` column. It cannot import the product
module. It has its own schema, its own migrations, and could in principle be
deployed as its own service. That constraint is what buys you the ability to
swap Medusa's built-in payment or inventory module for your own without forking
anything — and it is also why the framework needs four mechanisms that would
otherwise be unnecessary.

### 1.1 The DML, not an ORM

```ts
const Review = model.define("review", {
  id: model.id().primaryKey(),
  rating: model.number(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
})
```

`model.define` is a *description*. Medusa derives the MikroORM entity, the
Postgres DDL and the migration from it. You never write SQL and you never write
an entity class.

Free on every model: `created_at`, `updated_at`, `deleted_at`.

That third column is load-bearing. Every generated delete is a **soft** delete,
and soft deletes are what make workflow compensation cheap — rolling back a
delete is one `restoreReviews` call rather than a re-insert that has to
reconstruct the row and hope nothing referenced the old id.

### 1.2 The service is generated, then extended

```ts
class ReviewModuleService extends MedusaService({ Review }) {}
```

That gives you `createReviews`, `listReviews`, `listAndCountReviews`,
`retrieveReview`, `updateReviews`, `deleteReviews`, `softDeleteReviews`,
`restoreReviews`.

Note the pluralisation — `retrieveReview` (singular) but `createReviews`
(plural). It catches everyone once.

It is a **base class**, not a black box. `getRatingStats` in
`apps/commerce/src/modules/review/service.ts` sits alongside the generated
methods, and takes *review ids* rather than a product id — because this module is
not allowed to know products exist. The caller resolves product → reviews first.
Keeping the dependency pointing that way is what keeps the module isolated.

### 1.3 Links: the third table

```ts
defineLink(
  ProductModule.linkable.product,
  { linkable: ReviewModule.linkable.review, isList: true }
)
```

This creates `product_product_review_review`, holding nothing but two ids.

Consequences:

- **Neither module gains a dependency.** Delete `src/links/` and both modules
  still compile and run — you just lose the association.
- **You cannot JOIN across the boundary**, and should not try. The two models
  live in different module schemas.
- **Writes go through the Link service**, not through either module service:
  `link.create({ [Modules.PRODUCT]: {...}, [REVIEW_MODULE]: {...} })`.
- `link.dismiss()` removes the association; `link.delete()` cascades into the
  records. For undoing an association you always want `dismiss`.

`isList: true` sits on the review side: one product, many reviews.

Run `npm run db:migrate` after adding a link — link tables are created by the
migrate step, not by `db:generate`.

### 1.4 Query: the read side

```ts
query.graph({
  entity: "product",
  fields: ["id", "title", "reviews.rating", "reviews.status"],
  filters: { id: productId },
})
```

`reviews.*` crosses a module boundary. Query reads the link table, fetches from
each module, and stitches the result.

Two things this does **not** do, both of which have bitten this codebase:

**It does not carry the other module's policy.** Query returns every linked
review regardless of `status`. Filtering to approved is the *route's* job. You get
data, not business rules.

**It can return holes.** A soft-deleted review keeps its link row (deliberately —
see §1.5), so the link resolves to a review that generated queries no longer
return. `product.reviews` then contains `undefined` entries, and the array is
only ragged *after someone deletes a review* — precisely the bug that survives a
happy-path test. See the comment in
`apps/commerce/src/api/store/products/[id]/reviews/route.ts`.

And prefer an explicit field list to `reviews.*` on a public route: `*` returns
every column the model happens to have, including `author_email` and anything
added later.

### 1.5 Workflows and compensation

```
createReviewWorkflow
  ├─ validateProductStep       read-only  → no compensation needed
  ├─ createReviewStep          INSERT     ⟲ hard delete
  └─ linkReviewToProductStep   LINK       ⟲ dismiss
```

`new StepResponse(output, compensateInput)` has two arguments because they serve
different purposes:

- `output` is what later steps and the caller see
- `compensateInput` is what *this* step's rollback receives if a *later* step
  fails

They differ more than you would expect. Create only needs the id back. **Update
needs the previous values**, which the step must read *before* writing — see
`steps/update-review.ts`. Undoing an update is strictly harder than undoing an
insert, and that asymmetry is the most useful thing in the workflow directory.

`deleteReviewStep` soft-deletes and deliberately **leaves the link row**, so a
restore reattaches the review to its product. That symmetry is what produces the
holes described in §1.4. It is a real trade-off, not an oversight: symmetric
restore, at the cost of a read-side filter.

Guard every compensation with `if (!input) return` — compensation can fire with
`undefined` when the step itself was the one that failed.

**A workflow body is not imperative code.** It runs once at startup to build a
graph. Step results are proxies:

```ts
review.id                             // ✓ property access is recorded
if (review.rating > 3) { … }          // ✗ branching on a proxy does nothing
review.title.toUpperCase()            // ✗ no string here to call methods on
```

For real computation on step output you need `transform()` from the SDK.

### 1.6 Two route trees, not one route with a role check

```
/store/*   x-publishable-api-key   public, sales-channel scoped
/admin/*   Authorization: Bearer   authenticated admin, sees everything
```

You do not write that auth check — it comes from the path. Which is why the same
entity has two directories with different read rules, different zod schemas, and
different response shapes:

|  | `/store/reviews` | `/admin/reviews` |
|---|---|---|
| Statuses returned | `approved` only | all |
| `author_email` | omitted via `select` | included |
| May set `status` | no — `.strict()` rejects the field | yes |
| Filter by status | no | yes |

Compare with Payload (§2.2), which puts one endpoint set on a collection and
expresses the same difference through access-control *functions*. Same
requirement, opposite mechanism.

### 1.7 The publishable API key

Not a secret in the password sense — it identifies a **sales channel** so Medusa
can scope what the caller may see. Safe to ship to a browser, and useless for
reaching `/admin/*`.

Two failure modes:

- **Missing** → `400 Publishable API key required in the request header`.
  Required on custom `/store/*` routes too, which is the single most common wall.
- **Present but not linked to a sales channel** → authenticates fine, then scopes
  you to nothing. Product lists come back empty and it reads like a query bug.

`npm run bootstrap` in `apps/commerce` handles both and prints the key. Notice
that the key ↔ sales-channel attachment is *itself* a module link — Medusa uses
the same mechanism internally.

---

## 2. Payload 3 — the config is the application

### 2.1 What one collection buys

Adding a file to `collections` generates:

```
GET    /api/posts          list, with where/sort/limit/page/depth/select
POST   /api/posts          create
GET    /api/posts/:id      read
PATCH  /api/posts/:id      update
DELETE /api/posts/:id      delete
GET    /api/posts/count    count
```

…plus a GraphQL schema, a full admin CRUD screen, the Postgres schema (via
Drizzle), and TypeScript types in `payload-types.ts`.

Zero controller code. Compare `apps/commerce/src/api/**`, where each of those
verbs is a file you wrote.

Payload 3 **requires Next.js** — it mounts into an app's `(payload)` route group.
It is not a standalone server. In this repo the Next app exists only to host
Payload; the public frontend is Astro.

### 2.2 Access control is functions, not a role matrix

```ts
access: {
  read: ({ req }) => {
    if (req.user) return true
    return { _status: { equals: 'published' } }   // ← a query, not a boolean
  },
  create: ({ req }) => Boolean(req.user),
  delete: ({ req }) => req.user?.role === 'admin',
}
```

The important subtlety: returning a **`Where` query** filters the result set
instead of rejecting the request. That is how the same `GET /api/posts` returns 3
documents anonymously and 4 with an API key — the draft is not forbidden, it is
*invisible*.

Verify it:

```bash
curl -s 'http://localhost:3000/api/posts?limit=10' | grep -c '"id"'
curl -s 'http://localhost:3000/api/posts?limit=10' \
  -H 'Authorization: users API-Key <key>' | grep -c '"id"'
```

### 2.3 Hooks

Two levels, and picking the right one matters:

- **Field hooks** — smallest unit. The slug computes itself from `title` in a
  field-level `beforeValidate`, so the collection never has to know about it.
- **Collection hooks** — `beforeChange` can rewrite the document (it returns what
  gets saved); `afterChange` runs post-commit and is the seam where a real
  deployment would invalidate downstream caches.

The `afterChange` hook in `Posts.ts` logs. Watch the `[cms]` lines in
`npm run dev` while creating a post from the storefront — the lifecycle becomes
concrete.

### 2.4 Local API vs REST

`apps/cms/src/endpoints/postStats.ts` is the one hand-written route in the CMS,
and it exists because generated CRUD is excellent at "documents matching a query"
and useless at aggregates.

It uses the **Local API** — `req.payload.count(...)`, `req.payload.find(...)` —
which runs in-process: no HTTP hop, no re-authentication, but the *same query
language* as REST. One mental model, two transports.

One catch: Local API calls **bypass access control by default**, because they are
trusted server code. `postStats` passes `overrideAccess: false` and the incoming
`user`, so it respects the same rules as REST — which is why an anonymous caller
sees `drafts: 0`.

### 2.5 Rich text is a tree

```json
{ "root": { "children": [
  { "type": "paragraph", "children": [ { "type": "text", "text": "hi" } ] } ] } }
```

Not HTML, not Markdown. Structured content can render to HTML, React, plain
text, or a native app's own components — the cost is that consumers walk the
tree.

`apps/storefront/src/lib/lexical.ts` is a dependency-free renderer. Two things
worth noting: text formatting is a **bitmask** on each text node (not nested
tags), and unknown node types recurse into their children rather than dropping
the subtree, so a block type this renderer has never heard of still shows its
text.

### 2.6 Drafts

`versions: { drafts: true }` adds `_status` and a version table. Reads default to
published; `?draft=true` (authenticated) gets the latest draft. A create or
update can publish in one call by setting `_status` explicitly — but writing a
*draft* through the Local API needs `draft: true` on the call, or the version
machinery records it as published.

### 2.7 Schema management

In dev, `push` diffs the config against the database and applies changes — which
is why adding a field needs no migration command. For production, set
`push: false` and use `payload migrate:create` / `payload migrate`.

The trade-off against Medusa's always-explicit migrations is exactly the
speed-versus-control axis in the README's "how do you add a field?" table.

---

## 3. Astro 7 — the BFF layer

### 3.1 `output: 'server'`

Astro 7 accepts only `'static'` and `'server'`. `'hybrid'` was removed in Astro 5
(its behaviour is now `'static'` plus an adapter).

Everything here reads live data, so `'server'` is the right default; individual
pages can still opt out with `export const prerender = true`.

The structural benefit: because rendering happens on the server, `PAYLOAD_API_KEY`
and `MEDUSA_PUBLISHABLE_KEY` never reach the browser. Astro only exposes
`PUBLIC_`-prefixed vars to client code, so the absence of that prefix is what
enforces it. A visitor calling `/api/reviews` sends **no credential at all**.

### 3.2 Actions vs endpoints

Both patterns are implemented. The honest summary:

| | Actions (`src/actions/`) | Endpoints (`src/pages/api/`) |
|---|---|---|
| Callable by | this app only | anything that speaks HTTP |
| Validation | `input:` schema, field-level errors free | you call `safeParse` and shape the response |
| Works without JS | **yes** | no |
| Verbs | form POST only (HTML's limit) | any, including PATCH and DELETE |
| Client JS on the page | 0 script tags | 1, for PATCH/DELETE |
| Composition | one handler | can merge several upstream calls |

Rule of thumb: if only your own pages call it, use an Action. If anything else
might, write the endpoint.

### 3.3 Three form-parsing gotchas

With `accept: 'form'`:

1. **Every value is a string.** `z.coerce` or an explicit transform for numbers.
2. **An absent field is `null`, not `undefined`.** `z.string().optional()` accepts
   `undefined` and *rejects* `null`, so an omitted optional field fails with
   "expected string, received null". Use `.nullish()`. A browser form usually
   submits every field, so you may only discover this from a `fetch` or curl call
   that omits one. `.default()` has the same problem — it fires only for
   `undefined`.
3. **An empty field is `''`, not null.** Passing that through stores an empty
   string where the caller meant "no value", so normalise `''` → `null`.

### 3.4 CSRF

Astro rejects `DELETE` to `/api/**` without a matching `Origin` header:
`403 Cross-site DELETE form submissions are forbidden`. Action form POSTs need it
too.

Browsers send `Origin` automatically, so the UI is unaffected — but curl does
not, which is why `docs/requests.http` sets it explicitly on those requests.
`POST` and `PATCH` with `Content-Type: application/json` are exempt, because that
content type cannot be produced by a cross-site HTML form.

### 3.5 The normalisation the clients do

`src/lib/payload.ts` and `src/lib/medusa*.ts` exist to keep two inconsistencies
out of the pages:

- **Update verbs differ.** Payload uses `PATCH`; Medusa's admin API uses `POST`.
  Pages call `updatePost(...)` / `updateReview(...)` and never learn which.
- **Auth differs.** `Authorization: users API-Key <key>` for Payload;
  `x-publishable-api-key` plus a cached admin JWT for Medusa.

`src/lib/types.ts` hand-declares the shapes rather than importing Payload's
generated `payload-types.ts` or Medusa's `.medusa/types`. That keeps the three
apps independently buildable, at the cost of possible drift — `astro check` is
the only thing that would catch it. In a monorepo you would extract a shared
package; kept local here so each app reads on its own.

### 3.6 The N+1 on `/products`

One request lists products, then one per product fetches its rating. That is the
honest cost of module isolation: reviews live in their own module, so "products
with ratings" is not a single query.

The fix is a purpose-built route that resolves many products' reviews in one
`query.graph` call. It is left un-fixed and labelled on the page, because the
trade-off is the lesson — you accept this shape at any service boundary, and the
answer is always a route designed for the read you actually need.

---

## 4. Things this project deliberately does not do

Worth knowing, so the omissions do not read as accidents:

- **No shared types package.** Each app declares what it consumes (§3.5).
- **No auth for storefront visitors.** Anyone can edit anything. Real access
  control would live in Astro middleware; the CRUD screens are the subject here.
- **No Redis.** Medusa falls back to in-memory event bus and locking with a
  warning. Fine for local; not for production.
- **No file uploads from the storefront.** The `Media` collection works in the
  CMS admin; the storefront only reads it.
- **No cache invalidation.** `Posts.afterChange` logs where a revalidation call
  would go.
- **Plain-text round-trip for rich text.** The storefront's post editor uses a
  textarea, so formatting added in the CMS survives editing there only as plain
  text. A real editor would render Lexical properly.
