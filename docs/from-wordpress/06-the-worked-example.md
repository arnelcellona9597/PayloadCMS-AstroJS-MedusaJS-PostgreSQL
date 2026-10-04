# 6 · The three together — who owns what

> Counterpart in the main course: [06 · Labs](../learn/06-labs.md), which makes
> you type these traces. The architecture summary is in the repo's own
> [README](../../README.md).

Chapters 3 to 5 took the three services one at a time. This one puts them back
together, because the hard part of this stack is not any single framework. It is
the question you now face on every ticket and never faced in WordPress:

**Which service owns this piece of data?**

In WordPress that question rarely comes up. There is one database. A post, a
product, a review, an order, a customer address and an SEO title all live in
`wp_posts` and `wp_postmeta`, and the decision in front of you is which post
type and which meta key. That is a genuine strength — it is why one `WP_Query`
can return products filtered by a custom field and sorted by a taxonomy term, in
one SQL statement, with no planning meeting.

Here you pay for the separation up front, in every decision. This chapter is the
rule that makes those decisions fast, two traces showing where the data actually
lands, and an honest account of what the separation costs.

---

## 6.1 One database became three owners, and one of them owns nothing

Here is the whole architecture as a table. Everything in the rest of this
chapter is a consequence of it.

| Service | Owns | Does not own | Storage |
|---|---|---|---|
| **Payload** :3000 | posts, pages, categories, media, users, site settings | anything commercial | `payload_crud`, 21 tables |
| **Medusa** :9000 | products, variants, prices, regions, reviews, uptime checks | anything editorial | `medusa_crud`, 146 tables |
| **Astro** :4321 | **nothing** | everything | no database at all |

That third row is the one to sit with. ✅ Astro has no database connection, no
ORM and no migrations — check `apps/storefront/package.json` and there is no
database driver in it. What state it does hold is all per-process and all
disposable: the page it is rendering right now, a ring buffer of what it just
served ([12 §12.3](../learn/12-operating-it.md)), the rate-limiter's counters,
and a Medusa admin JWT cached in module scope by
[`medusa-admin.ts`](../../apps/storefront/src/lib/medusa-admin.ts). Restart the
process and none of it is missed. Everything that matters it asks for over HTTP,
every time.

Prove the separation is physical rather than conventional:

```bash
docker exec apm-postgres psql -U postgres -t \
  -c "select datname from pg_database where datname like '%_crud';" \
| while read -r db; do [ -z "$db" ] && continue
    n=$(docker exec apm-postgres psql -U postgres -d "$db" -t \
      -c "select count(*) from information_schema.tables where table_schema='public';")
    echo "$db $n"
  done
```

```
payload_crud     21
medusa_crud    146
```

Two application databases on one Postgres server. They share a process and a
port and nothing else — no schema in common, no user in common, no foreign key
that could possibly cross.

⚠️ **Running both on one container is a development convenience, not the
design.** In production these are two servers with two credentials, and nothing
in the application code would change — which is the test of whether you have
really separated them. The full schema tour is
[10 · Databases](../learn/10-databases.md).

### The WordPress contrast, stated fairly

| | WordPress | This repo |
|---|---|---|
| Databases | 1 | 2, plus a client that has none |
| A join across content and commerce | `JOIN wp_postmeta` | impossible in SQL |
| Transaction across content and commerce | yes | **no** |
| Deploys | 1 | 3 |
| Backup | 1 dump | 2 dumps + a manifest |
| Place a new field could go | `wp_postmeta`, always | a decision, every time |

WordPress wins four of those six outright. What the shared table costs is
isolation: a plugin that writes to `wp_postmeta` can read anybody's data, and on
a large install that table can end up acting as the integration layer between
plugins that were never designed together. The separation here is the inverse
trade — more decisions, fewer ways for one component to surprise another.

---

## 6.2 The decision rule: name the service that would still need it

You can apply this on your own projects, including WordPress ones. Three steps,
in order.

**Step 1 — Delete two of the three services in your head. Which one still needs
this data to do its job?** That one owns it.

**Step 2 — If two of them need it, one owns it and the other holds a
reference** — an id and nothing else. Copy a title across the boundary and you
have two titles that will disagree.

**Step 3 — If your answer is Astro, the answer is wrong.** Astro owns no domain
data. A fact with nowhere else to live means you are missing a collection or a
module, not that the frontend should keep it.

When step 1 is genuinely ambiguous, these four tie-breaks settle it:

| Ask | If yes |
|---|---|
| Does a human need to see a **draft** of it before the public does? | Payload — it has drafts and version history |
| Must writing it succeed-or-fail **together with another write**? | Medusa — workflows have compensation |
| Does it need to be read **alongside a product, variant or price**? | Medusa — nothing else can reach those |
| Is it true only **for this request or this viewer**? | Nowhere. It is process state, not data |

### Seven worked examples

| Data | Owner | Why | Here? |
|---|---|---|---|
| A blog post | **Payload** | Delete the other two: an editor still writes posts, and needs drafts | ✅ `posts` |
| A product review | **Medusa** | Must be read alongside a product, and creating one is two writes that must both land | ✅ `review` + link table |
| A product description | **Medusa** | A column on the product record itself. Split it out and you get descriptions for products that no longer exist | ✅ read-only via SDK |
| A homepage hero | **Payload** | A layout an editor rearranges, with no commercial meaning | ✅ `hero` block in [`Pages.ts`](../../apps/cms/src/collections/Pages.ts) |
| A customer address | **Medusa** | It belongs to an order, and orders are Medusa's | 🚫 **nothing here** |
| An SEO title | **Payload** | Editorial copy *about* a document belongs on the document | 🚫 **not modelled** |
| A stock count | **Medusa** | It changes when an order is placed, which only Medusa observes | 📋 seeded, nothing reads it |

Three of those seven are honest gaps. The rule still gives the right answer for
each; this repo simply never asked the question. Prove all three at once:

```bash
for t in customer cart "order"; do
  echo -n "medusa $t rows: "
  docker exec apm-postgres psql -U postgres -d medusa_crud -t -c "select count(*) from \"$t\";" | tr -d ' \n'; echo
done
echo -n 'cms files with an seo field:        ' && grep -rli "seo" apps/cms/src/collections/ | wc -l
echo -n 'storefront files reading inventory: ' && grep -rliE "inventory|stock" apps/storefront/src/ | wc -l
```

```
medusa customer rows: 0
medusa cart rows: 0
medusa order rows: 0
cms files with an seo field:        0
storefront files reading inventory: 0
```

**Customer address 🚫** — reviews carry free-text `author_name` and
`author_email` and are attached to no customer at all. **SEO title 🚫** —
Yoast's whole job would be a group field on `Posts` and `Pages`; instead
[`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) hard-codes
`<title>{title} · Astro + Payload + Medusa</title>`, so the page renders what
the component was handed, not what an editor chose. **Stock count 📋** — Medusa
seeded 20 inventory levels in one warehouse and no route or page reads any of
them.

⚠️ **This repo demonstrates reviews and operations built on Medusa's product
module. It is not a commerce demo.** Carts, orders, customers, payments and
promotions have zero custom code. Chapter 5 lists exactly which primitives are
real here and which are only seeded.

The vocabulary behind "owns", "reference" and "process state" is in
[01 · Foundations](../learn/01-foundations.md) if any of it is new.

---

## 6.3 Trace A — creating a post goes Astro → Payload and stops there

Nine hops. Every one of them is a real file you can open.

| # | Where | What happens |
|---|---|---|
| 1 | browser | `<form method="POST" action={actions.post.create}>` — no `enctype`, so the browser sends `application/x-www-form-urlencoded` |
| 2 | Astro | `security.checkOrigin` runs **upstream of middleware** and rejects a cross-origin form post |
| 3 | Astro | middleware rate-limits the Action POST (`?_action=`) and logs it |
| 4 | Astro | the Action's zod schema parses the FormData — every value arrives as a string |
| 5 | Astro | `createPost()` → `toPayloadBody()` → `toLexical(body)` turns the textarea into a Lexical node tree |
| 6 | Astro | the same `createPost()` sends `POST /api/posts` with `Authorization: users API-Key …` |
| 7 | Payload | `access.create` → field `beforeValidate` (slug) → collection `beforeChange` (publish date) |
| 8 | Postgres | one row in `posts`, one row in `_posts_v` |
| 9 | Payload | `afterChange` logs; Astro redirects `302 → /posts?created=<id>` |

```
browser            Astro :4321                       Payload :3000        payload_crud
   │ POST multipart   │                                    │                   │
   ├─────────────────▶│ ② checkOrigin                      │                   │
   │                  │ ③ rate limit + request log         │                   │
   │                  │ ④ zod parse (astro/zod)            │                   │
   │                  │ ⑤ toLexical() (lib/payload.ts)     │                   │
   │                  │ ⑥ POST /api/posts ────────────────▶│ ⑦ access.create   │
   │                  │   Authorization: users API-Key …   │    beforeValidate │
   │                  │                                    │    beforeChange   │
   │                  │                                    │ ⑧ INSERT ────────▶│ posts
   │                  │                                    │                   │ _posts_v
   │                  │◀─────────────────────────── { doc }│ ⑨ afterChange     │
   │◀── 302 /posts?…  │                                    │    (logs only)    │
```

**Hop 4 is eleven lines** in
[`apps/storefront/src/actions/index.ts`](../../apps/storefront/src/actions/index.ts):
`accept: 'form'`, an `input:` zod schema, a handler that calls `createPost` and
maps any `PayloadError` through `toActionError`. The source and the three
failure modes it produces are [04 §4.8](04-astro-for-theme-developers.md); this
trace only needs to know the hop exists. Hops 5 and 6 are not in that file
either: `createPost` lives in
[`src/lib/payload.ts`](../../apps/storefront/src/lib/payload.ts), and it is
`toPayloadBody()` there that calls `toLexical()` on the way out.

**Run the whole thing as one request.** The title carries a timestamp because
`slug` is unique and derived from it — run this twice with a fixed title and the
second attempt comes back `400` with `invalid: slug`, which is hop 7 doing its
job:

```bash
curl -s -X POST 'http://localhost:4321/posts/new?_action=post.create' \
  -H 'Origin: http://localhost:4321' \
  -F "title=Who owns what $(date +%s)" \
  -F 'excerpt=Traced end to end.' \
  -F 'body=Payload owns this sentence.' \
  -F 'status=published' \
  -o /dev/null -w 'HTTP %{http_code}\nLocation: %{redirect_url}\n'
```

```
HTTP 302
Location: http://localhost:4321/posts?created=32
```

⚠️ **The `Origin` header is load-bearing on form posts and irrelevant on JSON
ones.** Astro's origin check only inspects the content types a browser can send
cross-origin without a preflight. Drop the header and compare:

```bash
curl -s -o /dev/null -w 'form POST, no Origin: HTTP %{http_code}\n' \
  -X POST 'http://localhost:4321/posts/new?_action=post.create' -F 'title=origin test' -F 'status=draft'
curl -s -o /dev/null -w 'JSON POST, no Origin: HTTP %{http_code}\n' \
  -X POST http://localhost:4321/api/reviews -H 'Content-Type: application/json' -d '{"bad":1}'
```

```
form POST, no Origin: HTTP 403
JSON POST, no Origin: HTTP 422
```

`403` means the Action never ran. `422` means the endpoint ran and rejected the
body — a completely different failure that looks similar in a log.

That the check sits *above* middleware is observable, not folklore: add `-D -`
to the first command and the `403` comes back with no `x-ratelimit-*` headers at
all, while any request that gets through carries all three. The limiter never
saw the rejected one.

**Hop 7** is the `beforeChange` hook in
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts),
which stamps `publishedAt` the first time a post goes live and defaults
`_status` to `draft` on create. Nobody sent either value.

**Hop 8 — the data, in the database:**

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c "
select p.id, p.slug, p._status, v.version__status as version_status, v.latest
from posts p join _posts_v v on v.parent_id = p.id
order by p.id desc limit 1;"
```

```
 id |           slug           |  _status  | version_status | latest 
----+--------------------------+-----------+----------------+--------
 32 | who-owns-what-1790866486 | published | published      | t
(1 row)
```

Two rows for one create, because `Posts` has `versions: { drafts: true }`.
Nobody typed the slug: a field hook derived it in hop 7.

**Hop 9 — the hook firing, in Payload's own log:**

```bash
grep "posts.afterChange" logs/cms.log | tail -1
```

```
[22:54:46] INFO: [posts.afterChange] create id=32 slug=who-owns-what-1790866486 status=published
```

Medusa was never contacted and nothing in `medusa_crud` changed. That is the
point of the trace: **a post is a one-backend request.** Why posts use an Action
and reviews do not is [05 §5.6](../learn/05-astro.md).

---

## 6.4 Trace B — creating a review goes Astro → Medusa → a workflow → two tables

Same user gesture, a completely different machine underneath. Ten hops.

| # | Where | What happens |
|---|---|---|
| 1 | browser | `fetch('/api/reviews', { method: 'POST', body: JSON })` |
| 2 | Astro | middleware rate-limits and logs `/api/*` |
| 3 | Astro | the endpoint's own zod schema parses JSON **or** FormData — hand-written |
| 4 | Astro | `createStoreReview()` sends `POST /store/reviews` with `x-publishable-api-key` |
| 5 | Medusa | `rateLimit` middleware on `/store/*` (admin routes are deliberately exempt) |
| 6 | Medusa | a **second** zod layer validates `req.validatedBody` |
| 7 | Medusa | the route forces `status: "pending"` and runs `createReviewWorkflow` |
| 8 | workflow | `validate-product` → `create-review` → `link-review-to-product` → `emit-event-step` |
| 9 | Postgres | one row in `review`, one row in `product_product_review_review`, one in `workflow_execution` |
| 10 | Medusa | the `review.created` subscriber runs **after** the caller already has its 201 |

```
browser        Astro :4321              Medusa :9000                     medusa_crud
  │ POST JSON     │                          │                                │
  ├──────────────▶│ ② rate limit + log       │                                │
  │               │ ③ zod parse              │                                │
  │               │ ④ POST /store/reviews ──▶│ ⑤ rateLimit (/store/* only)    │
  │               │   x-publishable-api-key  │ ⑥ zod validate (validators.ts) │
  │               │                          │ ⑦ force status:"pending"       │
  │               │                          │ ⑧ createReviewWorkflow.run()   │
  │               │                          │    ├ validate-product  (read)  │
  │               │                          │    ├ create-review ───────────▶│ review
  │               │                          │    ├ link-review-to-product ──▶│ product_product_
  │               │                          │    └ emit-event-step           │ review_review
  │               │◀────────── 201 { review }│                               ▶│ workflow_execution
  │◀─ 201 {review}│                          │ ⑩ subscriber, asynchronously   │
```

**Hop 7 is five lines** in
[`apps/commerce/src/api/store/reviews/route.ts`](../../apps/commerce/src/api/store/reviews/route.ts):

```ts
const { result } = await createReviewWorkflow(req.scope).run({
  input: {
    ...req.validatedBody,
    status: "pending",
  },
})
```

`status` is not in the store schema at all, so a caller cannot ask for
`approved`. It is set here rather than defaulted, because "a public review is
never self-published" is a rule, not a default.

**Run it:**

```bash
# Capture a product id rather than pasting one. Medusa generates them at seed
# time, so any literal `prod_…` in a document is wrong on somebody else's machine.
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=1&fields=id' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

RESP=$(curl -s -X POST http://localhost:4321/api/reviews \
  -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",
       \"title\":\"Owns nothing, sees everything\",
       \"content\":\"Filed through Astro, stored by Medusa, linked by a workflow.\",
       \"rating\":4,\"author_name\":\"Arnel\"}")

ID=$(printf '%s' "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["review"]["id"])')

printf '%s' "$RESP" | python3 -c 'import json,sys; d=json.load(sys.stdin); r=d["review"]
print(r["id"], r["status"], r["rating"]); print(d["message"])'
```

```
01M3VZCNEV2E2JGZ08BS2Y978V pending 4
Thanks — your review is awaiting moderation.
```

Medusa mints a fresh ULID per review, so yours will differ — that is why `$ID`
is captured above rather than typed. The blocks below reuse it.

Substitute your own product id. To list them:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=4&fields=id,handle' | head -c 200
```

```
{"products":[{"id":"prod_01M436HVYV1EXC9H7SYAZ6X0KG","handle":"dedicated-edge-server"},{"id":"prod_01M436HVYV5N7NV59ZBC0HF7JJ","handle":"managed-postgresql"},{"id"
```

**Hop 9 — both rows, in two different tables:**

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select r.id, r.rating, r.status, l.product_id
from review r
left join product_product_review_review l on l.review_id = r.id
where r.id = '$ID';"
```

```
             id             | rating | status  |           product_id            
----------------------------+--------+---------+---------------------------------
 01M3VZCNEV2E2JGZ08BS2Y978V |      4 | pending | prod_01M436HVYV1EXC9H7SYAZ6X0KG
(1 row)
```

**That second table is the entire reason this is a workflow.** Two writes, in
two modules, with no database transaction spanning them. If the link insert
fails after the review insert succeeds, you have a review attached to nothing
and no SQL `ROLLBACK` to save you — so the rollback is written by hand, as the
compensation function on each step. See
[`link-review-to-product.ts`](../../apps/commerce/src/workflows/steps/link-review-to-product.ts),
whose compensation calls `link.dismiss()` rather than `link.delete()`: the verb
for undoing an association, not for deleting the things associated.

**Hop 8, from the orchestrator's own records:**

```bash
TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"supersecret"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:9000/admin/workflows?state=done&limit=1' \
  | python3 -c '
import json,sys
e = json.load(sys.stdin)["executions"][0]
print(e["workflowId"], "->", e["state"])
for s in e["steps"]:
    print("  " + "  "*s["depth"] + s["name"].split(".")[-1].ljust(26),
          "invoke=" + s["invoke"] + "/" + s["invokeStatus"])'
```

```
create-review -> done
    validate-product           invoke=done/ok
      create-review              invoke=done/ok
        link-review-to-product     invoke=done/ok
          emit-event-step            invoke=done/ok
```

**Hop 10 — the part the caller never waited for:**

```bash
grep "\[review.created\]" logs/commerce.log | tail -2
```

```
info:    [review.created] "Owns nothing, sees everything" (4★) by Arnel on product prod_01M436HVYV1EXC9H7SYAZ6X0KG — status pending
info:    [review.created] → would notify a moderator: 01M3VZCNEV2E2JGZ08BS2Y978V awaits a decision
```

The 201 was already sent. ✅ The subscriber is real and runs; it logs, because
the notification it would send is not this repo's subject.

⚠️ **The review you just created will not appear on the product page, and that
is correct.** `/store/products/:id/reviews` returns approved reviews only. To
watch it appear, moderate it through the intent-named endpoint:

```bash
curl -s -X POST http://localhost:4321/api/reviews/$ID/moderate \
  -H 'Content-Type: application/json' -d '{"status":"approved"}'
```

```json
{"id":"01M3VZCNEV2E2JGZ08BS2Y978V","status":"approved","moderated":true}
```

The module system, links, workflows and compensation are taught properly in
[04 · Medusa](../learn/04-medusa.md); this section is only about where the data
landed.

### The two traces, side by side

| | Trace A — a post | Trace B — a review |
|---|---|---|
| Astro pattern | **Pattern A** — an Action, `accept: 'form'` | **Pattern B** — a hand-written endpoint |
| Works with JS off | ✅ yes — redirect, then a rendered page | ✅ the POST lands, but the reply is raw JSON |
| Validation layers | 1 (astro/zod) | 2 (astro/zod, then Medusa's zod) |
| Auth to the backend | `users API-Key` | `x-publishable-api-key` |
| Backend writes | 1 table + 1 version table | 2 tables, 2 modules |
| Rollback if the last write fails | Postgres transaction | hand-written compensation |
| Published immediately | if `_status: 'published'` | **never** — always `pending` |
| Asynchronous follow-up | none | `review.created` subscriber |

Same shape of gesture, two different amounts of machinery, each proportionate to
what it is protecting. The two patterns are named and compared in
[04 §4.8](04-astro-for-theme-developers.md), and the source files cross-reference
each other with the same names. That second row is the clearest argument for Actions:
`<form id="review-form" method="POST" action="/api/reviews">` in
[`reviews/index.astro`](../../apps/storefront/src/pages/reviews/index.astro) does
submit natively with scripting off — and the visitor lands on a page of JSON.
The Action redirects instead, so there is a page to come back to.

---

## 6.5 The cross-service join that is not a join

A product in Medusa gets its reviews through a table whose only payload is two
ids — `\d product_product_review_review` shows `product_id`, `review_id`, and
then only the table's own `id`, timestamps and `deleted_at`. No column carries
meaning. The whole definition is a single `defineLink(product, { review,
isList: true })` call in
[`apps/commerce/src/links/product-review.ts`](../../apps/commerce/src/links/product-review.ts),
quoted with its comments in [05 §5.8](05-medusa-for-woocommerce.md).

That one call creates `product_product_review_review`. Neither module gains a foreign
key, neither imports the other, and the read side is a single `query.graph` call
in
[`store/products/[id]/reviews/route.ts`](../../apps/commerce/src/api/store/products/%5Bid%5D/reviews/route.ts)
that names `entity: "product"` and then fields like `reviews.rating`.
[05 §5.8](05-medusa-for-woocommerce.md) quotes that call in full and lists the
three WooCommerce habits it refuses — enumerating fields instead of `reviews.*`,
guarding against soft-deleted holes, and filtering on `status` in the route
because Query returns data, not policy.

What matters here is what `reviews.rating` is. It **looks** like a relation
traversal and is not: `reviews` is a key invented by the link definition, and
deleting that file makes the field stop existing. Query reads the link table,
fetches from each module separately, and stitches the results in application
code.

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=1&fields=id' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

curl -s -H "x-publishable-api-key: $PK" \
  "http://localhost:9000/store/products/$PID/reviews" \
  | python3 -c '
import json,sys
d = json.load(sys.stdin)
print("product:", d["product"]["title"], "|", d["product"]["handle"])
print("stats:  ", d["stats"])
for r in d["reviews"]: print(" -", r["rating"], r["author_name"], "|", r["title"])'
```

```
product: Dedicated Edge Server | dedicated-edge-server
stats:   {'count': 3, 'average': 4, 'distribution': {'1': 0, '2': 0, '3': 1, '4': 1, '5': 1}}
 - 5 Arnel | Trace from chapter 6
 - 3 Marcus Bell | Fine but overpriced
 - 4 Priya Raman | Good, with one caveat
```

### Inside one database, a join is possible — and still wrong

Both tables live in `medusa_crud`, so you *can* write the SQL. For inspection
only, never from application code:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select p.handle,
       count(r.id) filter (where r.status='approved') as approved,
       round(avg(r.rating) filter (where r.status='approved'),2) as avg
from product p
join product_product_review_review l on l.product_id = p.id
join review r on r.id = l.review_id and r.deleted_at is null
group by p.handle order by p.handle;"
```

```
   handle   | approved | avg  
------------+----------+------
 application-performance-monitoring |        3 | 4.00
 astro-commerce-toolkit             |        4 | 4.00
 global-cdn                         |        3 | 3.67
 certificate-secrets-automation     |        4 | 4.25
 dedicated-edge-server              |        2 | 4.50
(4 rows)
```

Your `dedicated-edge-server` row will differ: it counts the review you created and approved in
§6.4, so running the trace twice moves the number.

It is faster than the HTTP route and it is exactly the coupling the module
system exists to prevent. Move the review module to its own database — which the
design permits — and that query breaks, in a place nobody remembers writing.

### Across the two databases, there is no join and never will be

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c "select p.title, r.rating from posts p join review r on true limit 1;"
```

```
ERROR:  relation "review" does not exist
LINE 1: select p.title, r.rating from posts p join review r on true ...
                                                   ^
```

**Payload content can never be joined to Medusa data.** Not with a plugin, not
with a clever query, not with a view. "Blog posts that mention this product,
sorted by the product's average rating" has no SQL answer here. It has only an
application answer: fetch from both, correlate in TypeScript, accept that the
two halves were read at slightly different moments.

In WordPress that report is one query with two joins, and it is reasonable to
feel the loss. In exchange, nothing in `posts` can be broken by a schema change
in `review`, and the two deploy, migrate, scale and restore independently.
Whether that is worth it depends on whether your content and your commerce
really change at different rates — for a brochure site with a small shop, they
often do not.

---

## 6.6 Thought experiment: put reviews in Payload instead

This is the tempting one. Payload gives you a review collection in about forty
lines, with an admin UI, moderation via a `select` field, and REST for free. So
what actually breaks?

| What you keep | What you lose |
|---|---|
| A generated admin screen, free | the link to a product |
| REST + GraphQL + types, free | `query.graph` across modules |
| Access control as functions | workflow compensation |
| Drafts and version history | the Medusa admin widget on the product page |

Concretely, four things go wrong, in increasing order of seriousness.

**1 · `product_id` becomes an unvalidated string.** Payload has no products, so
the field is `text` and nothing stops a review pointing at `prod_banana`. Today
[`validate-product.ts`](../../apps/commerce/src/workflows/steps/validate-product.ts)
throws `MedusaError.Types.NOT_FOUND` before anything is inserted. To keep that
guarantee in Payload you would put an HTTP call to Medusa inside a
`beforeValidate` hook — so a CMS write now fails when the commerce service is
down, and you have coupled the two in the direction that hurts most.

**2 · `/products` needs two backends per product instead of one.** Today the
grid makes one Medusa call per product. With reviews in Payload it makes one
Medusa call *and* one Payload call per product, and the two answers can disagree
about which products exist.

**3 · The product admin widget has no data source.**
[`apps/commerce/src/admin/widgets/product-reviews.tsx`](../../apps/commerce/src/admin/widgets/product-reviews.tsx)
is the one piece of custom admin UI in this repo — 237 lines putting approve and
reject buttons directly on Medusa's product page, which works only because the
reviews are in the same application. Move them and a moderator edits the product
in one admin and its reviews in another, with no screen showing both.

**4 · Moderation stops being moderation.** Payload's drafts are a two-state
machine. Reviews are three-state — `pending`, `approved`, `rejected` — and
`rejected` is not "unpublished"; it is a decision you must be able to re-read
later. You would model it as a `select` field and lose the version history you
came for.

**Note what does *not* break: nothing technical stops you.** Reviews in
Payload would work. The argument against it is that "show me this product with
its reviews" becomes an application join you write by hand, forever.

---

## 6.7 Thought experiment: put blog posts in Medusa instead

The inverse is less tempting and more instructive, because it shows you exactly
what a config-driven CMS is doing for you.

Count the files each approach costs in this repo:

```bash
find apps/commerce/src -path '*review*' -type f | wc -l
find apps/commerce/src -path '*review*' -type f -name '*.ts*' -exec cat {} + | wc -l
cat apps/cms/src/collections/Posts.ts apps/cms/src/endpoints/postStats.ts \
    apps/cms/src/hooks/slugify.ts | wc -l
```

```
24
1782
285
```

| | Reviews, in Medusa | Posts, in Payload |
|---|---|---|
| Files | 24 | 3 |
| Lines (comments included) | 1,782 | 285 |
| Admin UI | 237 hand-written React lines | generated |
| Migrations | a file per change | `push` in dev, none on disk |
| REST surface | 9 routes you wrote | generated |
| GraphQL | none | generated |
| TypeScript types | hand-written validators | generated (668 lines, `payload-types.ts`) |

⚠️ **Generated types are not shared types.** `apps/cms/src/payload-types.ts`
is imported by nothing — the storefront hand-writes its own shapes in
[`src/lib/types.ts`](../../apps/storefront/src/lib/types.ts) and says why in
that file's header. A generated type stops at the service boundary; across it
you have an HTTP contract and whatever you chose to write down about it.

**That comparison is not apples to apples and is not a verdict.** The review
set includes a workflow, compensation, a link table, a cron job, a subscriber, a
seed script and an admin widget — things `Posts` does not have and mostly does
not need, and both sides are heavily commented because this is a teaching repo.
The honest conclusion is narrower: **Medusa makes you write the plumbing, and in
exchange the plumbing is yours.**

A Medusa "post" would also lack, today: a rich text editor (Payload ships
Lexical), a media pipeline (`Media.ts` declares `thumbnail` 400×300 and `card`
768×512 for `sharp` to generate — 📋 configured but never exercised here, because
the seed uploads nothing and `media` has 0 rows), drafts (`versions: { drafts:
true, maxPerDoc: 10 }` is one line), and any admin screen at all until you write
a React widget for it.

The flip side is real too: if a post ever had to participate in a workflow with
a commercial write — "publish this post and apply the discount it announces" —
Payload has no compensation story and Medusa does.

---

## 6.8 The N+1 on `/products` is left visible on purpose

[`apps/storefront/src/pages/products/index.astro`](../../apps/storefront/src/pages/products/index.astro)
lists products with their average rating, and does it the expensive way:

```ts
const products = await listProducts(24)

const withRatings = await Promise.all(
  products.map(async (product) => {
    try {
      const { stats } = await getProductReviews(product.id)
      return { product, stats }
    } catch {
      return { product, stats: { count: 0, average: 0, distribution: {} } }
    }
  }),
)
```

Count the requests one page render makes:

```bash
BEFORE=$(wc -l < logs/commerce.log)
curl -s -o /dev/null http://localhost:4321/products
sleep 2
tail -n +$((BEFORE+1)) logs/commerce.log | sed -e 's/\x1b\[[0-9;]*m//g' \
  | grep -oE 'GET /store[^ ]*' | sed -e 's/\?.*//' | sort | uniq -c
```

```
      1 GET /store/products
      1 GET /store/products/prod_01M436HVYV1EXC9H7SYAZ6X0KG/reviews
      1 GET /store/products/prod_01M436HVYV6XGSV9KGSJ18PGSZ/reviews
      1 GET /store/products/prod_01M436HVYV5N7NV59ZBC0HF7JJ/reviews
      1 GET /store/products/prod_01M436HVYVJ8JY8M3XFPPW0QGE/reviews
```

Five HTTP requests for four products. At 24 products it is 25, and the page
says so in its own markup rather than hiding it.

**Why it is not simply a bug.** "Products with their ratings" is not a query
anyone can write: products and reviews are different modules, and the only thing
joining them is a link table `query.graph` reads one root entity at a time. The
calls are concurrent, so the wall-clock cost is roughly one round trip rather
than twenty-five — but it is twenty-five units of load on Medusa per page view.

**The fix, when you need it,** is a purpose-built route — `GET
/store/products/ratings?ids=…` — resolving many products in one `query.graph`
call. That is a route you write, which is the recurring shape of this
architecture: the generic layer stops at the module boundary, and batching is an
application concern.

**WordPress is genuinely better here**, and it is worth saying plainly.
WooCommerce never computes this average at read time: it keeps
`_wc_average_rating` and `_wc_review_count` in `wp_postmeta`, recalculated when
a review is approved. A product archive is then one `WP_Query` plus the single
meta-cache query that primes postmeta for the whole result set — the rating is
already there by the time the loop runs. No N+1, no batching route, no
concurrency to reason about. That is a real engineering asset, and it is
available precisely because one schema owns both the product and its reviews —
which is the thing you give up when you split the services. The same trade-off
reappears in [11 · Capstone](../learn/11-capstone.md), where you build a feature
across all three.

---

## 6.9 What this architecture costs

Four costs, all structural. None of them is fixed by better code.

| Cost | Concretely, here |
|---|---|
| Three deploys | `next build`, `medusa build`, `astro build` — no root `build` script exists |
| Three sets of logs | `logs/cms.log`, `logs/commerce.log`, `apps/storefront/.astro/dev.log` |
| No cross-service transaction | compensation stops at Medusa's edge |
| Eventual inconsistency | every read is two reads taken at different moments |

**Three deploys.** There is no single build command, and that is honest rather
than an omission:

```bash
python3 -c "
import json
for a in ['cms','commerce','storefront']:
    print(f'{a:12}', json.load(open(f'apps/{a}/package.json'))['scripts']['build'])"
```

```
cms          cross-env NODE_OPTIONS="--no-deprecation --max-old-space-size=8000" next build
commerce     medusa build
storefront   astro build
```

Three build tools, three `node_modules` trees, three deploy targets. A change
that adds a field to a post and renders it on the storefront is two deploys, and
they must land in the right order or the storefront renders `undefined`.

**Three sets of logs, in two formats.** Payload and Medusa write prose; Astro
writes JSON lines. `npm run logs:errors` greps all three at once, and the
asymmetry is left visible rather than papered over
([12 §12.6](../learn/12-operating-it.md)).

**No transactions across services.** Trace B guarantees that a review and its
link row both exist or neither does — **inside Medusa**. Nothing guarantees
anything across the two databases. If a feature ever needs "create a post and a
review atomically", the answer is that it cannot, and the design question
becomes which of the two is allowed to be a dangling leftover.

**Eventual inconsistency.** Every storefront page is a composite of reads taken
at different moments, each able to fail on its own. The repo makes that decision
twice, in opposite directions.
[`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) **swallows**
the failure — a `try`/`catch` around `getSiteSettings()` that leaves `settings`
as `null` — because a layout that throws breaks every page at once
([04 §4.3](04-astro-for-theme-developers.md) has the file).
[`settle.ts`](../../apps/storefront/src/lib/settle.ts) **reports** it, with the
duration, because on the dashboard "Medusa answered, in 4 seconds" is a
different operational fact from "Medusa answered".

⚠️ **Partial failure is the default state of a multi-service frontend, not an
exception to handle later.** Every page decides, per data source, whether a
failure is fatal, degraded or silent. WordPress never asks this question,
because a page that cannot reach the database has already stopped.

Watch it: stop Payload and reload `/`. The dashboard reports which backend
answered and how long it took; the announcement banner simply disappears. The
production gaps this leaves are catalogued in
[09 · To production](../learn/09-to-production.md).

---

## 6.10 When WordPress is still the right answer

Nothing in this chapter argues that this architecture is better. It argues that
it is *different*, and the differences are now concrete enough to choose
between.

| If this is true | Prefer |
|---|---|
| Content and commerce change at the same rate, by the same people | WordPress |
| You need one report joining editorial and commercial data | WordPress |
| One deploy, one backup, one log is a feature | WordPress |
| The team is one or two people | WordPress |
| Content outlives the frontend that renders it | this stack |
| Commerce rules are yours, not a plugin's | this stack |
| Editorial and commerce teams deploy on different days | this stack |
| You need the same data in a website, an app and a kiosk | this stack |

The fastest way to be wrong about this is to adopt three services for a site
that one would have served, and then spend a year rebuilding things WordPress
had on day one — media handling, a page builder, a forms plugin, SEO fields,
multilingual content. Two of those five — SEO fields and multilingual content —
have no presence in this repo at all. The other three exist only in outline:
three `layout` block types on one page, a `media` collection with nothing
uploaded to it, and Actions that cover posts and nothing else.

---

## Check yourself

1. A new requirement arrives: "editors should be able to pin a product to the
   top of a category page." Which service owns the pin, and what does the other
   one hold?
2. Why can trace A be a single Postgres transaction while trace B cannot?
3. `product.reviews` is not a column and not a foreign key. What is it, and
   what makes it stop existing?
4. You write a SQL join across `product` and `review` and it works. Give two
   reasons not to ship it.
5. A review is created and the link step throws. What does the caller see, and
   what is left in each of the two tables?
6. The `/products` page makes 25 requests for 24 products. Describe the route
   you would add, and what you would lose by adding it.
7. Which of the four costs in §6.9 would disappear if both databases were
   merged into one, and which would remain?
8. Name a feature where you would honestly recommend WordPress over this stack
   to a client, and the sentence you would use to explain why.

---

**Next:** [07-cross-cutting.md](07-cross-cutting.md) — the plugins you actually
use: WPML, Gravity Forms, Yoast, UpdraftPlus, Wordfence, and where each one's
job went.
