# 5 · Medusa — if you have built WooCommerce stores

> Counterpart in the main course: [04 · Medusa](../learn/04-medusa.md). That
> chapter teaches the machinery. This one translates it.

Read the scope statement first, because it is the difference between learning
something here and being misled by it.

**This repo demonstrates reviews and operations built on Medusa's product
module. It is not a commerce demo.** Nothing in it adds to a cart, takes a
payment, or creates an order. Products, variants, regions, shipping options, tax
regions and inventory levels exist in the database only because the seed script
is Medusa's stock starter seed — and for most of them, **no code in this repo
reads the rows at all**.

That sounds like a weakness and it is the most useful thing about the chapter.
You already know what a WooCommerce order looks like. What you do not know is why
Medusa's architecture is shaped the way it is, and the two pieces of it this repo
*does* exercise in anger — **module isolation with links**, and **workflows with
compensation** — are exactly the two with no WooCommerce equivalent at all.

---

## 5.1 First, the honest inventory — most of it is unused

Every row here was checked against the running system. The label tells you what
you can do with it: ✅ running, 📋 built in but not configured here, 🚫 absent.

| Primitive | Here | WooCommerce counterpart |
|---|---|---|
| Product | ✅ seeded, read by the storefront | `wp_posts` where `post_type='product'` |
| Product variant | ✅ 40 rows, rendered as plan tiers | `post_type='product_variation'` child posts |
| Pricing | ✅ 86 price rows, fetched with a `region_id` | `_price` / `_regular_price` postmeta |
| Region | 📋 1 row, **no code reads it** | roughly: store base country + zones |
| Shipping option | 📋 2 rows, **no code reads it** | `wp_woocommerce_shipping_zone_methods` |
| Tax region | 📋 7 rows, **no code reads it** | `wp_woocommerce_tax_rates` |
| Inventory | 📋 20 items / 20 levels, **no code reads it** | `_stock` / `_stock_status` postmeta |
| Sales channel | ✅ scopes the publishable key | no equivalent |
| **Cart** | 🚫 no code, no UI, **0 rows** | `wp_woocommerce_sessions` + session blob |
| **Checkout** | 🚫 zero occurrences in the repo | the `/checkout` page and its hooks |
| **Order** | 🚫 no code, **0 rows** | `shop_order` posts, or HPOS `wp_wc_orders` |
| **Customer** | 🚫 no code, **0 rows** | `wp_users` + `wp_usermeta` |
| **Payment** | 🚫 a provider id on a region, nothing more | gateway plugins |
| **Promotion / coupon** | 🚫 zero occurrences | `post_type='shop_coupon'` |
| **Price list** | 🚫 zero occurrences | sale prices / dynamic pricing plugins |
| Review | ✅ a custom module, fully exercised | a comment with a rating meta |
| Uptime check | ✅ a second custom module | no equivalent |

Prove the bottom half before you trust anything else in this chapter:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select 'cart' t, count(*) from cart
union all select 'order', count(*) from \"order\"
union all select 'customer', count(*) from customer
union all select 'payment', count(*) from payment
union all select 'fulfillment', count(*) from fulfillment
union all select 'promotion', count(*) from promotion
union all select 'price_list', count(*) from price_list
order by 1;"
```

```
      t      | count
-------------+-------
 cart        |     0
 customer    |     0
 fulfillment |     0
 order       |     0
 payment     |     0
 price_list  |     0
 promotion   |     0
(7 rows)
```

⚠️ **"The tables are empty" is a different claim from "Medusa cannot do this."**
Medusa ships all of it. This repo chose not to use it, so every 🚫 section below
is conceptual and you will not find a command in it.

---

## 5.2 The storage difference is the root of everything else

**WordPress:** `wp_posts` plus `wp_postmeta`, for nearly everything.

WooCommerce was built on a CMS that already had a generic "thing with metadata"
store, so a product became a post and a variation became a *child* post with
`post_parent` pointing at its product. Price, SKU, stock, weight and forty other
attributes became `wp_postmeta` rows, keyed `_price`, `_regular_price`, `_sku`,
`_stock`, `_stock_status`; product attributes are a serialised PHP array in a
single `_product_attributes` row.

This was genuinely clever — WooCommerce inherited revisions, the media library,
capabilities, the admin list tables and the whole plugin ecosystem on day one.
The cost is that "products under €20, in stock, in this category, by price" is a
query with several self-joins against a table where every value is a `longtext`.
WooCommerce felt that and added `wp_wc_product_meta_lookup`, a denormalised table
with price, stock status and rating as typed columns, purely so the shop loop
could be fast. The analytics tables exist for the same reason.

**Medusa starts where those lookup tables ended up.** Every concept gets its own
table with typed columns, and there is no meta table to fall back on.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -c \
  "select count(*) from information_schema.tables where table_schema='public';"
docker exec apm-postgres psql -U postgres -d payload_crud -t -c \
  "select count(*) from information_schema.tables where table_schema='public';"
```

```
   146

    21
```

146 tables for Medusa, 21 for Payload. WordPress core is twelve tables, and a
current WooCommerce install adds a couple of dozen more — but the bulk of the
domain still lives in postmeta. Medusa inverts that ratio completely.

Here is what "typed columns, no meta table" looks like for a model this repo
actually wrote:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "\d review"
```

```
                              Table "public.review"
    Column    |           Type           | Collation | Nullable |     Default
--------------+--------------------------+-----------+----------+-----------------
 id           | text                     |           | not null |
 title        | text                     |           | not null |
 content      | text                     |           | not null |
 rating       | integer                  |           | not null |
 author_name  | text                     |           | not null |
 author_email | text                     |           |          |
 status       | text                     |           | not null | 'pending'::text
 created_at   | timestamp with time zone |           | not null | now()
 updated_at   | timestamp with time zone |           | not null | now()
 deleted_at   | timestamp with time zone |           |          |
Indexes:
    "review_pkey" PRIMARY KEY, btree (id)
    "IDX_review_deleted_at" btree (deleted_at) WHERE deleted_at IS NULL
    "IDX_review_status_created_at" btree (status, created_at) WHERE deleted_at IS NULL
Check constraints:
    "review_status_check" CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))
```

`rating` is an `integer`, not a `longtext` holding `"4"`. The status enum is a
check constraint Postgres enforces. The composite index exists because reviews
are read "approved, newest first" and the model says so.

Both schemas in full are in [10 · Databases](../learn/10-databases.md).

⚠️ **There is no `postmeta` escape hatch.** 71 of the 146 tables here carry a
`metadata` jsonb column, but not one index in the database mentions it and
nothing in this repo queries it. A new attribute means a column and a migration.
That is more ceremony than `update_post_meta()`, and it is the trade you are
making.

---

## 5.3 Products and variants: real, seeded, and readable

**WordPress:** a `product` post with `product_variation` children.

Medusa's split is the same idea: a `product` has the title, description, handle
and thumbnail; a `product_variant` has the SKU and is the thing actually bought.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select p.title as product, v.title as variant, v.sku
from product p join product_variant v on v.product_id = p.id
where p.deleted_at is null
order by p.title, v.sku limit 8;"
```

```
              product               |       variant        |     sku
------------------------------------+----------------------+-------------
 Application Performance Monitoring | 30 day traces        | APM-30
 Application Performance Monitoring | 7 day traces         | APM-7
 Application Performance Monitoring | 90 day traces        | APM-90
 Astro Commerce Toolkit             | Developer            | AS-COM-DEV
 Astro Commerce Toolkit             | Team · 5 seats       | AS-COM-TEAM
 Certificate & Secrets Automation   | Business · unlimited | SEC-BIZ
 Certificate & Secrets Automation   | Team · 25 secrets    | SEC-TEAM
 Dedicated Edge Server              | 16 core · 64 GB      | METAL-16
(8 rows)
```

Note that `product_variant` has a real `product_id` column. **Variants are not a
separate module** — they live inside the product module, where a foreign key is
legal. The "no foreign keys" rule in §5.7 is about crossing *module* boundaries,
not about tables in general.

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s 'http://localhost:9000/store/products?limit=1&fields=id,title,handle' \
  -H "x-publishable-api-key: $PK" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("count", d["count"]); print(sorted(d["products"][0].keys()))'
```

```
count 4
['handle', 'id', 'title']
```

📋 **The storefront never shows a variant.** The grid at
[`products/index.astro`](../../apps/storefront/src/pages/products/index.astro)
lists products; the detail page at
[`products/[handle].astro`](../../apps/storefront/src/pages/products/%5Bhandle%5D.astro)
shows title, description, rating and reviews. No size picker, no stock, no buy
button. The hand-written `Product` type in
[`lib/types.ts`](../../apps/storefront/src/lib/types.ts) even declares an
optional `variants` array, and nothing ever asks for it.

---

## 5.4 📋 Price is computed in a context, not stored on the product

**WordPress:** `get_post_meta($id, '_price', true)` — one number, on the
variation, in the store's one currency.

This is the biggest conceptual jump in Medusa's data model, and worth
understanding even though this repo never uses it.

A Medusa variant has no price column. It links to a **price set**, which holds
many **prices**, each with a currency and optional rules. The 40 variants here
own 20 price sets carrying 40 price rows — eur and usd each. The other 2 price
sets and 6 rows in the database belong to the two shipping options, which are
priced the same way:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select v.sku, p.currency_code, p.amount
from product_variant v
join product_variant_price_set vps on vps.variant_id = v.id
join price p on p.price_set_id = vps.price_set_id
where v.sku in ('PG-DEV','PG-PROD') order by v.sku, p.currency_code;"
```

```
   sku   | currency_code | amount
---------+---------------+--------
 PG-DEV  | eur           |     19
 PG-DEV  | usd           |     23
 PG-PROD | eur           |     79
 PG-PROD | usd           |     95
(4 rows)
```

Because there are two prices and no single correct one, **the API returns no
price unless you say who is asking**:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s 'http://localhost:9000/store/products?limit=1' -H "x-publishable-api-key: $PK" \
  | python3 -c 'import json,sys; v=json.load(sys.stdin)["products"][0]["variants"][0]; print("calculated_price:", v.get("calculated_price"))'
```

```
calculated_price: None
```

Now supply the seeded region:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
REG=$(docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c 'select id from region limit 1')
curl -s "http://localhost:9000/store/products?limit=1&region_id=$REG&fields=id,title,variants.sku,*variants.calculated_price" \
  -H "x-publishable-api-key: $PK" \
  | python3 -c '
import json,sys
p = json.load(sys.stdin)["products"][0]
print(p["title"])
for v in p["variants"][:2]:
    cp = v.get("calculated_price") or {}
    print(" ", v.get("sku"), cp.get("calculated_amount"), cp.get("currency_code"))'
```

```
Dedicated Edge Server
  METAL-16 219 eur
  METAL-32 389 eur
```

`calculated_price` answers "what does *this* customer pay for *this* variant
right now", resolved from the price set plus the region, any price list and any
promotion. WooCommerce computes the same thing — in PHP, inside
`WC_Product::get_price()` and the filters hanging off it, with the base value in
postmeta. Medusa made the calculation a module with its own tables.

📋 **This repo never asks for a price.** Its client requests five fields and none
of them is one:

```ts
// apps/storefront/src/lib/medusa.ts
export async function listProducts(limit = 20): Promise<Product[]> {
  const { products } = await sdk.store.product.list({
    limit,
    fields: 'id,title,handle,description,thumbnail',
  })
  …
}
```

⚠️ **`amount` is a `numeric` holding `10`, not `1000`.** Medusa 1 stored minor
units; Medusa 2 does not. If you have read older tutorials or migrated a v1
store, this is the detail that silently multiplies every price by a hundred.

---

## 5.5 📋 Regions, shipping, tax and inventory: rows nobody reads

**WordPress:** store base location, shipping zones with methods,
`wp_woocommerce_tax_rates`, and `_stock` / `_stock_status` postmeta.

Medusa's equivalents are all here as rows, and all of them are dead weight in
this repo. No route, page, script or widget touches them.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select 'region' t, count(*) from region
union all select 'region_country (assigned)', count(*) from region_country where region_id is not null
union all select 'tax_region', count(*) from tax_region
union all select 'shipping_option', count(*) from shipping_option
union all select 'stock_location', count(*) from stock_location
union all select 'inventory_item', count(*) from inventory_item
union all select 'inventory_level', count(*) from inventory_level
union all select 'sales_channel', count(*) from sales_channel
order by 1;"
```

```
             t             | count
---------------------------+-------
 inventory_item            |    20
 inventory_level           |    20
 region                    |     1
 region_country (assigned) |     7
 sales_channel             |     1
 shipping_option           |     2
 stock_location            |     1
 tax_region                |     7
(8 rows)
```

| Medusa concept | WooCommerce analogue | Honest difference |
|---|---|---|
| `region` | store base country | a region owns a **currency**, payment providers and a country list |
| `region_country` | shipping zone locations | countries are a global list (250 rows), assigned to a region |
| `tax_region` | `wp_woocommerce_tax_rates` | per country, with its own module and provider interface |
| `shipping_option` | zone methods | an option belongs to a **fulfillment set**, not to a product |
| `stock_location` | no core equivalent | multi-warehouse is core, not a plugin |
| `inventory_item` / `_level` | `_stock` postmeta | a separate module, so one item can back several variants |
| `sales_channel` | no equivalent | scopes which products a storefront key may see |

Sales channel is ✅ rather than 📋 for one narrow reason: `bootstrap.ts` links the
publishable API key to it, which is what makes `/store/products` return anything
at all (§5.10).

**Core multi-warehouse inventory is a real advantage and it is also why there are
146 tables.** You pay for that generality in every migration and every query
whether or not you have a second warehouse. For a single-currency,
single-warehouse shop, postmeta is less machinery for the same result.

Treat this whole section as "built in, not configured here" — the same category
as Payload localisation in
[03 · Payload for ACF and CPT](03-payload-for-acf-and-cpt.md). If you ever turn
it on in anger, start from [09 · To production](../learn/09-to-production.md).

---

## 5.6 🚫 Everything you know best is the part this repo does not have

**This is where your WooCommerce knowledge is deepest and this repo has least to
show you.** So: the mapping is generous, the code is illustration only, and the
proof of the gap is the zero-row query in §5.1.

| Medusa | WooCommerce | The difference that matters |
|---|---|---|
| `cart` + `cart_line_item` | `wp_woocommerce_sessions` blob | a Medusa cart is a **durable row with an id** |
| `POST /store/carts/:id/complete` | `woocommerce_checkout_process` | completion is one call that runs a workflow |
| `order`, `order_line_item` | `shop_order` posts, or HPOS `wp_wc_orders` | an order is immutable; changes are edits, returns, exchanges, claims |
| `customer`, `customer_address` | `wp_users` + `wp_usermeta` | a customer is not a CMS user |
| `promotion`, `promotion_rule` | `shop_coupon` posts | rules are rows, so they are queryable |
| `price_list` | sale price / dynamic pricing plugins | a set of overriding prices with a window and rules |
| `payment_collection`, `payment_session` | gateway plugin + order meta | payment is its own module, separate from the order |
| `fulfillment`, `fulfillment_set` | shipment tracking plugins | fulfilment is core and separate from the order |

Three structural differences matter more than the table.

**A Medusa cart is a database row, not a session.** It has an id you can email
someone, and an abandoned cart is just a row with no completion. WooCommerce
needs a plugin for abandoned-cart recovery because the cart lives in the session
store and gets swept.

**An order is immutable.** In WooCommerce you change an order by changing its
meta. In Medusa you record a *change* against it and the current state is
derived. More machinery; the history is never lost. Worth knowing that
WooCommerce moved the same direction — recent versions default new installs to
HPOS, with dedicated `wp_wc_orders` tables instead of `shop_order` posts.

**Customers are not users.** `wp_users` carries shop customers, editors and
administrators in one table, which is why capability plugins exist. Medusa keeps
`customer` and the admin `user` in different modules entirely.

🚫 **Illustration only. No file in this repo contains this, and the chapter will
not walk you through running it here.**

```ts
// 🚫 NOT IN THIS REPO — Medusa's built-in store surface, for orientation only.
const { cart } = await sdk.store.cart.create({ region_id: regionId })
await sdk.store.cart.createLineItem(cart.id, { variant_id: variantId, quantity: 2 })
await sdk.store.cart.update(cart.id, { email, shipping_address })
const { order } = await sdk.store.cart.complete(cart.id)
```

Those method names are not invented for the chapter. All four are declared in
`@medusajs/js-sdk`, which is installed here — `create`, `update`, `createLineItem`
and `complete` all sit on `sdk.store.cart` in
`apps/storefront/node_modules/@medusajs/js-sdk/dist/store/index.d.ts`. The repo's
own wrapper names two of them in its header, while explaining why it cannot use
the SDK for reviews:

```ts
// apps/storefront/src/lib/medusa.ts
/**
 * `@medusajs/js-sdk` has typed methods for Medusa's BUILT-IN routes:
 *
 *   sdk.store.product.list()      sdk.store.cart.create()
 *   sdk.store.product.retrieve()  sdk.store.order.list()   …
 *
 * It has nothing for `/store/reviews`, because we invented that route. …
 */
```

⚠️ **Do not take §5.6 as evidence that any of this works the way it is described
here.** It is an honest summary written without a running example to check it
against. Everything else in this chapter has output pasted underneath it; this
section deliberately does not.

---

## 5.7 Module isolation vs hooking into core — the central idea

**WordPress:** `add_filter('woocommerce_get_price_html', …)`,
`add_action('woocommerce_checkout_order_processed', …)`, `global $wpdb`, and a
`JOIN` against any table you like.

WooCommerce's extension model is total access. Every meaningful moment fires a
hook, every hook sees and changes everything, and where no hook exists you query
the database directly. That is why the plugin ecosystem is the size it is — and
why upgrading a store with thirty plugins is frightening. Nothing records who may
depend on what, so every dependency is discovered by breakage.

Medusa 2 chose the opposite. **A module knows nothing about any other module.**
No imports, no foreign keys across the boundary, no joins. The review module is a
complete example: a model, a service, a migration, and it has never heard of
products.

```ts
// apps/commerce/src/modules/review/models/review.ts
/**
 * Notice what is NOT here: any reference to a product. Modules in Medusa v2 are
 * isolated — this module cannot import Product and has no foreign key to it. The
 * association lives in a separate link table defined in src/links/.
 */
const Review = model
  .define("review", {
    id: model.id().primaryKey(),

    title: model.text(),
    content: model.text(),
    …
    status: model
      .enum(["pending", "approved", "rejected"])
      .default("pending"),
  })
  .indexes([
    {
      on: ["status", "created_at"],
    },
  ])
```

[`apps/commerce/src/modules/review/models/review.ts`](../../apps/commerce/src/modules/review/models/review.ts)

The same discipline shows in the service. `getRatingStats` takes review ids, not
a product id, and says why:

```ts
// apps/commerce/src/modules/review/service.ts
  /**
   * Deliberately takes ids rather than a product id: this module does not know
   * that products exist. The caller resolves product → review ids through the
   * link table first, then asks this service to do the arithmetic. Keeping the
   * dependency pointing that way is what keeps the module isolated.
   */
  async getRatingStats(reviewIds: string[]): Promise<{ … }> {
```

Check it in the database — no foreign key leaves `review`, and none points at it:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select conname, conrelid::regclass as from_table, confrelid::regclass as to_table
from pg_constraint
where contype='f'
  and (conrelid::regclass::text='review' or confrelid::regclass::text='review');"
```

```
 conname | from_table | to_table
---------+------------+----------
(0 rows)
```

**What isolation buys.** Modules are separately migratable and separately
deployable. Delete `src/links/` and both modules still compile. Upgrading Medusa
cannot break the review module through a changed product schema, because the
review module never referenced it. The boundary is written down, in one file,
rather than discovered when a release breaks.

**What it costs.** Everything you did with a `JOIN` now needs a plan, and there
is no equivalent of `add_filter('woocommerce_get_price_html')` — you cannot reach
into the pricing module and change how it prints. You get a route, a workflow, a
subscriber or a link, and nothing else. The N+1 on the products grid (§5.8)
exists for exactly this reason, and the page labels it rather than hiding it.

⚠️ **Isolation is architectural, not enforced by Postgres.** All 146 tables are
in one schema in one database:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select count(distinct table_schema) as schemas, count(*) as tables
from information_schema.tables where table_type='BASE TABLE'
  and table_schema not in ('pg_catalog','information_schema');"
```

```
 schemas | tables
---------+--------
       1 |    146
(1 row)
```

So you *can* write `select … from product join product_product_review_review …`
and it will work. It will also break the moment Medusa splits that module onto
its own database, which is the whole point. The discipline is yours to keep.
Module anatomy and the six steps to change a model are in
[04 · Medusa](../learn/04-medusa.md) §4.2–4.3.

---

## 5.8 Links and Query: the JOIN you are not allowed to write

**WordPress:** no equivalent — you would just write the join.

If modules cannot reference each other, how does a review attach to a product?
A **link**: a third table, owned by neither module, holding nothing but two ids.

```ts
// apps/commerce/src/links/product-review.ts
/**
 * `defineLink` creates a THIRD table that holds nothing but the two ids:
 *
 *   product_product_review_review
 *   ├── product_id
 *   └── review_id
 *
 *   • Neither module gains a dependency. You could delete src/links/ and both
 *     modules would still compile and run — you would just lose the association.
 */
export default defineLink(
  ProductModule.linkable.product,
  {
    linkable: ReviewModule.linkable.review,
    isList: true,
  }
)
```

[`apps/commerce/src/links/product-review.ts`](../../apps/commerce/src/links/product-review.ts)

That one call generated the table — and, the part worth pausing on, the table has
no foreign keys either:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select count(*) as fk_constraints from pg_constraint
where contype='f' and conrelid::regclass::text='product_product_review_review';"
```

```
 fk_constraints
----------------
              0
(1 row)
```

A WordPress developer reads that as a bug. It is the design: a foreign key would
require both tables to live in the same database forever.

The read side is **Query**. Give it a root entity and a field list and it
resolves across the link for you:

```ts
// apps/commerce/src/api/store/products/[id]/reviews/route.ts
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      // Explicit — see the note above. `status` is fetched so this route can
      // filter on it, then dropped before the response is sent.
      "reviews.id",
      "reviews.title",
      "reviews.content",
      "reviews.rating",
      "reviews.author_name",
      "reviews.status",
      "reviews.created_at",
    ],
    filters: { id: req.params.id },
  })
```

[`apps/commerce/src/api/store/products/[id]/reviews/route.ts`](../../apps/commerce/src/api/store/products/%5Bid%5D/reviews/route.ts)

Run it:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
PID=$(curl -s 'http://localhost:9000/store/products?limit=1&fields=id' \
  -H "x-publishable-api-key: $PK" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["products"][0]["id"])')
curl -s "http://localhost:9000/store/products/$PID/reviews" -H "x-publishable-api-key: $PK" \
  | python3 -c '
import json,sys
d = json.load(sys.stdin)
print("top level  :", sorted(d.keys()))
print("product    :", d["product"]["title"])
print("review keys:", sorted(d["reviews"][0].keys()))
print("stats keys :", sorted(d["stats"].keys()))'
```

```
top level  : ['product', 'reviews', 'stats']
product    : Dedicated Edge Server
review keys: ['author_name', 'content', 'created_at', 'id', 'rating', 'title']
stats keys : ['average', 'count', 'distribution']
```

One request, one product, its reviews from another module, and an aggregate — and
look at what is **not** in `review keys`. The route fetched `reviews.status` so it
could filter on it, then stripped it before responding. `author_email` was never
requested at all.

Three things in that route a WooCommerce habit would get wrong:

| Habit | What the route does | Why |
|---|---|---|
| `reviews.*` | enumerates every field | `*` would put `author_email` on a public endpoint |
| trust the array | drops falsy entries behind a type guard | soft-deleted reviews keep their link row, so Query returns **holes** |
| assume policy crosses | filters `status === 'approved'` here | Query gives you data, not policy |

The second is the subtle one. The delete workflow deliberately leaves the link
row so a restore reattaches the review to its product — so the link table can
point at a review that generated queries no longer return:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select
  (select count(*) from product_product_review_review) as link_rows,
  (select count(*) from review) as review_rows,
  (select count(*) from review where deleted_at is null) as live_reviews;"
```

```
 link_rows | review_rows | live_reviews
-----------+-------------+--------------
        23 |          23 |           14
(1 row)
```

Your numbers will differ — every review you create adds a row. The invariant
is what matters: `link_rows` never falls when a review is soft-deleted, so
`live_reviews` is always the smaller number, and Query hands back one hole per
difference.

⚠️ **The N+1 on the products grid is the direct cost of this design, and the page
says so out loud.** `listProducts()` is one request; then one
`getProductReviews()` per product, because "products with their ratings" is not
one query when ratings live in another module. The fix is a route that batches
many products into one `query.graph` call —
[06 §6.8](06-the-worked-example.md) counts the requests and sketches it, and
[05 · Astro](../learn/05-astro.md) has the pattern on the Astro side.

---

## 5.9 Workflows and compensation: the thing WooCommerce never gave you

**WordPress:** no equivalent. Read this section twice.

**The problem, in WooCommerce terms.** An order is placed. You reduce stock,
write order items, charge the gateway, create a shipment in a 3PL and push the
customer to a CRM. The gateway succeeds; the 3PL call times out. What is in your
database now? An order marked processing, stock already reduced, money already
taken, nothing shipped. There is no transaction across those steps — MySQL's
ended at the last `$wpdb` write and the HTTP calls were never in one. So you
write a cleanup routine, or you fix it by hand from the admin at 7am.

**Medusa's answer.** A workflow is a sequence of steps, and each step may declare
a **compensation** function. If any step fails, every completed step's
compensation runs in reverse. The engine persists this, so the rollback survives
a crash mid-sequence.

```ts
// apps/commerce/src/workflows/create-review.ts
  (input: CreateReviewWorkflowInput) => {
    // 1. Cheap read-only guard, first — so we never roll back for a bad id.
    validateProductStep({ product_id: input.product_id })

    // 2. Insert the row.
    const review = createReviewStep({ … })

    // 3. Associate it with the product via the link table.
    linkReviewToProductStep({ review_id: review.id, product_id: input.product_id })

    // 4. Announce it.
    emitEventStep({ eventName: "review.created", data: { … } })

    return new WorkflowResponse(review)
  }
```

[`apps/commerce/src/workflows/create-review.ts`](../../apps/commerce/src/workflows/create-review.ts)

| Step | Compensation | Note |
|---|---|---|
| `validate-product` | **none** | read-only; the third argument is omitted on purpose |
| `create-review` | hard-deletes the row | guarded `if (!id) return` |
| `link-review-to-product` | `link.dismiss(...)` | undo the association, not the records |
| `emitEventStep` | n/a | emitting *from the workflow* means no event fires for a rolled-back review |

The shape that makes it work is `StepResponse`'s two arguments:

```ts
// apps/commerce/src/workflows/steps/create-review.ts
 *   new StepResponse(output, compensateInput)
 *                    ^^^^^^  ^^^^^^^^^^^^^^^
 *                    what later steps and the caller see
 *                            what THIS step's compensation receives if a LATER
 *                            step fails
```

Compensating an update is less obvious than compensating a create.
[`steps/update-review.ts`](../../apps/commerce/src/workflows/steps/update-review.ts)
shows the pattern: read the previous values **before** writing, snapshot only the
fields this call changes, and restore them on rollback. Snapshotting the whole
row would clobber a concurrent change to a field you never touched.

### Watch it happen

```bash
npm run test:compensation
```

```
── 1. the workflow succeeds normally ──
  PASS  a successful run inserts one review
  PASS  a successful run inserts one link
  PASS  the review is linked to the product

── 2. the workflow fails at the link step ──
  PASS  the failure propagates to the caller
  PASS  no orphan review — 23 → 23
  PASS  no orphan link — 23 → 23
  PASS  the rolled-back row does not exist even as a soft delete — none

✓ compensation holds — a failed workflow left nothing behind
```

The real run prints each line prefixed `info:` along with Medusa's boot
chatter; the pairs of numbers are your current row counts, and they climb by one
every time you run it, because part 1 leaves its successful review behind. What
must hold is that the two numbers in each pair are equal.

That is the whole argument, measured. The failure is injected by a flag the step
reads at execution time, so no restart is needed:

```ts
// apps/commerce/src/workflows/steps/link-review-to-product.ts
    if (process.env.DEMO_FAIL_LINK_STEP === "1") {
      throw new Error(
        "DEMO_FAIL_LINK_STEP=1 — failing on purpose so you can watch the workflow compensate."
      )
    }
```

Note the last assertion. Create's compensation is a **hard** delete, so the row
must be gone entirely rather than soft-deleted — it should never have existed.
Contrast the *delete* workflow, whose rollback is `restoreReviews`. Soft delete
is the default for generated deletes precisely so rollback is possible.

The engine wrote the rollback down, because these workflows declare
`store: true, retentionTime: 3600`:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select distinct workflow_id, state from workflow_execution order by 1,2;"
```

```
  workflow_id  |  state
---------------+----------
 create-review | done
 create-review | reverted
 delete-review | done
 update-review | done
(4 rows)
```

`reverted` is the state a rolled-back run ends in — the compensations ran and the
engine wrote it down. Swap `distinct` for `count(*) … group by` to see how many of
each; those numbers move, because retention is one hour and rows age out.

⚠️ **Retention is per-workflow, not global.** A workflow without `retentionTime`
leaves no row, so "no failed workflows" never means "no failures" unless you know
every workflow opted in. [12 · Operating it](../learn/12-operating-it.md) §12.4
is about exactly this trap.

**Reach for a workflow when** an operation writes in more than one place — two
modules, a module plus a link, a module plus a third-party API. **Avoid it when**
the operation is a single write to a single module: you would pay ceremony for
nothing.

---

## 5.10 Two API surfaces, because the credential says who is asking

**WordPress:** one REST namespace, `/wp-json/wc/v3/*`, authenticated with a
consumer key and secret per integration, scoped read / write / read-write.

Medusa splits the API in two, and the split is about *who the caller is*:

| | `/store/*` | `/admin/*` |
|---|---|---|
| Caller | shoppers, your storefront | staff, your dashboard |
| Credential | `x-publishable-api-key` header | `Authorization: Bearer <JWT>` |
| Scope | the sales channels the key is linked to | everything |
| In this repo | [`lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts) | [`lib/medusa-admin.ts`](../../apps/storefront/src/lib/medusa-admin.ts) |
| Rate limited | yes, `/store/*` only | **no**, deliberately |

A WC consumer key/secret pair is closest to the **admin** credential: a
full-access secret you keep on a server. The publishable key has no WooCommerce
equivalent. WooCommerce's public product data is rendered by the theme, and where
it does expose a public API — the Store API at `/wp-json/wc/store/v1/*` — that
API takes no key at all. Medusa's publishable key is not a secret either; it is a
*scope selector* naming which sales channel's catalogue this storefront sees. It
is also mandatory, including on routes you wrote yourself:

```bash
curl -s 'http://localhost:9000/store/products?limit=1'
```

```
{"type":"not_allowed","message":"Publishable API key required in the request header: x-publishable-api-key. You can manage your keys in settings in the dashboard."}
```

| Env var | Surface | Obtained by |
|---|---|---|
| `MEDUSA_PUBLISHABLE_KEY` | `/store/*` | `npm run bootstrap:commerce` |
| `MEDUSA_ADMIN_EMAIL` / `_PASSWORD` | `/auth/user/emailpass` → JWT → `/admin/*` | `npm --prefix apps/commerce run user` |
| `PAYLOAD_API_KEY` | Payload — a different service | `npm run seed:cms` |

None is `PUBLIC_`-prefixed, so Astro strips them from the client bundle entirely.
The admin JWT is fetched once and cached in module scope:

```ts
// apps/storefront/src/lib/medusa-admin.ts
/**
 *   /store/*  →  x-publishable-api-key   public, sales-channel scoped
 *   /admin/*  →  Authorization: Bearer <JWT>   full access
 *
 * The JWT comes from POST /auth/user/emailpass. It is cached in module scope for
 * its lifetime, so a burst of admin calls performs one login rather than N.
 */
```

The two surfaces return different data for the same entity, which is the whole
reason the review model has a `status` column. The store list returns six fields
and only approved rows:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s 'http://localhost:9000/store/reviews?limit=2' -H "x-publishable-api-key: $PK" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("count:", d["count"]); print("fields:", sorted(d["reviews"][0].keys()))'
docker exec apm-postgres psql -U postgres -d medusa_crud -c \
  "select status, count(*) from review where deleted_at is null group by status order by 1;"
```

```
count: 9
fields: ['author_name', 'content', 'created_at', 'id', 'rating', 'title']

  status  | count
----------+-------
 approved |     9
 pending  |     3
 rejected |     2
(3 rows)
```

Six fields, and `author_email` is not one of them — done with an explicit
`select` in the route, not by deleting keys afterwards. **Your totals will differ
from mine; what must hold is that the store `count` and the `approved` count are
the same number.** If they ever diverge, the store surface has started leaking.

⚠️ **`/admin/reviews/:id` is updated with POST, not PATCH.** That is Medusa's
convention, not a mistake, and the Astro BFF normalises it: the storefront's own
`/api/reviews/[id]` accepts PATCH and translates. If you come from
`PUT /wp-json/wc/v3/products/:id`, this is the kind of seam a BFF exists to hide
— see [05 · Astro](../learn/05-astro.md).

---

## 5.11 The admin widget: the one custom admin UI in this repo

**WordPress:** `add_meta_box()`, or a WooCommerce product data panel.

Medusa's dashboard is a React app that scans `src/admin/widgets/**` at build
time. A file becomes a widget by default-exporting a component and exporting a
config naming a **zone**:

```tsx
// apps/commerce/src/admin/widgets/product-reviews.tsx
/**
 * The zone determines where this renders. Other useful zones follow the same
 * `<entity>.<page>.<position>` shape, e.g. `order.details.before`,
 * `customer.details.after`, `product.list.before`.
 */
export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductReviewsWidget
```

[`apps/commerce/src/admin/widgets/product-reviews.tsx`](../../apps/commerce/src/admin/widgets/product-reviews.tsx)
— 237 lines, a real moderation panel with approve, reject and delete.

| | WooCommerce meta box | Medusa widget |
|---|---|---|
| Language | PHP rendering HTML | React, compiled into the dashboard |
| Placement | `add_meta_box($screen, $context)` | `zone: '<entity>.<page>.<position>'` |
| Auth | nonce + `current_user_can()` | the dashboard's session cookie |
| On upgrade | breaks if the hook or markup moved | survives while the zone exists |

The auth detail is the one to internalise. That file never sets an
`Authorization` header — it says so itself, and every `fetch` in it looks like
this:

```tsx
// apps/commerce/src/admin/widgets/product-reviews.tsx
      const res = await fetch(
        `/admin/reviews?product_id=${product.id}&limit=100&order=-created_at`,
        { credentials: "include" }
      )
```

The dashboard is a browser session, so the cookie rides along. That is exactly
the mechanism the Astro storefront *cannot* use, which is why it logs in for a
JWT instead (§5.10).

**This is the only custom admin UI in the entire repo.** Payload's side has none:
there is no `admin: { components: … }` anywhere in `apps/cms/src/`, because
Payload generated every screen from the collection definitions — see
[03 · Payload](../learn/03-payload.md). Medusa generated the product screens and
then needed a widget, because reviews are a module Medusa has never heard of.
That contrast is the two frameworks' philosophies in one sentence.

See it: http://localhost:9000/app → Products → any product → scroll down.

---

## 5.12 Where WooCommerce is plainly better

Say this out loud so the rest of the chapter stays honest.

| | WooCommerce | Here |
|---|---|---|
| Time to a working shop | an afternoon | there is no shop in this repo |
| Payment gateways | hundreds, from a search box | a provider interface and some writing |
| Changing a field | `update_post_meta()` | model change, `db:generate`, `db:migrate` |
| Reaching into core behaviour | `add_filter` on almost anything | not possible, by design |
| Reporting across the domain | one `JOIN`, or the analytics tables | a route, or a `query.graph` plan |
| Hosting | any shared PHP host | Node processes, Postgres, Redis |
| Finding a developer | very easy | harder, and more expensive |
| One store, one currency, one warehouse | exactly the right size | 146 tables of generality you are not using |

Medusa's advantages are narrow and real: isolation that makes upgrades
predictable, multi-region and multi-warehouse as core rather than plugins, an
immutable order model, and compensation. If none of those four is a problem you
actually have, WooCommerce is the better engineering decision and you should say
so to the client. Terms you will meet again are in
[08 · Glossary](../learn/08-glossary.md).

---

## 5.13 Check yourself

1. WooCommerce stores a product's price in `wp_postmeta`. Where does Medusa store
   it, and why does `/store/products` return `null` for it by default?
2. The `review` table has no foreign keys and neither does the link table. What
   would adding them cost?
3. All 146 Medusa tables are in one Postgres schema, so a cross-module `JOIN`
   would work. Why is writing one still wrong?
4. An order creation half-fails in WooCommerce. Describe what you do. Now
   describe what Medusa does instead, and name the two arguments of
   `StepResponse`.
5. Why does `getRatingStats` take an array of review ids rather than a product
   id?
6. `product.reviews` can contain `undefined` entries. Explain the chain of three
   decisions that makes that legitimate rather than a bug.
7. You hold a publishable key and an admin JWT. Which is closest to a WooCommerce
   consumer key/secret, and what is the other one for?
8. A client wants a single-currency shop, one warehouse, 200 products and Stripe.
   Argue for WooCommerce.

---

**Next:** [06-the-worked-example.md](06-the-worked-example.md) — all three
services in one request, traced end to end.
