# 4 · Medusa — modules, links and workflows

> Reference counterpart: [`../architecture.md`](../architecture.md) §1.
> Endpoint tables: [`../rest-api.md`](../rest-api.md) §Medusa.

This is the hard chapter. Budget several hours and expect to reread it.

**Read this first, because everything else follows from it:**

> A Medusa module knows *nothing* about any other module. No imports, no foreign
> keys, no JOINs.

That single constraint is why Medusa needs four mechanisms Payload doesn't:
**links** to associate data, **Query** to read across them, **the container** to
find services, and **workflows** to make multi-module writes reversible.

If Medusa feels like too much ceremony, you have not yet felt the problem it is
solving. Hold the frustration until §4.6.

---

## 4.1 Why isolation

Payload's model — one config, one database, relationships everywhere — is
excellent for content. Medusa handles money, inventory and orders, where the
requirements differ:

- You must **swap implementations**: your own payment provider, your own tax
  logic, an external inventory system. That's only safe if nothing imports them
  directly.
- Modules must be **independently deployable and migratable**.
- Writes span concerns (charge a card *and* reserve stock *and* create an order)
  and must be **reversible** when step three fails.

So: hard boundaries between modules. Everything awkward about Medusa is the cost
of those boundaries — and everything powerful about it is the benefit.

---

## 4.2 The anatomy of a module

Our `review` module lives in
[`apps/commerce/src/modules/review/`](../../apps/commerce/src/modules/review/):

```
models/review.ts   the data model  (shape)
service.ts         the service     (behaviour)
index.ts           the export      (registration)
migrations/        generated SQL
```

### The model — a description, not an entity

```ts
// models/review.ts
const Review = model.define("review", {
  id: model.id().primaryKey(),
  title: model.text(),
  rating: model.number(),
  status: model.enum(["pending", "approved", "rejected"]).default("pending"),
})
```

`model.define` is Medusa's **DML** (data modelling language). Medusa derives the
MikroORM entity, the Postgres table, and the migration from it. You never write
SQL or an entity class.

Three things you get free on every model: `created_at`, `updated_at`,
**`deleted_at`**.

That last one is load-bearing. Deletes are **soft** by default, which is what
makes rollback cheap (§4.6).

**Notice what is absent: there is no `product_id`.** The module cannot reference
products. Verify it twice — in the source, and in the database:

```bash
grep -n "product" apps/commerce/src/modules/review/models/review.ts
```

Two hits, both in comments explaining the absence — no code mentions products.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review' | grep -i foreign
```

No output: the table has no foreign key at all.

### The service — generated, then extended

```ts
class ReviewModuleService extends MedusaService({ Review }) {}
```

That one line generates:

| Method | Does |
|---|---|
| `createReviews(data)` | insert (accepts one or many) |
| `listReviews(filters, config)` | query |
| `listAndCountReviews(…)` | query + total, for pagination |
| `retrieveReview(id)` | one, **throws** if missing |
| `updateReviews(data)` | update |
| `deleteReviews(id)` | **hard** delete |
| `softDeleteReviews(id)` | sets `deleted_at` |
| `restoreReviews(id)` | clears `deleted_at` |

⚠️ **The pluralisation catches everyone.** `retrieveReview` (singular) but
`createReviews` (plural). The rule: single-record methods are singular, the rest
are plural.

It's a **base class**, not a sealed box.
[`service.ts`](../../apps/commerce/src/modules/review/service.ts) adds
`getRatingStats`, which takes *review ids* — never a product id, because this
module isn't allowed to know products exist. The caller resolves product → reviews
first. **Keeping the dependency pointing that way is the discipline.**

### The export

```ts
export const REVIEW_MODULE = "review"
export default Module(REVIEW_MODULE, { service: ReviewModuleService })
```

`REVIEW_MODULE` is the key in Medusa's DI container. Everywhere you need the
service:

```ts
const reviewService = req.scope.resolve(REVIEW_MODULE)
```

Importing the class directly would work in TypeScript and defeat the purpose.

Registered in [`medusa-config.ts`](../../apps/commerce/medusa-config.ts):

```ts
modules: [{ resolve: './src/modules/review' }]
```

⚠️ Editing `medusa-config.ts` requires a **restart** — it isn't hot-reloaded.

---

## 4.3 Changing a model: the six steps

The contrast with Payload's one-line change, in full:

```
1. edit src/modules/review/models/review.ts    the model
2. npm run db:generate                         write a migration
3. npm run db:migrate                          apply it
4. edit src/api/**/validators.ts               let zod accept the field
5. edit src/workflows/steps/*.ts               thread it through
6. edit src/api/**/route.ts                    return it
```

Steps 1–3 are mandatory. **Editing the model alone changes TypeScript but not
Postgres** — your code compiles and then fails on a missing column. Look at the
migration Medusa wrote for the existing model:

```bash
cat apps/commerce/src/modules/review/migrations/*.ts
```

`up()` and `down()`, plain SQL, committed to git. That file is the thing Payload's
`push` never creates — and the reason Medusa can roll a schema change back.

Lab 2 in [06-labs.md](06-labs.md) walks the whole cycle.

---

## 4.4 Links — associating without coupling

The review module can't reference products. So how does a review belong to one?

[`src/links/product-review.ts`](../../apps/commerce/src/links/product-review.ts):

```ts
export default defineLink(
  ProductModule.linkable.product,
  { linkable: ReviewModule.linkable.review, isList: true }
)
```

This creates a **third table** holding just the two ids:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select product_id, review_id from product_product_review_review limit 3;'
```

`isList: true` sits on the review side: one product, many reviews.

What this buys:

- **Neither module gains a dependency.** Delete `src/links/` and both still
  compile — you just lose the association.
- The link is **its own record**, with its own `deleted_at`, so it can be
  soft-deleted and restored like anything else.

Writes go through the **Link service**, not either module service:

```ts
const link = container.resolve(ContainerRegistrationKeys.LINK)
await link.create({
  [Modules.PRODUCT]: { product_id },
  [REVIEW_MODULE]:   { review_id },
})
```

⚠️ **`dismiss` vs `delete`:** `link.dismiss()` removes the association and leaves
both records. `link.delete()` cascades into them. To undo an association you
always want `dismiss`.

⚠️ **Links need `db:migrate`, not `db:generate`.** Link tables are created by the
migrate step. Adding a link file also requires a **restart**.

---

## 4.5 Query — reading across the boundary

You can't JOIN, so Medusa gives you **Query**:

```ts
const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
const { data } = await query.graph({
  entity: "product",
  fields: ["id", "title", "reviews.rating", "reviews.status"],
  filters: { id: productId },
})
```

`reviews.*` crosses into another module. Query reads the link table, fetches from
each module, and stitches the result. See it working:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" 'http://localhost:9000/store/products?limit=1' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')
curl -s -H "x-publishable-api-key: $PK" "http://localhost:9000/store/products/$PID/reviews" \
  | python3 -m json.tool | head -20
```

**Three things Query does not do.** Each has bitten this codebase:

**1. It doesn't carry the other module's rules.** Query returns *every* linked
review regardless of `status`. Filtering to approved is the route's job. You get
data, not policy.

**2. It can return holes.** A soft-deleted review keeps its link row (deliberately
— see §4.6), so the link resolves to a record generated queries no longer return.
`product.reviews` then contains `undefined` entries. The array only goes ragged
*after someone deletes a review*, which is exactly the bug that survives testing
the happy path. Hence:

```ts
const all = (product.reviews ?? []).filter(Boolean)
```

**3. `reviews.*` returns every column** — including `author_email`, and anything
added later. On a public route, **enumerate fields explicitly**. See
[`store/products/[id]/reviews/route.ts`](../../apps/commerce/src/api/store/products/%5Bid%5D/reviews/route.ts).

---

## 4.6 Workflows — the payoff

Here is the problem. Creating a review is two writes:

```
1. INSERT into review
2. INSERT into the link table
```

If step 2 fails, you have a review attached to nothing. They're in different
modules, so **a database transaction cannot span them.**

Medusa's answer: every step declares how to undo itself.

```ts
// src/workflows/create-review.ts
createWorkflow(CREATE_REVIEW_WORKFLOW, (input) => {
  validateProductStep({ product_id: input.product_id })   // read-only
  const review = createReviewStep({ … })                  // ⟲ hard delete
  linkReviewToProductStep({ review_id: review.id, … })    // ⟲ dismiss
  return new WorkflowResponse(review)
})
```

If step 3 throws, Medusa runs step 2's compensation. No orphan review, no orphan
link.

### StepResponse has two arguments

```ts
new StepResponse(output, compensateInput)
```

- `output` — what later steps and the caller see
- `compensateInput` — what *this step's* rollback receives if a **later** step
  fails

They differ more than you'd expect:

| Step | Output | Compensation input | Undo |
|---|---|---|---|
| create | the review | just the id | hard delete |
| **update** | the updated review | **the previous values** | write them back |
| delete | the id | the id | `restoreReviews` |

**Undoing an update is strictly harder than undoing an insert** — the step must
read the old values *before* writing. That asymmetry, in
[`steps/update-review.ts`](../../apps/commerce/src/workflows/steps/update-review.ts),
is the most instructive file in the directory.

⚠️ Guard every compensation with `if (!input) return` — it can fire with
`undefined` when the step itself was what failed.

### Not every step needs compensation

[`validate-product.ts`](../../apps/commerce/src/workflows/steps/validate-product.ts)
omits the third argument entirely: it only reads. And it runs **first**, so a bad
id costs nothing to reject.

### Watch it roll back

This is the moment Medusa clicks. Full version is Lab 6.

```bash
# before
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A \
  -c 'select count(*) from review;' \
  -c 'select count(*) from product_product_review_review;'
```

Set `DEMO_FAIL_LINK_STEP=1` in `apps/commerce/.env`, restart Medusa, POST a
review, then count again. **Both numbers are unchanged**, and the row does not
exist even as a soft delete — create's compensation is a hard delete.

Now picture that route without a workflow: two writes, no transaction, and a
failure between them leaves permanent garbage. *That* is what the ceremony buys.

### Workflow bodies are not imperative code

The function runs **once at startup** to build a graph. Step results are proxies:

```ts
review.id                        // ✓ property access is recorded
if (review.rating > 3) { … }     // ✗ branching on a proxy does nothing
review.title.toUpperCase()       // ✗ there is no string here
```

For real computation on step output, use `transform()` from the SDK.

---

## 4.7 Validation

Zod schemas live beside their routes and are wired centrally.

```ts
// src/api/store/reviews/validators.ts
import { z } from "@medusajs/framework/zod"   // ← NOT bare "zod"

export const StoreCreateReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  …
}).strict()
```

Three details:

- **Import from `@medusajs/framework/zod`.** Medusa pins its own copy; mixing
  gives you two incompatible `ZodType` identities and baffling type errors.
- **`z.coerce`** — query strings are always strings; `?limit=10` is `"10"`.
- **`.strict()`** rejects unknown fields. The store schema has no `status` field,
  so a public caller trying to self-publish is refused outright rather than
  silently ignored.

Wiring, in [`src/api/middlewares.ts`](../../apps/commerce/src/api/middlewares.ts):

```ts
{ matcher: "/store/reviews", method: "POST",
  middlewares: [validateAndTransformBody(StoreCreateReviewSchema)] }
```

Then the handler reads **`req.validatedBody`** — coerced and defaulted. `req.body`
is still raw and unchecked; never read it.

⚠️ `/admin/reviews` and `/admin/reviews/:id` need **separate entries**. The first
matcher does not cover the second.

### Middleware is not only for validation

`defineMiddlewares` takes any Express-style `(req, res, next)` function, so the
same mechanism carries rate limiting, logging, or anything cross-cutting. This
repo limits the whole public surface:

```ts
{ matcher: "/store/*", middlewares: [rateLimit(STORE_LIMIT)] }
```

Three things to notice in
[`src/api/rate-limit.ts`](../../apps/commerce/src/api/rate-limit.ts):

- **It is listed first.** Middlewares run in declaration order, and there is no
  point validating a body you are about to reject.
- **No `method`**, so it covers every verb on that path.
- **To reject, it writes to `res` and does NOT call `next()`.** Calling `next()`
  after responding runs the handler anyway and then fails trying to send twice.

Compare with Astro's equivalent in
[`05-astro.md`](05-astro.md#510-middleware--the-code-that-runs-first): identical
algorithm, opposite registration. Astro's `onRequest` wraps everything
automatically and is therefore easy to apply too broadly; Medusa's is explicit
per matcher and is therefore easy to forget on a route you add later.

`/admin/*` is deliberately **not** limited — those routes already require an
authenticated admin, and rate-limiting your own moderators out of the dashboard
during a busy moment is a self-inflicted outage.

Try it (the store limit is 240/min by default):

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
for i in $(seq 1 260); do
  curl -s -o /dev/null -w '%{http_code} ' -H "x-publishable-api-key: $PK" \
    http://localhost:9000/store/reviews
done
```

Note it keys on the **publishable API key** rather than the IP: every browser
behind one office NAT shares an IP, but they legitimately share a sales channel.

See all three refusals:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" 'http://localhost:9000/store/products?limit=1' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

# rating out of range + strings too short
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"no\",\"content\":\"short\",\"rating\":9,\"author_name\":\"T\"}"

# a field the schema does not allow
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"Self approve\",\"content\":\"Should be refused.\",\"rating\":5,\"author_name\":\"T\",\"status\":\"approved\"}"

# a product that does not exist — caught by workflow step 1
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"prod_nope","title":"Ghost","content":"No such product.","rating":4,"author_name":"T"}'
```

---

## 4.8 Routes: two trees, not one

File path = URL path. `route.ts` exports functions named after HTTP verbs;
`[id]` is a path parameter.

```
src/api/store/reviews/route.ts            → /store/reviews
src/api/store/reviews/[id]/route.ts       → /store/reviews/:id
src/api/admin/reviews/route.ts            → /admin/reviews
```

**The `store` / `admin` split is a real security boundary, not a naming
convention.** Medusa applies different middleware based on the path:

| | `/store/*` | `/admin/*` |
|---|---|---|
| Auth | `x-publishable-api-key` | logged-in admin (JWT or cookie) |
| Sees | approved reviews only | every status |
| `author_email` | stripped via `select` | included |
| May set `status` | no | yes |

**You write none of that auth check** — it comes from the path.

Contrast with Payload, which puts one endpoint set on a collection and expresses
the same difference through access-control *functions*. Same requirement, opposite
mechanism.

⚠️ **Updates are `POST`, not `PATCH`.** Medusa's admin convention throughout.
`PATCH` would work, but the admin SDK expects `POST`.

---

## 4.9 The publishable key

Every `/store/*` route needs it — **custom routes included**. This is the single
most common wall.

```bash
curl -s http://localhost:9000/store/reviews
```

> `400 Publishable API key required in the request header: x-publishable-api-key`

It identifies a **sales channel**, not a person. That's why it's safe in a browser
and useless for `/admin/*`.

⚠️ **A second failure mode is nastier:** a key that exists but isn't linked to a
sales channel authenticates fine, then scopes you to nothing — product lists come
back empty and it reads like a query bug.
[`bootstrap.ts`](../../apps/commerce/src/scripts/bootstrap.ts) handles both:

```bash
npm --prefix apps/commerce run bootstrap
```

Note it attaches the key with `link.create(...)` — the key ↔ sales-channel
relationship is itself a module link. Medusa uses this mechanism internally too.

---

## 4.10 Admin widgets

Medusa's dashboard is a React app that scans `src/admin/widgets/**` at build time.
A file becomes a widget by exporting a component and a config:

```ts
export const config = defineWidgetConfig({ zone: "product.details.after" })
```

You aren't forking the dashboard — your component is compiled into it, so
upgrading Medusa won't break it as long as the zone still exists.

See it: http://localhost:9000/app → Products → any product → scroll down. Approve
and Reject buttons calling `/admin/reviews/:id`.

Note there's no `Authorization` header in
[that component](../../apps/commerce/src/admin/widgets/product-reviews.tsx) — the
dashboard is a browser session, so the cookie rides along with
`credentials: "include"`. That's the mechanism the Astro storefront *can't* use,
which is why it logs in for a JWT instead.

---

## 4.11 Scripts

`medusa exec` boots the full container and hands it to your function — so
`container.resolve(...)` works exactly as in a route.

```bash
npm --prefix apps/commerce run seed          # products, regions, sales channel
npm --prefix apps/commerce run seed:reviews  # reviews, THROUGH the workflow
npm --prefix apps/commerce run bootstrap     # print the publishable key
npm --prefix apps/commerce run user -- -e a@b.c -p secret
```

⚠️ [`seed-reviews.ts`](../../apps/commerce/src/scripts/seed-reviews.ts) runs the
**workflow**, not `createReviews`. Calling the service directly would insert valid
rows linked to nothing, and every product page would show zero reviews.

---

## 4.12 Subscribers and jobs — the other two ways to run code

`src/subscribers/` and `src/jobs/` complete the picture. Both are **discovered by
convention** — nothing imports them, and that is why an empty directory means an
invisible feature.

You have now seen all five ways to execute code in Medusa:

| | Runs | Can fail the request? | Use for |
|---|---|---|---|
| Route handler | in the request | yes | reading, and starting workflows |
| Workflow step | orchestrated | yes, with rollback | anything that writes |
| Service method | called by the above | yes | business logic on one module |
| **Subscriber** | **after the response** | **no** | side effects |
| **Scheduled job** | on a cron | no | periodic work |

### Subscribers react to events

[`src/subscribers/review-created.ts`](../../apps/commerce/src/subscribers/review-created.ts)

```ts
export default async function handler({ event, container }: SubscriberArgs<{ id: string }>) { … }
export const config: SubscriberConfig = { event: "review.created" }
```

The critical property: **the caller already has its 201 before this runs.** So a
subscriber is right for work that must not slow the response and must not be able
to fail it — emails, cache warming, notifications.

The flip side: **if it throws, nobody finds out.** The review exists and the
email silently did not send. Anything the caller must be told about belongs in
the workflow.

Note the event carries **ids, not records**. Events are broadcast and may be
handled later, so an embedded copy could be stale. Fetch what you need.

### Emit from the workflow, not the route

[`create-review.ts`](../../apps/commerce/src/workflows/create-review.ts) ends
with a built-in step:

```ts
emitEventStep({ eventName: "review.created", data: { id: review.id, … } })
```

Using a **step** rather than calling the event bus directly is the whole point:
it only runs if the earlier steps succeeded, so **nobody is ever notified about a
review that got rolled back.** Emitting from the route handler would break that.

Prove it:

```bash
# happy path → the subscriber logs
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' -d '{...}'

# now set DEMO_FAIL_LINK_STEP=1, restart, and repeat
grep -c "review.created" <your dev log>     # 0 — no event on rollback
```

### Scheduled jobs

[`src/jobs/review-digest.ts`](../../apps/commerce/src/jobs/review-digest.ts)

```ts
export const config = { name: "review-digest", schedule: "0 8 * * *" }
```

Nothing triggers it; the scheduler does. Right for digests, reminders,
reconciliation, cleanup.

While learning, change the schedule to `"* * * * *"`, restart, and watch it fire
each minute — a daily job is otherwise hard to believe in.

⚠️ **Both used to inherit the in-memory problem — and this repo has now fixed
it, which is worth understanding rather than just inheriting.**

On a default Medusa install, events are delivered inside one process, so a
second instance sees only the events it produced itself. And with in-memory
*locking*, a scheduled job runs on **every** instance — "email the moderator a
digest" becomes two emails, and there is no error anywhere to tell you.

This project now configures Redis for both ([09 §9.3](09-to-production.md)), so
events reach every instance and a scheduled job runs once across the whole
deployment. You can see the effect directly: the `uptime-check` job writes one
row per target per minute, and with in-memory locking two instances would write
two — silently doubling every uptime statistic, including the ones you would use
to decide whether there was an incident.

There is a third consequence, easier to miss because it fails silently rather
than doubly. The default workflow engine **does not persist executions at all**,
so `workflow_execution` stays empty no matter how many workflows run or fail.
Every one of the compensation runs earlier in this chapter left no trace. With
`@medusajs/workflow-engine-redis` *and* `{ store: true, retentionTime }` on the
workflow, they are recorded and readable — which is what
[12 · Operating it](12-operating-it.md) is built on.

**A subscriber or scheduled job is only as reliable as the infrastructure
underneath it.** The handler code above is identical either way; what changed is
whether it runs once, twice, or leaves any evidence.

---

## 4.13 Command reference

| Command | When |
|---|---|
| `npm run db:generate` | after editing a **model** |
| `npm run db:migrate` | after generating, **and** after adding a link |
| `npx medusa db:rollback review` | undo the last migration for a module |
| `npm run dev` | :9000 |
| `npm run build` | compiles backend + admin |
| `npm run test:compensation` | asserts a failed workflow leaves no orphans |

---

## 4.14 Your turn

- **Lab 2** — the six-step field change
- **Lab 4** — break a validator, read the 400
- **Lab 5** — delete the link file, watch `reviews` vanish from Query
- **Lab 6** — **watch a workflow compensate.** Do this one.
- **Lab 8** — add a workflow step with a working compensation

---

## 4.15 Check yourself

1. Why has `review` no `product_id` column? What replaces it?
2. `retrieveReview` or `retrieveReviews`? `createReview` or `createReviews`?
3. Two arguments of `StepResponse` — what's each for, and why does *update* need
   something *create* doesn't?
4. Query returns `[{…}, undefined, {…}]`. What happened?
5. Which requires `db:generate`, and which only `db:migrate`: adding a model
   field, adding a link?
6. Two ways a publishable key can be wrong.
7. Why does `seed-reviews.ts` run a workflow instead of calling the service?
8. Why is `emitEventStep` a workflow step rather than a call in the route handler?
9. A subscriber throws. What does the caller see, and what does that imply about
   what belongs in one?

---

**Next:** [05-astro.md](05-astro.md) — the frontend, and the only place the two
backends meet.
