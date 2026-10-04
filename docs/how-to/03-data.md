# 3 · Data — reading, writing and deleting across three services

> The narrative version of this page is
> [06 · The worked example](../from-wordpress/06-the-worked-example.md), which
> follows one review from a form to a database row. For how Astro runs the code
> below, see [05 · Astro](../learn/05-astro.md). This page is the recipes.

One rule governs everything here, and once you hold it the rest is mechanics.

**Astro has no database.** `WP_Query` opens a MySQL connection and reads
`wp_posts` in the same process that renders your template. Nothing in
`apps/storefront` can do that: it holds no connection string, imports no database
driver and owns no tables. Every read and every write on this stack is an HTTP
request to the service that owns the data, and the only question you ever have to
answer is *which service owns it*.

| What you want | Owned by | Lives in | Reached at |
|---|---|---|---|
| Posts, pages, categories, media, site settings | Payload, `:3000` | `payload_crud` | `/api/<slug>` |
| Products, variants, prices, regions, inventory | Medusa, `:9000` | `medusa_crud` | `/store/*`, `/admin/*` |
| Reviews (a custom module) | Medusa, `:9000` | `medusa_crud` | `/store/reviews`, `/admin/reviews` |
| Anything at all | **Astro, `$SF`** | **nothing** | it only calls the other two |

The two databases cannot JOIN to each other — a Postgres connection belongs to
one database, and these are two. [10 · Databases](../learn/10-databases.md) covers
why that is deliberate.

Every operation below is shown three ways, because you will need all three: from
the **terminal** with `curl`, so you can see the wire format; from **Astro server
code**, using the functions in `src/lib/` that already exist; and from a **browser
form**, which is what your editors will actually use.

Ids in the output are from one real run. Yours will differ.

⚠️ **Every storefront command on this page uses `$SF`, never a hard-coded port.**
Astro 7 backgrounds its own dev server and takes the next free port if 4321 is
busy, so run `cd apps/storefront && npx astro dev status` and set
`SF=http://localhost:4321` — or whatever it printed — before you paste anything
below. The `Origin` header has to match `$SF` too, which is why §3.14 exists.
Payload (`:3000`) and Medusa (`:9000`) do not move.
[04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321) is
the full recipe.

---

## 3.1 How to read Payload content from the terminal

**In WordPress:** `new WP_Query(['posts_per_page' => 3])`, or
`GET /wp-json/wp/v2/posts?per_page=3` if you were already headless.

**Here:** Payload generates a REST route for every collection the moment you
register it. Nobody wrote these handlers.

**Steps**

1. Find the collection slug — the `slug` property in the collection file, e.g.
   [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts).
2. Run the request. **Use `curl -g`** whenever the URL contains `[` or `]`.
3. Pipe it through `python3` rather than reading raw JSON.

```bash
curl -gs 'http://localhost:3000/api/posts?where[title][contains]=stack&depth=0&select[title]=true&select[publishedAt]=true' \
  | python3 -m json.tool
```

**Verify** — the response is an envelope, not a bare array:

```
{
    "docs": [
        {
            "id": 1,
            "title": "What are Payload CMS collections?",
            "publishedAt": "2026-08-30T13:12:12.665Z"
        }
    ],
    "hasNextPage": false,
    "hasPrevPage": false,
    "limit": 10,
    "nextPage": null,
    "page": 1,
    "pagingCounter": 1,
    "prevPage": null,
    "totalDocs": 1,
    "totalPages": 1
}
```

`docs` is your Loop. The rest is what you would otherwise compute from
`$wp_query->max_num_pages` and `found_posts` by hand.

⚠️ **Drop the `-g` and curl fails before it sends anything,** because it reads
`[slug]` as a glob range:

```
curl: (3) bad range in URL position 39:
http://localhost:3000/api/posts?where[slug][equals]=x
                                      ^
```

That looks like a server problem and is not one.

**Going deeper:**
[03 §3.12](../from-wordpress/03-payload-for-acf-and-cpt.md) — the Local API is
`WP_Query`, REST is `wp-json`.

---

## 3.2 The query parameters, and the `WP_Query` argument each one replaces

Keep this table open. Every one of these is a plain query-string parameter —
there is no `meta_query` array, no `tax_query`, nothing to serialise.

| Payload parameter | `WP_Query` equivalent | What it does |
|---|---|---|
| `where[field][operator]=value` | `meta_query`, `post_status`, `s`, `author` | the only filtering mechanism there is |
| `limit=10` | `posts_per_page` | page size (default 10) |
| `page=2` | `paged` | which page |
| `sort=-publishedAt` | `orderby` + `order` | sort; leading `-` means descending |
| `select[title]=true` | `fields` (partial) | return only these fields |
| `depth=1` | *no equivalent* | how far to expand relationships — §3.3 |
| `draft=true` | roughly `post_status => any` | include the draft version (needs auth) |

The operator goes in the second bracket. All six were run against this database:

| Operator | Example | Result here |
|---|---|---|
| `equals` | `where[_status][equals]=published` | exact match |
| `not_equals` | `where[title][not_equals]=x` | `totalDocs 8` |
| `contains` | `where[title][contains]=stack` | `totalDocs 1` |
| `in` | `where[id][in]=1,3` | `totalDocs 2` |
| `greater_than` / `less_than` | `where[publishedAt][greater_than]=2026-09-01` | `totalDocs 6` |
| `exists` | `where[category][exists]=true` | `totalDocs 4` |

Pagination needs no extra work — it is the same envelope every time. Add
`limit=1&page=2` to any of the above and the reply carries
`page 2 of 8 | prevPage 1 | nextPage 3` alongside the single matching doc. That is
your `paginate_links()`, already computed.

⚠️ **What comes back also depends on who is asking.** An anonymous caller never
sees drafts, because `Posts.access.read` returns a *query* rather than `false`. A
missing document may be an access rule, not a bug. That idea has its own section —
[03 §3.9](../from-wordpress/03-payload-for-acf-and-cpt.md) — and this page does
not repeat it.

---

## 3.3 How to decide what `depth` should be

**In WordPress:** nothing to decide. `get_field('category')` hands you an ID or a
`WP_Post` depending on the field's Return Format, and if you want more you call
`get_post()` again — lazily, in-process, for free.

**Here:** there is no "later". The storefront is a different process, so you
declare up front how much of the object graph you want and Payload joins it in one
query.

**Steps**

1. Start at `depth=0`. You get foreign keys.
2. Raise it to `1` only on pages that render the related document.
3. Go above `1` only if you are rendering the tree you asked for.

```bash
curl -gs 'http://localhost:3000/api/posts?limit=1&depth=0&sort=id' \
  | python3 -c 'import json,sys; print("depth=0 ->", json.load(sys.stdin)["docs"][0]["category"])'

curl -gs 'http://localhost:3000/api/posts?limit=1&depth=1&sort=id' \
  | python3 -c '
import json,sys
c=json.load(sys.stdin)["docs"][0]["category"]
print("depth=1 ->", {k: c[k] for k in ("id","name","slug")})
'
```

**Verify**

```
depth=0 -> 1
depth=1 -> {'id': 1, 'name': 'Architecture', 'slug': 'architecture'}
```

Same route, same document, two shapes. `depth` is per **request**, not per field,
so `depth=2` expands relationships *inside* the documents it just expanded.
Categories here hold only `name`, `slug` and `description`, so on this route
`depth=2` returns exactly what `depth=1` did — raise it only when the expanded
document has relationships of its own.

⚠️ **`richText` is JSON, and `depth` will not help.** There is no `the_content()`
here and no HTML anywhere in the response:

```bash
curl -gs 'http://localhost:3000/api/posts?where[slug][equals]=what-are-payload-cms-collections&depth=0' \
  | python3 -c '
import json,sys
c=json.load(sys.stdin)["docs"][0]["content"]
print("type:", type(c).__name__, "| top-level key:", list(c))
print(json.dumps(c["root"]["children"][0])[:160], "…")
'
```

```
type: dict | top-level key: ['root']
{"type": "paragraph", "format": "", "indent": 0, "version": 1, "children": [{"mode": "normal", "text": "Payload owns payload_crud. Medusa owns medusa_crud. Neit …
```

Turning that tree into markup is the storefront's job, in
[`apps/storefront/src/lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts) —
`lexicalToHtml`, `lexicalToText`, `lexicalToPlainParagraphs`.

**Going deeper:** [03 §3.6](../from-wordpress/03-payload-for-acf-and-cpt.md).

---

## 3.4 How to read Medusa products

**In WordPress:** `wc_get_products()`, or a `WP_Query` on the `product` post
type, because WooCommerce products *are* posts.

**Here:** products belong to Medusa's product module and are reached over its
store API, which has one hard requirement WordPress has no analogue for.

**Steps**

1. Get the publishable key — `MEDUSA_PUBLISHABLE_KEY` in
   `apps/storefront/.env`; `npm run bootstrap:commerce` prints it.
2. Send it as `x-publishable-api-key` on **every** `/store/*` request.
3. Ask only for the fields you will render, with `fields=`.

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=3&fields=id,title,handle' \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("count:", d["count"])
for p in d["products"]:
    print(" ", p["id"], p["handle"], "|", p["title"])
'
```

**Verify**

```
count: 15
  prod_01M436HVYV1EXC9H7SYAZ6X0KG dedicated-edge-server | Dedicated Edge Server
  prod_01M436HVYV5N7NV59ZBC0HF7JJ managed-postgresql | Managed PostgreSQL
  prod_01M436HVYV6XGSV9KGSJ18PGSZ application-performance-monitoring | Application Performance Monitoring
```

⚠️ **Forget the header and you get a 400, not a 401** — baffling the first time:

```
{"type":"not_allowed","message":"Publishable API key required in the request header: x-publishable-api-key. You can manage your keys in settings in the dashboard."}
```

It applies to custom routes too; `/store/reviews` without the key also returns
`400`. The key is not a password. It identifies which **sales channel** the
request belongs to, which is how one Medusa serves several storefronts.

⚠️ **Prices need a region, or they simply are not in the response.**
[`medusa.ts`](../../apps/storefront/src/lib/medusa.ts) asks for
`*variants.calculated_price` **and** passes a `region_id`. Drop the region and
the variants come back with no price attached at all — not zero, absent — because
currency, tax and price lists are all region-dependent and Medusa will not guess.
✅ 40 variants and 86 price rows, rendered on `/products` and the detail page.
📋 Stock levels are still fetched by nothing.

**Going deeper:**
[05 · Medusa for WooCommerce](../from-wordpress/05-medusa-for-woocommerce.md).

---

## 3.5 How to read data that spans two modules

**In WordPress:** a `JOIN`. Reviews are comments, products are posts, both live in
one MySQL database, and `$wpdb->get_results()` stitches them in one query.

**Here:** you cannot write that JOIN — `product` belongs to Medusa's product
module and `review` to ours. Medusa's `query.graph` reads the link table and
stitches the result for you.

**Steps**

1. Resolve the handle to a product id.
2. Call the route that owns this read:
   [`apps/commerce/src/api/store/products/[id]/reviews/route.ts`](../../apps/commerce/src/api/store/products/%5Bid%5D/reviews/route.ts).

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
# Take the first product in the catalogue rather than naming a handle — the
# seed data changes, and a hard-coded handle turns this into a 404 the day it does.
PID=$(curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=1&fields=id' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

curl -s -H "x-publishable-api-key: $PK" "http://localhost:9000/store/products/$PID/reviews" \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("product:", d["product"]["handle"], "|", d["product"]["title"])
print("stats:  ", d["stats"])
print("reviews:", len(d["reviews"]))
'
```

**Verify**

```
product: dedicated-edge-server | Dedicated Edge Server
stats:   {'count': 2, 'average': 4.5, 'distribution': {'1': 0, '2': 0, '3': 0, '4': 1, '5': 1}}
reviews: 2
```

The `reviews` key in that route's field list comes from the link definition in
[`links/product-review.ts`](../../apps/commerce/src/links/product-review.ts), not
from a column anywhere. Delete that file and the field stops existing.

⚠️ **Crossing a module boundary carries data, not policy.** `query.graph` returns
every linked review regardless of moderation state, so the route filters
`status === "approved"` itself and strips `status` before responding. If you write
a route like this, filtering is your job.

**Going deeper:** [04 · Medusa](../learn/04-medusa.md) on modules and links.

---

## 3.6 How to read through your own endpoint instead of the backend

**In WordPress:** you would not. The theme and the data are the same process, so a
middle layer has nothing to sit between.

**Here:** the storefront publishes its own `/api/reviews`, which calls Medusa on
the browser's behalf. The payoff is in the first line of output: **the browser
needs no key at all.**

**Steps**

1. Read
   [`src/pages/api/reviews/index.ts`](../../apps/storefront/src/pages/api/reviews/index.ts) —
   a file under `src/pages/api/` that exports `GET` and `POST` *is* the endpoint.
2. Call it with no credentials.
3. Add `?include_pending=true` to make it compose the admin surface instead.

```bash
curl -s "$SF/api/reviews?limit=2" \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("source:", d["source"], "count:", d["count"])
print("keys:  ", sorted(d["reviews"][0].keys()))
'

curl -s "$SF/api/reviews?limit=2&include_pending=true" \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print("source:", d["source"], "count:", d["count"])
print("keys:  ", sorted(d["reviews"][0].keys()))
'
```

**Verify**

```
source: store count: 9
keys:   ['author_name', 'content', 'created_at', 'id', 'rating', 'title']
source: admin count: 15
keys:   ['author_email', 'author_name', 'content', 'created_at', 'deleted_at', 'id', 'rating', 'status', 'title', 'updated_at']
```

One URL, two surfaces, two column sets, and the admin JWT never leaves the server.
`author_email` appears only on the second. Validation happens here too, before
Medusa is troubled:

```bash
curl -s -w '\nHTTP %{http_code}\n' "$SF/api/reviews?limit=999"
```

```
{"error":{"message":"Invalid query parameters.","detail":{"limit":["Too big: expected number to be <=100"]}}}
HTTP 400
```

**Going deeper:**
[06 · The worked example](../from-wordpress/06-the-worked-example.md).

---

## 3.7 How to read data inside an Astro page

**In WordPress:** `have_posts()` / `the_post()`, or a `new WP_Query` at the top of
`archive.php`.

**Here:** the frontmatter between the `---` fences is server-side TypeScript that
runs once per request. You `await` a function from `src/lib/` and the result is in
scope when the markup renders. Do not hand-roll `fetch` in a page — the typed
wrappers exist.

**Steps**

1. Import the function. The catalogue is
   [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts) (`listPosts`,
   `getPostBySlug`, `listCategories`, `getPageBySlug`, `getSiteSettings`,
   `getPostStats`) and [`lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts)
   (`listProducts`, `getProductByHandle`, `listStoreReviews`, `getProductReviews`).
2. `await` it in the frontmatter.
3. Render `docs` with `.map()`.

The archive page,
[`src/pages/posts/index.astro`](../../apps/storefront/src/pages/posts/index.astro),
is one `await`:

```astro
---
// apps/storefront/src/pages/posts/index.astro
…
const { docs: posts, totalDocs } = await listPosts({
  limit: 50,
  depth: 1,
  includeDrafts: true,
  sort: '-updatedAt',
})
---
```

`includeDrafts: true` is the whole difference between the public view and the
editor's view — it makes `listPosts` send the API key.

**When a page needs several services, start them all at once.** The dashboard in
[`index.astro`](../../apps/storefront/src/pages/index.astro) runs five calls in a
single `Promise.all`, each wrapped in
[`settle()`](../../apps/storefront/src/lib/settle.ts) — which turns a rejection
into a value, so Medusa being down leaves the Payload panels rendering normally
instead of blanking the page. Copy that shape for any page that reads from both
backends.

**Verify** — open `$SF/posts` and `$SF/` in a browser.

⚠️ **Sequential `await`s are N network round trips, not N local queries.** Five
`WP_Query` calls cost five local queries on a warm connection; five awaits here are
five hops deep. Writing them sequentially is the commonest way to make this stack
feel slow.

**Going deeper:** [05 · Astro](../learn/05-astro.md).

---

## 3.8 How to add a post from a form, with JavaScript disabled

**In WordPress:** `wp_insert_post()` behind an `admin_post_` action, plus a nonce,
plus `current_user_can()`, plus your own validation and your own redirect. Four
things to remember, every time.

**Here:** an Astro Action with `accept: 'form'`. It ships zero client JavaScript.

**Steps**

1. Open [`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts). One
   namespace, three actions: `post.create`, `post.update`, `post.delete`.
2. Point a form at it —
   [`posts/new.astro`](../../apps/storefront/src/pages/posts/new.astro):

```astro
<!-- apps/storefront/src/pages/posts/new.astro -->
<form method="POST" action={actions.post.create}>
  <PostFormFields categories={categories} errors={fieldErrors} />
  <button class="btn primary" type="submit">Create post</button>
</form>
```

3. Read the result back in the same page's frontmatter:

```astro
---
// apps/storefront/src/pages/posts/new.astro
const result = Astro.getActionResult(actions.post.create)

if (result && !result.error) {
  return Astro.redirect('/posts?created=' + result.data.id)
}

const fieldErrors = result?.error && isInputError(result.error) ? result.error.fields : {}
---
```

**Verify** — fill the form at `$SF/posts/new`, or submit a title
that is too short and watch the validation come back per field:

```bash
curl -s -X POST "$SF/_actions/post.create" \
  -H "Origin: $SF" \
  -F 'title=no' -F 'status=published' -w '\nHTTP %{http_code}\n'
```

```
{"type":"AstroActionInputError","issues":[{"origin":"string","code":"too_small","minimum":3,"inclusive":true,"path":["title"],"message":"Give the post a title of at least 3 characters."}],"fields":{"title":["Give the post a title of at least 3 characters."]}}
HTTP 400
```

That `message` is the one written in `PostFields` in
[`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts). It reaches
the browser with no plumbing in between: no `add_filter`, no error bag, no
redirect carrying a query string. The defensive `if ( ! $title )` checks you
scatter through an ACF template are doing a real job there, because the template
reads whatever the database happens to hold; here the same job is done once, in
the schema, before your handler runs.

⚠️ **Do not curl an Action expecting readable JSON on success.** The success body
is devalue-encoded: a flat array of values plus an index map.

```bash
curl -s -X POST "$SF/_actions/post.create" \
  -H "Origin: $SF" \
  -F 'title=Written through an Action' -F 'status=published'
```

```
[{"id":1,"slug":2,"status":3},78,"written-through-an-action","published"]
```

That means `{ id: 78, slug: 'written-through-an-action', status: 'published' }`.
Actions are built for Astro to consume, not `curl`. For a surface other tools will
call, write an endpoint (§3.6).

⚠️ **Every form value arrives as a string, and an omitted field arrives as `null`,
not `undefined`.** `z.string().optional()` rejects `null`; use `.nullish()`. The
Action file explains this at length because it catches everyone.

**Going deeper:**
[04 · Astro for theme developers](../from-wordpress/04-astro-for-theme-developers.md).

---

## 3.9 How to add a post from the terminal

**In WordPress:** `wp post create --post_title='…' --post_status=publish`.

**Here:** a `POST` to the collection route, with an API key.

**Steps**

1. Read the key — `PAYLOAD_API_KEY` in `apps/storefront/.env`. If it is missing,
   `npm run seed:cms` prints it.
2. Send it as `Authorization: users API-Key <key>`.
3. `POST` JSON to `/api/posts`.

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Written from curl","excerpt":"No admin panel involved.","_status":"published","tags":[{"tag":"cookbook"}]}' \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d["message"])
print({k: d["doc"][k] for k in ("id","title","slug","_status","publishedAt")})
'
```

**Verify**

```
Post successfully created.
{'id': 72, 'title': 'Written from curl', 'slug': 'written-from-curl', '_status': 'published', 'publishedAt': '2026-10-04T09:01:57.677Z'}
```

Two fields you did not send came back filled: `slug`, from the `beforeValidate`
field hook, and `publishedAt`, from the `beforeChange` collection hook. This is the
same write path the admin panel uses.

⚠️ **The auth header is the thing that will cost you an afternoon.** It is the
collection slug, then a literal `" API-Key "`. Not `Bearer`. All three tried
against the same valid key:

```
Bearer        -> 403
API-Key       -> 403
users API-Key -> 201
```

And the `403` body tells you nothing:
`{"errors":[{"message":"You are not allowed to perform this action."}]}`. That one
header is why
[`payload.ts`](../../apps/storefront/src/lib/payload.ts) opens with a 15-line
comment about it.

**Going deeper:**
[03 §3.12](../from-wordpress/03-payload-for-acf-and-cpt.md) — REST versus the
Local API.

---

## 3.10 How to add a review — and what "it runs a workflow" means for you

**In WordPress:** `wp_insert_comment()`. One function, one row, nothing to roll
back; if something downstream fails, the comment is still there.

**Here:** `POST /api/reviews` on the storefront calls `POST /store/reviews` on
Medusa, which runs `createReviewWorkflow`: validate the product → insert the review
→ link it to the product → emit `review.created`. If a later step throws, the
earlier ones are **compensated** — the insert is undone and nothing is left behind.

**Steps**

1. Get a product id (§3.5).
2. `POST` to the storefront's own endpoint. No Medusa credentials needed.

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
# Take the first product in the catalogue rather than naming a handle — the
# seed data changes, and a hard-coded handle turns this into a 404 the day it does.
PID=$(curl -s -H "x-publishable-api-key: $PK" \
  'http://localhost:9000/store/products?limit=1&fields=id' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')

RESP=$(curl -s -X POST "$SF/api/reviews" \
  -H "Origin: $SF" -H 'Content-Type: application/json' \
  -d "{\"product_id\":\"$PID\",\"title\":\"Written from the cookbook\",\"content\":\"Ten characters minimum, so here are rather more than ten.\",\"rating\":4,\"author_name\":\"Arnel\"}")

echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d["message"])
r=d["review"]
print({k: r[k] for k in ("id","title","rating","status")})
'

# Keep the new id — §3.11 and §3.14 below both act on this review.
# Your id will differ from the one in the output; that is the point of capturing it.
RID=$(echo "$RESP" | python3 -c 'import json,sys; print(json.load(sys.stdin)["review"]["id"])')
```

**Verify**

```
Thanks — your review is awaiting moderation.
{'id': '01M432CG6DGPEZVE83PDT9ENB9', 'title': 'Written from the cookbook', 'rating': 4, 'status': 'pending'}
```

`status` is `pending` and you could not have made it otherwise: Medusa's store
validator does not accept a `status` field at all, so a public caller cannot
self-publish. Approving is an admin operation — §3.11.

The body was validated **twice**: once by the storefront's zod schema, again by
Medusa's own validators in `apps/commerce/src/api/store/reviews/validators.ts`.
That is not redundancy to remove. The storefront's check buys a good error message;
Medusa's exists because Medusa is a separate service that must not trust callers.

⚠️ **Try the rollback before you believe the description.** Set
`DEMO_FAIL_LINK_STEP=1` in `apps/commerce/.env`, restart Medusa, and submit again:
the link step throws, the create step's compensation deletes the row, no orphan
survives. The switch is at
[`link-review-to-product.ts:32`](../../apps/commerce/src/workflows/steps/link-review-to-product.ts).

**Going deeper:** [04 · Medusa](../learn/04-medusa.md) on workflows and
compensation — this page deliberately does not re-teach it.

---

## 3.11 How to update — Payload says PATCH, Medusa says POST

**In WordPress:** `wp_update_post()` for both, because both are posts.

**Here:** the two backends disagree about the verb. The disagreement is real, not
a documentation error.

**Steps**

1. Update a Payload document with `PATCH /api/posts/:id` and the API key. Use the
   id §3.9 just created — `72` below.
2. Send the same body as `POST` to the same URL and read the status code.
3. Do both against Medusa's admin surface, with a JWT from
   `POST /auth/user/emailpass`, and watch the answers swap over.

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s -X PATCH http://localhost:3000/api/posts/72 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"excerpt":"Edited in place with PATCH."}' \
  | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(d["message"], "->", {k: d["doc"][k] for k in ("id","slug","excerpt")})
'

curl -s -o /dev/null -w 'POST /api/posts/72 -> %{http_code}\n' \
  -X POST http://localhost:3000/api/posts/72 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' -d '{"excerpt":"x"}'
```

**Verify**

```
Updated successfully. -> {'id': 72, 'slug': 'written-from-curl', 'excerpt': 'Edited in place with PATCH.'}
POST /api/posts/72 -> 404
```

The same two requests against `http://localhost:9000/admin/reviews/<review-id>`,
with `Authorization: Bearer <JWT>`:

```
PATCH /admin/reviews/:id -> 404
POST  /admin/reviews/:id -> 200
```

| | Payload | Medusa admin |
|---|---|---|
| Update verb | `PATCH /api/posts/:id` | `POST /admin/reviews/:id` |
| Wrong verb returns | `404` | `404` |
| Auth | `Authorization: users API-Key <key>` | `Authorization: Bearer <JWT>` |
| Partial update | yes | yes |

Both wrong verbs give `404`, which reads as "that document does not exist" and
means "that route does not exist". Expect to lose ten minutes to this once.

**The fix is not to memorise it.** This is exactly why the BFF exists: the
storefront publishes `PATCH`, because `PATCH` is what a client expects, and
translates once —
[`src/pages/api/reviews/[id].ts`](../../apps/storefront/src/pages/api/reviews/%5Bid%5D.ts)
carries the comment *"PATCH here → POST to Medusa. The whole point of the
translation layer."* The call itself is six lines in
[`medusa-admin.ts`](../../apps/storefront/src/lib/medusa-admin.ts), under a comment
that says *"Normalising that inconsistency behind these two client modules is
precisely the job of a BFF"*:

```ts
// apps/storefront/src/lib/medusa-admin.ts
export function updateAdminReview(id: string, input: AdminUpdateReviewInput): Promise<{ review: AdminReview }> {
  return adminRequest<{ review: AdminReview }>(`/admin/reviews/${id}`, {
    method: 'POST',
    body: input,
  })
}
```

So approving a review from the browser is one ordinary request:

```bash
curl -s -X PATCH "$SF/api/reviews/$RID" \
  -H "Origin: $SF" -H 'Content-Type: application/json' \
  -d '{"status":"approved"}' \
  | python3 -c '
import json,sys
r=json.load(sys.stdin)["review"]
print({k: r[k] for k in ("id","title","rating","status")})
'
```

```
{'id': '01M432CG6DGPEZVE83PDT9ENB9', 'title': 'Written from the cookbook', 'rating': 4, 'status': 'approved'}
```

⚠️ **An HTML form cannot send `PATCH` or `DELETE`** — the spec allows `GET` and
`POST` only. That is why `post.delete` in the Actions file is a form `POST`, and
why the reviews page needs a small `fetch` script to moderate and delete. The
asymmetry is not a design taste; it is HTML.

**Going deeper:**
[06 · The worked example](../from-wordpress/06-the-worked-example.md).

---

## 3.12 How to delete a post — the row is really gone

**In WordPress:** `wp_trash_post()` sets `post_status = 'trash'`;
`wp_delete_post($id, true)` removes it. The trash is the default, and it has saved
you before.

**Here:** there is no trash. `DELETE` on a Payload document removes the row.

**Steps**

1. Count what is there.
2. `DELETE /api/posts/:id` with the API key.
3. Count again, and go looking for the row.

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
P() { docker exec apm-postgres psql -U postgres -d payload_crud -t -A -c "$1"; }

echo "rows_on_disk before : $(P 'select count(*) from posts;')"
curl -s -X DELETE http://localhost:3000/api/posts/72 -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("DELETE               :", d["message"], d["doc"]["slug"])'
echo "rows_on_disk after  : $(P 'select count(*) from posts;')"
echo "row 72 still there  : $(P 'select count(*) from posts where id = 72;')"
echo "version rows for 72 : $(P 'select count(*) from _posts_v where parent_id = 72;')"
echo "deleted_at column   : $(P "select count(*) from information_schema.columns where table_name='posts' and column_name like '%delet%';")"
```

**Verify**

```
rows_on_disk before : 12
DELETE               : Deleted successfully. written-from-curl
rows_on_disk after  : 11
row 72 still there  : 0
version rows for 72 : 0
deleted_at column   : 0
```

Twelve became eleven — and note that `posts` holds drafts too, so this count is
higher than the `totalDocs` an anonymous read reports. There is no `deleted_at`
column on `posts` to check, and the
version history in `_posts_v` went with it. From a browser this is the delete form
on `/posts`, which posts to `actions.post.delete`. No confirmation dialog, no undo.

⚠️ **Deleting a post needs the `admin` role, not just a login.**
`Posts.access.delete` is `req.user?.role === 'admin'`, deliberately stricter than
`update`. The seeded key belongs to an admin, so curl works; an `editor` gets
`403`. That rule protects Payload and nothing else: the storefront has no login at
all, so anyone who can reach the storefront can delete any post through the UI —
deliberate for teaching, not a production posture
([09 §9.5](../learn/09-to-production.md)).

**Going deeper:** [10 · Databases](../learn/10-databases.md).

---

## 3.13 How to delete a review — and why the row is still there afterwards

This is the one that will surprise you most, so it gets the most proof.

**In WordPress:** `wp_delete_comment($id)` without `$force_delete` sets
`comment_approved = 'trash'`; with it, the row goes. Either way **you** chose.

**Here:** every Medusa model carries a `deleted_at` column, and `DELETE` sets it.
The row stays on disk. The API stops returning it. Nobody asked you.

**Steps**

1. Count live rows and total rows separately — the gap is the whole lesson.
2. `DELETE /api/reviews/:id` through the storefront.
3. Count again, then go and look at the row.

```bash
# RID was captured when the review was created in §3.9.
M() { docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c "$1"; }

echo "live / rows on disk before : $(M 'select count(*) filter (where deleted_at is null), count(*) from review;')"
echo "DELETE                     : $(curl -s -X DELETE "$SF/api/reviews/$RID" -H "Origin: $SF")"
echo "live / rows on disk after  : $(M 'select count(*) filter (where deleted_at is null), count(*) from review;')"
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c "select id, title, status, deleted_at from review where id = '$RID';"
echo "link row still there       : $(M "select count(*) from product_product_review_review where review_id = '$RID';")"
curl -s -o /dev/null -w 'GET /api/reviews/:id?admin=true -> %{http_code}\n' \
  "$SF/api/reviews/$RID?admin=true"
```

**Verify**

```
live / rows on disk before : 16|45
DELETE                     : {"id":"01M432CG6DGPEZVE83PDT9ENB9","deleted":true}
live / rows on disk after  : 15|45
             id             |           title           |  status  |         deleted_at         
----------------------------+---------------------------+----------+----------------------------
 01M432CG6DGPEZVE83PDT9ENB9 | Written from the cookbook | approved | 2026-10-04 09:03:05.986+00
(1 row)

link row still there       : 1
GET /api/reviews/:id?admin=true -> 404
```

Read that carefully. `live` dropped by one; **`45` did not move**. The review is
still in the table with its title, its rating and a timestamp — and the API now
reports it as gone. The link row survives too, on purpose.

Three consequences follow, and this repo already handles two of them:

| Consequence | Where it is handled |
|---|---|
| Restoring reattaches the review to its product, free | the compensation in [`delete-review.ts`](../../apps/commerce/src/workflows/steps/delete-review.ts) calls `restoreReviews` |
| The link table can point at a review Query will not return, so `product.reviews` comes back with **holes** | the `Boolean(review)` filter at [`products/[id]/reviews/route.ts:100`](../../apps/commerce/src/api/store/products/%5Bid%5D/reviews/route.ts) |
| A "deleted" review is still personal data on disk | 🚫 nothing in this repo purges it |

The step file says it plainly: *"a soft delete is trivially reversible, so the
compensation is one call and no bookkeeping. If this were a hard delete, rolling
back would mean re-inserting a row and hoping nothing else referenced the old id in
the meantime."*

⚠️ **Two backends, two delete semantics, in one application.** A post is gone; a
review is hidden. If someone asks you for "delete everything for this customer",
Payload's delete satisfies it and Medusa's does not. Say so out loud.

**Going deeper:** [10 · Databases](../learn/10-databases.md) on `deleted_at` across
Medusa's schema.

---

## 3.14 The 403 you will hit on your very first `DELETE`

**In WordPress:** `wp_verify_nonce()`. You generate a nonce, you check it, and if
you forget, nothing stops you.

**Here:** Astro checks the `Origin` header for you, before any of your code runs,
and you did not switch it on.

```bash
curl -s -i -X DELETE "$SF/api/reviews/rev_01" | head -2
curl -s -X DELETE "$SF/api/reviews/rev_01"

curl -s -o /dev/null -w 'with Origin -> %{http_code}\n' \
  -X DELETE "$SF/api/reviews/rev_01" -H "Origin: $SF"
```

```
HTTP/1.1 403 Forbidden
Vary: Origin

Cross-site DELETE form submissions are forbidden
with Origin -> 502
```

`502` is your endpoint answering honestly — Medusa has no review `rev_01`. That is
progress; `403` was the request never arriving.

The exact rule, from `astro/dist/core/app/origin-check.js`: `GET`, `HEAD` and
`OPTIONS` are exempt; for everything else, if the request has a form-like
`Content-Type` (`application/x-www-form-urlencoded`, `multipart/form-data`,
`text/plain`) **or no `Content-Type` at all**, the `Origin` must match. Measured
against this app:

| Request, no `Origin` header | Result |
|---|---|
| `GET /api/reviews` | `200` |
| `POST /api/reviews`, `Content-Type: application/json` | `422` — reached the handler |
| `POST /api/reviews`, `-F` (multipart) | `403` |
| `POST /api/reviews`, `-d` (urlencoded) | `403` |
| `DELETE /api/reviews/x`, no `Content-Type` | `403` |
| `DELETE /api/reviews/x`, `Content-Type: application/json` | `502` — reached the handler |
| `POST /_actions/post.delete`, `-F` | `403` |

⚠️ **This runs before your middleware, so a blocked request is never logged.**
Send two `DELETE`s that differ only in the `Origin` header, then read the request
log:

```bash
curl -s -o /dev/null -w 'with Origin    -> %{http_code}\n' \
  -X DELETE "$SF/api/reviews/rev_csrf_probe" \
  -H "Origin: $SF"
curl -s -o /dev/null -w 'without Origin -> %{http_code}\n' \
  -X DELETE "$SF/api/reviews/rev_csrf_probe"

curl -s "$SF/api/monitor" | python3 -c '
import json,sys
for r in json.load(sys.stdin)["requests"]:
    if "csrf_probe" in r.get("path",""):
        print(r["method"], r["path"], r["status"])
'
```

```
with Origin    -> 502
without Origin -> 403
DELETE /api/reviews/rev_csrf_probe 502
```

One line, not two. [`src/middleware.ts`](../../apps/storefront/src/middleware.ts)
never saw the blocked one. When you are chasing a `403` that does not appear in
your logs at all, this is why.

A browser sends `Origin` automatically on a same-origin `fetch`, so the reviews
page has never hit this. **You will hit it the first time you reach for curl,
Postman or an HTTP file.** The repo's [`docs/requests.http`](../requests.http) and
the Postman collection already set it.

**Going deeper:** [07 · Troubleshooting](../learn/07-troubleshooting.md).

---

## 3.15 "I want to read or write X" → call this

| I want to… | Call | Auth |
|---|---|---|
| List posts / pages / categories | `GET :3000/api/<slug>` | none (published only) |
| List posts **including drafts** | same `+ Authorization: users API-Key <key>` | API key |
| One post by slug | `GET :3000/api/posts?where[slug][equals]=…` | none |
| Expand a relationship | add `depth=1` | — |
| Post counts and aggregates | `GET :3000/api/posts/stats` | optional — it changes the answer |
| Site-wide settings | `GET :3000/api/globals/site-settings` | none |
| Create / update / delete a post from a page | `actions.post.create` / `.update` / `.delete` | — |
| Create a post from a script | `POST :3000/api/posts` | API key |
| Update a post | **`PATCH`** `:3000/api/posts/:id` | API key |
| Delete a post (permanent) | `DELETE :3000/api/posts/:id` | API key, **admin role** |
| List products | `GET :9000/store/products` | `x-publishable-api-key` |
| A product's approved reviews + stats | `GET :9000/store/products/:id/reviews` | `x-publishable-api-key` |
| List approved reviews | `GET $SF/api/reviews` | **none** |
| List all reviews, any status | `GET $SF/api/reviews?include_pending=true` | none — the server holds the JWT |
| Create a review | `POST $SF/api/reviews` | none, `+ Origin` |
| Approve or edit a review | **`PATCH`** `$SF/api/reviews/:id` | none, `+ Origin` |
| Approve or edit a review, direct | **`POST`** `:9000/admin/reviews/:id` | `Bearer <JWT>` |
| Delete a review (soft) | `DELETE $SF/api/reviews/:id` | none, `+ Origin` |
| Any of the above from inside a page | a function in `src/lib/` — never raw `fetch` | handled for you |
| Look at the raw rows | `npm run db:psql` | — |

⚠️ **A psql session can edit rows, and you should not.** Writing directly bypasses
Payload's hooks, Medusa's workflows and the link tables. Read freely; write
through the APIs —
[07 §7.6](07-tools.md#76-read-freely-write-through-the-apis) proves each of those
three claims with a command.

---

## Check yourself

1. Why can you not write one SQL query returning a product and its reviews, and
   what does `query.graph` do instead?
2. A page shows `category: 3` where you expected a name. Which single query
   parameter is wrong, and what does always raising it cost?
3. `Authorization: Bearer <key>` returns `403` with no explanation. What should the
   header be, and why does Payload need that prefix at all?
4. Delete a post and a review, counting rows on disk before and after in each
   database. Now explain the difference to a client who has asked you to delete a
   customer's data.
5. `POST /api/posts/72` returns `404` and the post plainly exists. What happened?
6. An HTML form cannot issue `PATCH`. Name the two workarounds this repo uses, and
   which pages use each.
7. Your curl `DELETE` returns `403` and nothing appears in `/monitor`. What is
   blocking it, and which single header fixes it?
8. `GET /api/reviews` and `GET /api/reviews?include_pending=true` return different
   column sets. Why is that a security property rather than a convenience?

---

**Next:**
[04-stack.md](04-stack.md) — the file layout, why there are three `.env` files and
no root one, how TypeScript works in all three apps, and the terminal commands
worth committing to memory.
