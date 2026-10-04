# 6 · Labs

Ten exercises. **This is where the learning actually happens** — reading the
previous chapters gives you vocabulary; these give you understanding.

Every lab was executed against this stack and the output below is real, not
illustrative. Where your numbers will differ (ids, timestamps) it's noted.

**Before you start:**

```bash
npm run dev
```

**Every lab ends with an Undo step. Do it** — later labs assume a clean repo. If
you lose track, the nuclear option always works:

```bash
npm run db:reset && npm run setup
```

| # | Lab | Teaches | Time |
|---|---|---|---|
| 1 | [Add a field to Payload](#lab-1--add-a-field-to-payload) | config-driven schema | 10 min |
| 2 | [Add a field to Medusa](#lab-2--add-a-field-to-medusa) | migrations, the six steps | 25 min |
| 3 | [Access control filters](#lab-3--access-control-filters-it-doesnt-reject) | Payload's `Where` return | 10 min |
| 4 | [Break a validator](#lab-4--break-a-validator) | where errors come from | 15 min |
| 5 | [Delete the link file](#lab-5--delete-the-link-file) | module isolation, physically | 15 min |
| 6 | [**Watch a workflow compensate**](#lab-6--watch-a-workflow-compensate) | **why Medusa exists** | 20 min |
| 7 | [Add a Payload collection](#lab-7--add-a-payload-collection) | full CRUD from one file | 25 min |
| 8 | [Add a workflow step](#lab-8--add-a-workflow-step) | writing compensation | 40 min |
| 9 | [Action vs endpoint](#lab-9--the-same-operation-both-ways) | choosing a pattern | 40 min |
| 10 | [Reset and rebuild](#lab-10--reset-and-rebuild) | reproducibility | 10 min |

---

<a id="lab-1"></a>
## Lab 1 — Add a field to Payload

**Goal:** see a schema change with no migration command.

### Steps

Add to `fields` in
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts),
just before `publishedAt`:

```ts
{
  name: 'readingTime',
  type: 'number',
  admin: { position: 'sidebar', description: 'Minutes.' },
},
```

Save. Watch `[cms]` in the terminal recompile. Then — **without running any
migration** — check Postgres:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts' | grep reading
```

```
 reading_time   | numeric  |  |  |
```

The column exists. Note the name: **`readingTime` became `reading_time`** —
Payload converts camelCase to snake_case for SQL.

Use it immediately:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -gs -X PATCH http://localhost:3000/api/posts/1 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"readingTime":7}' \
  | python3 -c 'import json,sys; print("readingTime =", json.load(sys.stdin)["doc"].get("readingTime"))'
```

```
readingTime = 7
```

Regenerate types and see it appear:

```bash
npm --prefix apps/cms run generate:types
grep -n "readingTime" apps/cms/src/payload-types.ts | head -2
```

```
253:  readingTime?: number | null;
438:  readingTime?: T;
```

### What it proves

One line in a config produced: a SQL column, REST support, a TypeScript type, and
an admin input. **Zero commands run.**

### Undo — read this, it matters

Remove the field, then regenerate types:

```bash
npm --prefix apps/cms run generate:types
```

⚠️ **The column does NOT disappear.** `push` adds columns but won't silently drop
them. Worse, because Posts has drafts enabled it wrote to **two** tables:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c "select table_name, column_name from information_schema.columns where column_name like '%reading_time%';"
```

```
 table_name |     column_name
------------+----------------------
 posts      | reading_time
 _posts_v   | version_reading_time
```

Leave them and your **next `npm run dev` will hang** on an interactive prompt:

```
? Warnings detected during schema push:
· You're about to delete version_reading_time column in _posts_v table with 5 items
DATA LOSS WARNING: Possible data loss detected if schema is pushed.
Accept warnings and push schema to database? › (y/N)
```

Easy to miss, because the other two services keep logging over it. Drop both:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c 'alter table posts drop column if exists reading_time;' \
  -c 'alter table _posts_v drop column if exists version_reading_time;'
```

**This is the real cost of `push`.** Convenient going forward, messy in reverse —
and the argument for `push: false` in production.

---

<a id="lab-2"></a>
## Lab 2 — Add a field to Medusa

**Goal:** the same change, the explicit way.

### Steps

Add to
[`apps/commerce/src/modules/review/models/review.ts`](../../apps/commerce/src/modules/review/models/review.ts),
after `status`:

```ts
helpful_count: model.number().default(0),
```

Save. Now confirm the column does **not** exist — editing a model changes
TypeScript, not Postgres:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review' | grep -c helpful
```

```
0
```

**Step 1 — generate the migration:**

```bash
npm --prefix apps/commerce run db:generate
```

```
info:    MODULE: review
info:    Generated successfully (Migration20260821154331.ts).
info:    Migrations generated
```

Read what it wrote (your filename will differ):

```bash
cat apps/commerce/src/modules/review/migrations/Migration2026*.ts
```

```ts
export class Migration20260821154331 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table if exists "review" add column if not exists "helpful_count" integer not null default 0;`);
  }
  override async down(): Promise<void> {
    this.addSql(`alter table if exists "review" drop column if exists "helpful_count";`);
  }
}
```

**This file is the whole difference from Lab 1.** It's plain SQL, it's committed
to git, and it has a `down()`.

**Step 2 — apply it:**

```bash
npm --prefix apps/commerce run db:migrate
```

```
info:      ✔ Migrated Migration20260821154331
info:    Migrations completed
```

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review' | grep helpful
```

```
 helpful_count | integer |  | not null | 0
```

**Steps 3–5 (optional but instructive):** to actually *use* the field you would
also edit `src/api/**/validators.ts` to accept it, thread it through the workflow
step, and include it in the route's response. Six touch points total, versus
Payload's one.

### What it proves

Medusa never changes your schema behind your back. You get a reviewable,
reversible artefact — and you pay five extra minutes for it.

### Undo

```bash
npx --prefix apps/commerce medusa db:rollback review
```

```
info:      ● Reverting Migration20260821154331
info:      ✔ Reverted Migration20260821154331
info:    Migrations reverted
```

Then delete the migration file and remove the field from the model:

```bash
rm apps/commerce/src/modules/review/migrations/Migration2026*.ts   # keep the ORIGINAL one!
```

⚠️ **Keep `Migration20260819182718.ts`** — that's the original review table. Only
delete the one you just generated. Verify one file remains:

```bash
ls apps/commerce/src/modules/review/migrations/*.ts | wc -l   # 1
```

---

<a id="lab-3"></a>
## Lab 3 — Access control filters, it doesn't reject

**Goal:** understand Payload's most distinctive idea.

### Steps

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  | python3 -c 'import json,sys; print("anonymous:", json.load(sys.stdin)["totalDocs"])'

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; print("with key: ", json.load(sys.stdin)["totalDocs"])'
```

```
anonymous: 3
with key:  4
```

Same URL. Same handler. **Status 200 both times** — the anonymous caller wasn't
refused, the draft simply didn't exist for them.

Now the custom endpoint, which respects the same rules:

```bash
curl -s http://localhost:3000/api/posts/stats \
  | python3 -c 'import json,sys; print("anon: ", json.load(sys.stdin)["counts"])'
curl -s http://localhost:3000/api/posts/stats -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; print("keyed:", json.load(sys.stdin)["counts"])'
```

```
anon:  {'posts': 3, 'published': 3, 'drafts': 0, 'categories': 3}
keyed: {'posts': 4, 'published': 3, 'drafts': 1, 'categories': 3}
```

Read the rule that does it, in `Posts.ts`:

```ts
read: ({ req }) => {
  if (req.user) return true
  return { _status: { equals: 'published' } }   // a query, not a boolean
}
```

### Experiment

Change it to `return false` and re-run. You now get **403** instead of a filtered
`200`. That is the difference between *invisible* and *forbidden*. Change it
back.

### What it proves

Access control can shape results, not just gate them. It's why one endpoint safely
serves both the public and the CMS.

### Undo

Nothing to undo unless you did the experiment.

---

<a id="lab-4"></a>
## Lab 4 — Break a validator

**Goal:** learn to read an error and know which layer produced it.

### Steps

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" 'http://localhost:9000/store/products?limit=1' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')
```

**A · Field constraints** (Medusa's zod, before any handler runs):

```bash
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"no\",\"content\":\"short\",\"rating\":9,\"author_name\":\"T\"}"
```

```json
{"type":"invalid_data","message":"Invalid request: Value for field 'title' too small, expected at least: '3'; Value for field 'content' too small, expected at least: '10'; Value for field 'rating' too big, expected at most: '5'"}
```

Three problems in one response — zod reports them all, not just the first.

**B · An unknown field** (`.strict()`):

```bash
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"Self approve\",\"content\":\"Trying to publish myself.\",\"rating\":5,\"author_name\":\"T\",\"status\":\"approved\"}"
```

```json
{"type":"invalid_data","message":"Invalid request: Unrecognized fields: 'status'"}
```

**This is a security control, not a typo check.** Without `.strict()` the field
would be silently dropped — and a reader of the code could not tell whether
self-publishing was prevented or merely accidental.

**C · Business rule** (workflow step 1, *past* validation):

```bash
curl -s -X POST http://localhost:9000/store/reviews -H "x-publishable-api-key: $PK" \
  -H 'Content-Type: application/json' \
  -d '{"product_id":"prod_nope","title":"Ghost","content":"No such product exists.","rating":4,"author_name":"T"}'
```

```json
{"type":"not_found","message":"Product 'prod_nope' does not exist, so it cannot be reviewed."}
```

**D · The same class of error from Payload's BFF**, for contrast:

```bash
curl -s -X POST http://localhost:4321/api/reviews -H 'Content-Type: application/json' \
  -d '{"product_id":"x","title":"no","content":"short","rating":11,"author_name":""}' \
  | python3 -m json.tool
```

```json
{
    "error": {
        "message": "Validation failed.",
        "detail": {
            "title": ["Too small: expected string to have >=3 characters"],
            "rating": ["Too big: expected number to be <=5"]
        }
    }
}
```

Note the **shape difference**: Medusa concatenates into one `message`; the Astro
BFF returns per-field `detail`. Neither is wrong — but a UI wanting to highlight
individual inputs needs the second, which is exactly why the BFF reshapes it.

### What it proves

Four different layers reject you, with four different formats. Recognising which
one is talking tells you which file to open.

### Undo

Nothing — every request failed by design.

---

<a id="lab-5"></a>
## Lab 5 — Delete the link file

**Goal:** see module isolation physically.

### Steps

Confirm the association works:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" 'http://localhost:9000/store/products?limit=1' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')
curl -s -H "x-publishable-api-key: $PK" "http://localhost:9000/store/products/$PID/reviews" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("reviews:", len(d["reviews"]), "| stats:", d["stats"])'
```

```
reviews: 2 | stats: {'count': 2, 'average': 4.5, 'distribution': {...}}
```

Now move the link definition away and **restart Medusa** (links are not
hot-reloaded):

```bash
mv apps/commerce/src/links/product-review.ts /tmp/product-review.ts.bak
kill $(ss -ltnp | grep ':9000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
npm run dev:commerce
```

Re-run the request:

```
{"product":{"id":"prod_…","title":"Managed PostgreSQL",…},
 "reviews":[],
 "stats":{"count":0,"average":0,"distribution":{"1":0,…}}}
```

**Note what did *not* happen: no error.** `query.graph` asked for `reviews.*`,
found no link definition to resolve it through, and returned nothing. The route
degrades silently to "this product has no reviews".

Meanwhile the data is completely untouched:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A \
  -c 'select count(*) from product_product_review_review;'
```

```
11
```

Eleven link rows still sit in the table. Nothing was deleted — Medusa simply no
longer *knows how* to traverse them.

That silence is worth remembering: a missing or mistyped link doesn't announce
itself, it just makes related data quietly vanish. If a relationship "stopped
working" and nothing is in the logs, check `src/links/` first.

### What it proves

The `reviews` field on a product comes from **nothing in either module**. It comes
from that one link file. Delete it and the two modules still compile and run
perfectly — they simply no longer know about each other.

That is module isolation, made concrete.

### Undo

```bash
mv /tmp/product-review.ts.bak apps/commerce/src/links/product-review.ts
kill $(ss -ltnp | grep ':9000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
npm run dev:commerce
```

The link table rows were never deleted, so the association returns intact.

---

<a id="lab-6"></a>
## Lab 6 — Watch a workflow compensate

**The most important lab here.** Everything laborious about Medusa exists for
this.

### Steps

**1 · Count before:**

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A \
  -c 'select count(*) from review;' \
  -c 'select count(*) from product_product_review_review;'
```

```
11
11
```

**2 · Make step 3 fail.** In `apps/commerce/.env`:

```
DEMO_FAIL_LINK_STEP=1
```

Restart Medusa (env changes need a restart):

```bash
kill $(ss -ltnp | grep ':9000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
npm run dev:commerce
```

**3 · Create a review:**

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" 'http://localhost:9000/store/products?limit=1' \
      | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

curl -s -o /dev/null -w 'status=%{http_code}\n' -X POST http://localhost:9000/store/reviews \
  -H "x-publishable-api-key: $PK" -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"Must be rolled back\",\"content\":\"Step 3 throws, so step 2 must compensate.\",\"rating\":5,\"author_name\":\"Rollback Tester\"}"
```

```
status=500
```

In the `[commerce]` logs:

```
error:   DEMO_FAIL_LINK_STEP=1 — failing on purpose so you can watch the workflow compensate.
```

**4 · Count after:**

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A \
  -c 'select count(*) from review;' \
  -c 'select count(*) from product_product_review_review;' \
  -c "select count(*) from review where title = 'Must be rolled back';"
```

```
11
11
0
```

**Unchanged.** Step 2 inserted a row; step 3 threw; step 2's compensation deleted
it. The third query confirms it's gone entirely — not even soft-deleted, because
create's compensation is a **hard** delete (the row should never have existed).

### The counterfactual

Without a workflow, that route would be:

```ts
const review = await reviewService.createReviews(input)   // succeeds
await link.create({ … })                                  // throws
```

Two writes in different modules, no transaction possible between them. You'd be
left with a permanent orphan review attached to no product — and no error message
would tell you it happened.

### What it proves

This is the answer to "why not just call the service directly?" Compensation is
distributed-transaction handling you'd otherwise write by hand, badly.

### Undo

Set `DEMO_FAIL_LINK_STEP=0` and restart Medusa. Confirm it's back:

```bash
grep DEMO_FAIL apps/commerce/.env    # DEMO_FAIL_LINK_STEP=0
```

---

<a id="lab-7"></a>
## Lab 7 — Add a Payload collection

**Goal:** full CRUD from one file.

### Steps

Create `apps/cms/src/collections/Authors.ts`:

```ts
import type { CollectionConfig } from 'payload'
import { slugFrom } from '../hooks/slugify'

export const Authors: CollectionConfig = {
  slug: 'authors',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', 'updatedAt'] },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'slug', type: 'text', unique: true, index: true,
      hooks: { beforeValidate: [slugFrom('name')] },
    },
    { name: 'bio', type: 'textarea' },
  ],
}
```

Note it **reuses** `slugFrom` from
[`src/hooks/slugify.ts`](../../apps/cms/src/hooks/slugify.ts) — field hooks are
portable across collections.

Register it in `payload.config.ts`:

```ts
import { Authors } from './collections/Authors'
…
collections: [Users, Media, Categories, Posts, Authors],
```

⚠️ **Now restart Payload.** Adding a *field* hot-reloads; registering a *new
collection* does not. Skip this and every request below returns `404` with no
error in the log to explain why:

```bash
kill $(ss -ltnp | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
npm run dev:cms
```

Then exercise it:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s -X POST http://localhost:3000/api/authors \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","bio":"First programmer."}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; print("id",d["id"],"| slug:",d["slug"])'

curl -s 'http://localhost:3000/api/authors?limit=10' \
  | python3 -c 'import json,sys; print("total:", json.load(sys.stdin)["totalDocs"])'
```

```
id 1 | slug: ada-lovelace
total: 1
```

The slug was derived automatically by the reused hook. The table exists with no
migration run:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep authors
```

And your access rules are live — anonymous writes are refused:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/authors \
  -H 'Content-Type: application/json' -d '{"name":"Nobody"}'      # 403
```

Check the admin panel — a full Authors CRUD screen now exists.

### Going further

Add a `relationship` field on `Posts` pointing at `authors`, then fetch a post
with `?depth=1` and watch the author document expand inline.

### What it proves

One file → SQL table + 6 REST endpoints + GraphQL + admin UI + TS types.

### Undo

Remove `Authors` from `collections`, delete the file, then drop the table:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c 'drop table if exists authors cascade;'
```

(`push` won't drop it for you — same lesson as Lab 1.)

---

<a id="lab-8"></a>
## Lab 8 — Add a workflow step

**Goal:** write a compensation function that actually works.

### Steps

Create `apps/commerce/src/workflows/steps/log-review-created.ts`:

```ts
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export type LogReviewInput = { review_id: string; title: string }

export const logReviewCreatedStep = createStep(
  "log-review-created",
  async (input: LogReviewInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info(`[audit] review created: ${input.review_id} "${input.title}"`)
    return new StepResponse({ logged: true }, input.review_id)
  },
  // Compensation: runs only if a LATER step fails.
  async (reviewId, { container }) => {
    if (!reviewId) return                       // ← always guard
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.info(`[audit] ROLLED BACK: ${reviewId}`)
  }
)
```

Add it to
[`src/workflows/create-review.ts`](../../apps/commerce/src/workflows/create-review.ts),
**between** create and link:

```ts
const review = createReviewStep({ … })

logReviewCreatedStep({ review_id: review.id, title: input.title })

linkReviewToProductStep({ review_id: review.id, product_id: input.product_id })
```

**Test the happy path** — POST a review and watch for `[audit] review created:`.

**Test the rollback** — set `DEMO_FAIL_LINK_STEP=1`, restart, POST again. Now you
see *both* lines:

```
[audit] review created: 01M0…
[audit] ROLLED BACK: 01M0…
```

The link step failed, so every prior step compensated **in reverse order**.

### What it proves

- Steps compose; adding behaviour means adding a step, not editing a route
- Compensation runs in reverse
- `review.id` works as a step input even though it's a proxy — property access is
  recorded into the graph

### Try breaking it

Remove the `if (!reviewId) return` guard and make the *first* step fail.
Compensation fires with `undefined` and you get a crash inside your rollback — the
reason that guard is in every step in this repo.

### Undo

Remove the step from the workflow, delete the file, set `DEMO_FAIL_LINK_STEP=0`,
restart.

---

<a id="lab-9"></a>
## Lab 9 — The same operation, both ways

**Goal:** feel the trade-off rather than read about it.

We'll implement "publish this post" both ways.

### Part 0 — a shared helper (and a trap worth seeing)

Both patterns need to flip `_status` without disturbing anything else. The
obvious move is wrong:

```ts
updatePost(id, { status: 'published' })   // ✗ DESTRUCTIVE
```

`updatePost` sends the **whole** document (`toPayloadBody` builds every field), so
a partial input blanks the title and sets `category: null`. PATCH itself is happy
with one key — so add a targeted helper to
[`src/lib/payload.ts`](../../apps/storefront/src/lib/payload.ts), next to
`updatePost`:

```ts
export async function publishPost(id: number | string): Promise<Post> {
  const result = await request<{ doc: Post }>(`/posts/${id}`, {
    method: 'PATCH',
    body: { _status: 'published' },     // only this field
    authenticated: true,
  })

  return result.doc
}
```

This is a real lesson, not busywork: **a "full document" update function is not a
partial update function**, and reaching for the wrong one silently destroys data.

### Part A — as an Action

Add to `post` in
[`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts) (and import
`publishPost`):

```ts
publish: defineAction({
  accept: 'form',
  input: z.object({ id: z.coerce.number() }),
  handler: async ({ id }) => {
    const post = await publishPost(id)
    return { id: post.id, status: post._status }
  },
}),
```

Add a form to `src/pages/posts/index.astro`, inside the actions cell:

```astro
{post._status === 'draft' && (
  <form method="POST" action={actions.post.publish} style="display:inline">
    <input type="hidden" name="id" value={post.id} />
    <button class="btn small" type="submit">Publish</button>
  </form>
)}
```

Click it on the draft post. Works with JavaScript disabled. Callable **only from
this app**.

### Part B — as an endpoint

Create `src/pages/api/posts/[id]/publish.ts`:

```ts
import type { APIRoute } from 'astro'

import { publishPost } from '../../../../lib/payload'

export const prerender = false

export const POST: APIRoute = async ({ params }) => {
  try {
    const post = await publishPost(params.id!)
    return Response.json({ id: post.id, status: post._status })
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'failed' } },
      { status: 502 },
    )
  }
}
```

Call it — **note the `Origin` header**:

```bash
curl -s -X POST http://localhost:4321/api/posts/4/publish \
  -H 'Origin: http://localhost:4321' | python3 -m json.tool
```

```json
{
    "id": 4,
    "status": "published"
}
```

Without `Origin` you get `403 Cross-site POST form submissions are forbidden`. A
bodyless POST looks form-like to Astro's CSRF check;
`-H 'Content-Type: application/json' -d '{}'` also satisfies it.

Confirm nothing else changed:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -gs -H "Authorization: users API-Key $KEY" 'http://localhost:3000/api/posts/4?depth=0' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["title"][:40], "| status:", d["_status"], "| category:", d["category"])'
```

Title and category intact. Had you used `updatePost`, both would be gone.

Callable by **anything**. Needs no page. Ships no HTML.

### Put the draft back

```bash
curl -gs -X PATCH http://localhost:3000/api/posts/4 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"_status":"draft"}' -o /dev/null -w 'unpublished: %{http_code}\n'
```

⚠️ Unpublishing is a PATCH with `_status: 'draft'` and **no** `?draft=true`. Adding
`?draft=true` saves a *draft version* while leaving the published one live — the
post stays public and you'll wonder why. Verify with the Lab 3 counts: back to
3 anonymous / 4 keyed.

### Compare

| | Action | Endpoint |
|---|---|---|
| Lines written | ~8 | ~15 |
| Types | end to end | you assert them |
| Works without JS | ✅ | ❌ |
| curl-able | awkward (`?_action=`) | ✅ |
| Error shape | `ActionError` | whatever you return |

### What it proves

Neither is better. **Actions optimise for your own UI; endpoints optimise for
other callers.** This repo ships both so the choice stays visible.

### Undo

Remove the action, the form, and the endpoint file.

---

<a id="lab-10"></a>
## Lab 10 — Reset and rebuild

**Goal:** confidence that nothing here is precious.

### Steps

```bash
npm run db:reset
```

Both databases are gone. Confirm:

```bash
docker exec apm-postgres psql -U postgres -c '\l' | grep -c _crud
```

Now rebuild everything:

```bash
npm run setup
```

It brings up Postgres, seeds the CMS, prints a **new** `PAYLOAD_API_KEY`, runs
Medusa's migrations, seeds products and reviews through the workflow, creates the
admin user, prints a **new** `MEDUSA_PUBLISHABLE_KEY`, and writes both into
`apps/storefront/.env`.

```bash
npm run dev
curl -s http://localhost:4321/api/health | python3 -m json.tool
```

```json
{ "ok": true, "services": { "payload": {"ok": true, …}, "medusa": {"ok": true, …} } }
```

⚠️ **The keys changed.** Any key you saved in notes or a REST client is now dead —
that's the most common cause of a 401 right after a reset. Re-read them from
`apps/storefront/.env`.

### What it proves

The whole environment rebuilds from scratch in about a minute. **This is why you
can experiment fearlessly** — and it's also the test of whether the setup scripts
are honest, since anything they forget shows up immediately.

---

## Where to go next

- **[07-troubleshooting.md](07-troubleshooting.md)** — when something breaks
- **[09-to-production.md](09-to-production.md)** — what changes for real

**Then build something.** Suggestions in rough order of difficulty:

1. A `tags` collection in Payload, related to posts, with a `/tags/[slug]` page
2. Reviewer replies — a second Medusa model linked to `review`
3. A "helpful" vote: model field + workflow step + endpoint + optimistic UI
4. Batch the `/products` N+1 into one `query.graph` route (§5.9)
5. Authentication for the storefront, so not everyone can delete everything
