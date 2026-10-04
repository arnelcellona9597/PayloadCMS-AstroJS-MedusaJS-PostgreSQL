# 6 · Commerce — payments, multiple stores and inventory

> Counterparts: [05 · Medusa, if you have built WooCommerce stores](../from-wordpress/05-medusa-for-woocommerce.md)
> maps the vocabulary and says where WooCommerce wins;
> [04 · Medusa](../learn/04-medusa.md) teaches modules, links and workflows.
> This page is the steps, and the honest scope.

Two of your twenty-one questions land here:

- *If I implement an online payment gateway, what approach should I take — is
  there a plugin or module for it?*
- *If I build an ecommerce site with multiple stores, or products with multiple
  inventory, do I have to custom it, or are there modules I can use?*

Both short answers are good news: **you do not build a payment gateway, you
register a provider**, and **you do not build multi-store or multi-warehouse,
because Medusa ships both as core modules.** The long answer has to start
somewhere less comfortable.

---

## 6.1 Nothing on this page is running in this repo — read the row counts first

This codebase demonstrates **reviews and operations built on Medusa's product
module**. It is not a commerce demo: cart, checkout, order, customer and payment
are not disabled or stubbed, they are **absent** — zero lines of code, zero
rows. Prove it before you trust a word of the rest:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select 'cart' as primitive, count(*) from cart
union all select 'payment_collection', count(*) from payment_collection
union all select 'payment',            count(*) from payment
union all select 'order',              count(*) from \"order\"
union all select 'customer',           count(*) from customer
order by 1;"
```

```
     primitive      | count
--------------------+-------
 cart               |     0
 customer           |     0
 order              |     0
 payment            |     0
 payment_collection |     0
(5 rows)
```

`payment_session`, `promotion` and `price_list` are 0 too. The tables exist
because Medusa creates them on migrate; nobody has written to them. The code
side agrees — grep all three apps for the words you would expect:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
grep -rniE "stripe|paypal|checkout|Modules\.PAYMENT" \
  apps/cms/src apps/commerce/src apps/storefront/src apps/commerce/medusa-config.ts \
  | wc -l
```

```
0
```

Labels, as everywhere in this cookbook: ✅ works here ▸ 📋 the framework
supports it, this repo does not configure it ▸ 🚫 absent entirely, no
commands.

| Capability | Label here | Why |
|---|---|---|
| Product, variant, price rows | ✅ seeded, read by `/products` | [`apps/storefront/src/lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts) lists them |
| Sales channel | ✅ one, used by `bootstrap.ts` | it scopes the publishable key |
| Stock location, inventory levels, region, shipping option | 📋 seeded, **nothing reads them** | Medusa's stock starter seed created them |
| Price list, promotion | 📋 supported, **zero rows** | the seed does not create any |
| Payment provider (real one) | 🚫 | only `pp_system_default`, a built-in no-op |
| Cart, checkout, order, customer, payment | 🚫 | no rows, no routes, no code |

⚠️ **Every recipe below is a 📋 or a 🚫, so its "Verify" step proves the current
state, not the finished state.** No command on this page charges a card: one
that fails teaches you less than nothing.

The rows that *do* exist are an accident of Medusa's stock starter seed in
[`apps/commerce/src/scripts/seed.ts`](../../apps/commerce/src/scripts/seed.ts),
kept wholesale so the product module had something to show. §5.1 of
[05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
makes the same point from the concepts side.

---

## 6.2 You do not build a payment gateway — you register a provider

**In WordPress:** you install a gateway plugin — WooCommerce Stripe Gateway,
PayPal Payments, Mollie, a local bank's ZIP. It appears under **WooCommerce →
Settings → Payments**, you paste two keys, toggle it on, and you are taking
money. Fifteen minutes, and you have done it dozens of times.

**Here:** Medusa v2 ships a **payment module** with a provider architecture. A
gateway is an npm package exporting a provider; you list it in the payment
module's `providers` array in `medusa-config.ts`, put its keys in
`apps/commerce/.env`, and attach it to a region. No settings screen, no ZIP
upload — a config edit and a restart.

| WooCommerce | Medusa v2 | Note |
|---|---|---|
| Gateway plugin (`.zip` from the directory) | a provider package on npm | `@medusajs/payment-stripe` is official |
| **Settings → Payments** toggle | an entry in the `providers` array | config, not UI |
| Gateway settings form (keys) | `options: { … }` on that entry, fed from `.env` | never committed |
| "Enable for these countries" | attach the provider to a **region** | a region owns currency + countries |
| `WC_Payment_Gateway` subclass | a class extending Medusa's `AbstractPaymentProvider` | 🚫 not written here |

**This repo already contains the exact shape you need**, for a different module.
Locking is also "a module with providers", and
[`apps/commerce/medusa-config.ts`](../../apps/commerce/medusa-config.ts) says so
in a comment written by someone who hit the error first:

```ts
// apps/commerce/medusa-config.ts
{
  /**
   * Locking is the odd one out: it is a MODULE WITH PROVIDERS, not a module
   * you swap wholesale.
   * …
   * Same pattern as payment and fulfillment providers — worth recognising,
   * because the error message points at the wrong thing.
   */
  key: Modules.LOCKING,
  resolve: '@medusajs/locking',
  options: {
    providers: [
      {
        resolve: '@medusajs/locking-redis',
        id: 'locking-redis',
        is_default: true,
        options: { redisUrl: process.env.REDIS_URL },
      },
    ],
  },
},
```

**Payment is the same three nested levels:** a module `key`, a module `resolve`,
and a `providers` array whose entries each carry their own `resolve`, `id` and
`options`. If you can read the locking block you can write the payment one, and
that is the whole of "how do I add a gateway".

**Going deeper:** [04 · Medusa](../learn/04-medusa.md) §4.2 on what a module is,
and §4.1 on why Medusa insists on this isolation.

---

## 6.3 📋 How to add Stripe to this stack

📋 **Supported, not configured here.** The package is real, the shape is real,
nothing in this repo installs it. Work on a branch you can throw away.

**In WordPress:** Plugins → Add New → "WooCommerce Stripe Gateway" → Install →
Activate → paste two keys → done.

**Here:** one npm install in `apps/commerce`, one config edit, two `.env` keys,
one region attachment, and a webhook endpoint Stripe can reach.

**Steps**

1. **Install the provider into the commerce app only.** It is a Medusa
   dependency, not a storefront one.

   ```
   npm --prefix apps/commerce install @medusajs/payment-stripe@2.19.0
   ```

   ⚠️ Pin it to the Medusa version you are on. Every Medusa package in
   [`apps/commerce/package.json`](../../apps/commerce/package.json) is pinned at
   `2.19.0` and the provider's peer range is exact, not a caret — §6.4 shows how
   to check that before you install anything.

2. **Add a `payment` entry to the `modules` array** in
   [`apps/commerce/medusa-config.ts`](../../apps/commerce/medusa-config.ts)
   (`modules:` opens at line 66, where the locking block sits).

   The payment module is **already running** — Medusa v2 loads it as a core
   module, which is why the Verify query below finds `pp_system_default` even
   though `medusa-config.ts` never mentions payment. What you are adding is not
   the module but a *provider* for it; listing the module explicitly is how you
   get a `providers` array to put one in. 📋 This entry is not in the file
   today:

   ```ts
   // apps/commerce/medusa-config.ts — 📋 NOT PRESENT; this is what you would add
   {
     key: Modules.PAYMENT,
     resolve: '@medusajs/payment',
     options: {
       providers: [
         {
           resolve: '@medusajs/payment-stripe',
           id: 'stripe',
           options: {
             apiKey: process.env.STRIPE_API_KEY,
             webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
           },
         },
       ],
     },
   },
   ```

   `Modules.PAYMENT` resolves to the string `payment`, exactly as
   `Modules.LOCKING` resolves to `locking`. The option names `apiKey` and
   `webhookSecret` are the provider's own, declared on its `StripeOptions`
   type inside the package alongside optional `capture` and
   `automaticPaymentMethods` flags — read that file rather than this page.

3. **Add the two secrets** to [`apps/commerce/.env`](../../apps/commerce/.env),
   with placeholders in the committed
   [`apps/commerce/.env.example`](../../apps/commerce/.env.example):

   ```
   # apps/commerce/.env — 📋 these two lines are not there today
   STRIPE_API_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

   There are **three** `.env` files in this repo and no root one
   ([04 §4.5](04-stack.md#45-there-are-three-env-files-and-no-root-env)). This
   pair belongs in the commerce app and nowhere else — §6.6 is the argument.

4. **Attach the provider to a region.** A provider that no region offers is a
   provider no checkout can pick. The seed already shows the field, with the
   built-in no-op provider in it —
   [`apps/commerce/src/scripts/seed.ts`](../../apps/commerce/src/scripts/seed.ts):

   ```ts
   // apps/commerce/src/scripts/seed.ts:114
   const { result: regionResult } = await createRegionsWorkflow(container).run({
     input: {
       regions: [
         {
           name: "Europe",
           currency_code: "eur",
           countries,
           payment_providers: ["pp_system_default"],
         },
       ],
     },
   });
   ```

   Either edit the region in the Medusa admin at **http://localhost:9000/app**
   → Settings → Regions, or add your provider id to that array and re-seed. The
   stored id is `pp_<the provider's identifier>_<the id you gave it in step 2>`
   — the rule lives in `@medusajs/payment/dist/loaders/providers.js:45` — which
   is why the seeded one reads `pp_system_default`. **Read the real id out of
   the database rather than guessing it**, with the query below.

5. **Restart Medusa** with `npm run dev:commerce` so the config is re-read.

6. **Expose the webhook.** Stripe needs a public URL to post payment events to,
   and `localhost:9000` is not one. Medusa already serves the route —
   `POST /hooks/payment/:provider`, from
   `node_modules/@medusajs/medusa/dist/api/hooks/payment/[provider]/route.js` —
   so there is nothing to write; `:provider` is the `pp_…` id from step 4. In
   development, forward to it with the Stripe CLI:

   ```
   stripe listen --forward-to localhost:9000/hooks/payment/pp_stripe_stripe
   ```

   In production it is a real hostname in front of Medusa —
   [09 · To production](../learn/09-to-production.md).

**Verify — what you can run today.** This shows the current state: one built-in
provider attached to the one seeded region. After step 4 the same query returns
yours alongside it.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select p.id            as provider,
       p.is_enabled,
       r.name          as attached_to_region
from payment_provider p
left join region_payment_provider rp on rp.payment_provider_id = p.id
left join region r on r.id = rp.region_id;"
```

```
     provider      | is_enabled | attached_to_region
-------------------+------------+--------------------
 pp_system_default | t          | Europe
(1 row)
```

`pp_system_default` is Medusa's built-in **no-op** provider: it authorises
everything and charges nothing, so a development checkout can complete without a
gateway. It is the only payment provider in this database.

⚠️ **Gotcha — the plugin habit that misfires.** An activated WordPress plugin
starts working. Here an installed package does nothing until it is in the
`providers` array **and** a region offers it, and both omissions are silent.

**Going deeper:** [05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
§5.7 — why you cannot `add_filter` into core behaviour, and therefore why
providers are a formal interface.

---

## 6.4 ⚠️ The Stripe package trap — you will find the wrong one first

Search npm for "medusa stripe" and the first plausible hit is
`medusa-payment-stripe`. It is real, it is published, it has a version number
that looks newer than Medusa's own (`6.0.11`), and **it is the Medusa v1
community package. It will not work on v2.**

You do not have to take that on faith. Ask npm what each one expects to be
plugged into:

```bash
npm view medusa-payment-stripe peerDependencies
echo "--- and the v2 one ---"
npm view @medusajs/payment-stripe@2.19.0 peerDependencies
```

```
{
  '@medusajs/medusa': '^1.12.0',
  '@tanstack/react-table': '^8.7.9',
  'medusa-react': '^9.0.0'
}
--- and the v2 one ---
{ '@medusajs/framework': '2.19.0' }
```

The first wants `@medusajs/medusa` **1.x** and drags in `medusa-react`, which
only existed in the v1 world. The second wants `@medusajs/framework` at
**exactly 2.19.0** — which is what this repo has.

`medusa-payment-stripe` was last published in 2024 and tops out at 6.0.11;
`@medusajs/payment-stripe` is at 2.21.2 and current. 🚫 Never the first one here;
📋 always the second, pinned to your framework version.

**Make this a habit for every package in this stack.** Run
`npm view <name> peerDependencies` before installing anything and check the peer
against what you have. Every Medusa package in this repo is pinned at `2.19.0`
with no caret, deliberately. Payload's plugin line has the identical trap in the
other app — [05 §5.3](05-plugins.md#53-two-traps-that-will-cost-you-an-evening-each)
shows `@payloadcms/plugin-seo` failing against this repo's Payload 3.88.0.

You can watch the check fire without changing anything, because `--dry-run`
resolves the tree and then throws it away. Ask for the *latest* Stripe provider
(2.21.2) against this repo's 2.19.0 framework:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa/apps/commerce
npm install --dry-run --no-audit --no-fund @medusajs/payment-stripe@2.21.2
```

```
npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error
npm error While resolving: commerce@0.0.1
npm error Found: @medusajs/framework@2.19.0
npm error node_modules/@medusajs/framework
npm error   @medusajs/framework@"2.19.0" from the root project
npm error
npm error Could not resolve dependency:
npm error peer @medusajs/framework@"2.21.2" from @medusajs/payment-stripe@2.21.2
npm error node_modules/@medusajs/payment-stripe
npm error   @medusajs/payment-stripe@"2.21.2" from the root project
npm error
npm error Fix the upstream dependency conflict, or retry
npm error this command with --force or --legacy-peer-deps
npm error to accept an incorrect (and potentially broken) dependency resolution.
…
```

**That failure is the point of this block** — it is deliberate, it changes
nothing, and it is the tooling working. Ask for the matching version instead and
the same dry run succeeds:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa/apps/commerce
npm install --dry-run --no-audit --no-fund @medusajs/payment-stripe@2.19.0 | tail -1
```

```
added 86 packages in 1s
```

The count is the signal, not the timing. Nothing was written: `--dry-run` never
touches `node_modules` or the lockfile.

⚠️ **The ecosystem is still smaller, but npm is not silent.** npm 7 and later
refuse a conflicting peer by default — this is npm 10.9.8 — so a mismatch stops
at install with `ERESOLVE` rather than at boot. The real trap is the escape
hatch in that error message: `--force` or `--legacy-peer-deps` installs the
mismatch anyway, and *then* you get a boot error pointing at a loader rather
than a version. WordPress flags "untested with your version" in the plugin
directory and still lets you activate; npm blocks you and offers a flag. Both
leave the compatibility call with you.

---

## 6.5 🚫 The checkout flow, mapped to WooCommerce

🚫 **Not in this repo.** Nothing here creates a cart, a payment collection or an
order, so this section is orientation only and carries no commands. Medusa
splits into more steps than WooCommerce because payment is its own module,
separate from cart and from order:

| Step | What it is | WooCommerce equivalent |
|---|---|---|
| 1. Cart | a durable row with an id, line items and a region | the session blob in `wp_woocommerce_sessions` |
| 2. Payment collection | "this cart owes this amount in this currency" | implicit — the order total |
| 3. Payment session | one provider's attempt at that collection | `WC_Payment_Gateway::process_payment()` |
| 4. Authorize | the customer's bank holds the funds | gateway returns `success` and redirects |
| 5. Capture | the funds actually move | `WC_Order::payment_complete()` |
| 6. Order | created from the completed cart, **immutable** | a row in `wc_orders` (or a `shop_order` post on older installs), mutated in place |

Three rows will bite you. **Authorize and capture are separate states**, which
lets you authorise at checkout and capture at fulfilment; the Stripe provider's
`capture` option sets the default. **A cart outlives the session** — it is a row
with an id, so an abandoned cart needs no plugin to find. **An order is
immutable** — you record a change against it rather than editing the order in
place, which is what both `wc_orders` and the older `shop_order` meta do. §5.6 of
[05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
goes further, and is equally honest that it was written without a running
example.

⚠️ **Treat §6.5 as a glossary, not as instructions.** Nothing in it has been
executed against a working checkout here, because there is not one.

---

## 6.6 📋 How to keep the secret key out of the Astro app

📋 **Supported, not configured here** — there is no key to protect yet. The rule
matters the day there is.

**In WordPress:** one application. Plugin, theme and checkout page share a PHP
process, so "where does the secret key live" has one answer — `wp_options`, read
by the plugin. You have never had to think about it.

**Here:** three applications on three ports, and the key belongs to exactly one.
**Medusa holds the Stripe secret key. Astro never sees it.** Astro gets the
*publishable* key, which is designed to be public, and only because Stripe
Elements needs it in the browser.

**Steps**

1. Put `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` in
   [`apps/commerce/.env`](../../apps/commerce/.env) only — never in
   [`apps/storefront/.env`](../../apps/storefront/.env).
2. Prefix a storefront variable `PUBLIC_` only when the browser genuinely needs
   it, understanding that you have just published it. Everything else stays
   unprefixed, for the reason the committed example file already gives:

   ```
   # apps/storefront/.env.example
   # NOT prefixed with PUBLIC_, on purpose.
   #
   # Astro only exposes PUBLIC_-prefixed variables to client-side code. Because every
   # page here renders on the server, the browser never needs these values — so they
   # stay server-only. This is the concrete payoff of the BFF pattern.
   ```

3. Never proxy a secret through an Astro API route "for convenience". A route
   that takes a card number and forwards it has put your Node process inside
   your PCI scope.

**Verify** — the storefront has no `PUBLIC_` variables at all today:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
grep -c '^PUBLIC_' apps/storefront/.env.example
```

```
0
```

`grep -c` exits non-zero when it counts nothing, so the `0` is the answer and
the exit code is not a failure.

⚠️ **Gotcha.** Astro will happily let you write `PUBLIC_STRIPE_SECRET_KEY`. The
prefix *is* the declaration of intent, so there is nothing for Astro to catch —
the only guard is reading the name before you type it.

**Going deeper:** [07 · Cross-cutting concerns](../from-wordpress/07-cross-cutting.md)
on the BFF pattern, and [09 · To production](../learn/09-to-production.md) on
secrets at deploy time.

---

## 6.7 📋 Where the storefront fits — the one place client JavaScript is required

📋 **Supported, not configured here.** No payment UI exists in the storefront.

Everywhere else in this documentation claims the Astro storefront ships
essentially no JavaScript — `/posts` does full CRUD with zero bytes of it. True,
and **card entry is the exception.** Stripe Elements renders the card field in
an iframe served by Stripe, so the raw number never touches your DOM or your
server; that requires client-side JavaScript, there is no server-rendered way to
do it, and you should not want one. In Astro that means a **React island**.

The storefront has exactly one island today — `<ReviewFilter>` at
`reviews/index.astro:76`, the only real `client:` directive in the app.
[02 §2.8](02-frontend.md#28-make-a-component-an-island-only-when-the-server-cannot-pre-compute-it)
counts them, tabulates the five directives and measures what the first island
actually costs. **Verify** the count for yourself in one line — the rendered HTML
is the authoritative answer, not the source. `$SF` is the storefront's real port,
from `npx astro dev status`
([04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321)):

```bash
curl -s "$SF/reviews" | grep -c '<astro-island'
```

```
1
```

A payment form would be the **second** island in the application. 📋 You would
mount it with `client:load`, not `client:visible` — a checkout form that hydrates
only when scrolled into view is a checkout form that is sometimes broken — using
`@stripe/stripe-js` (10.0.0) and `@stripe/react-stripe-js` (7.0.0), neither of
which is installed here. The good news is the bill: 02 §2.8 measures the React
renderer at ~192 kB as a **fixed entry fee**, so the second island costs only its
own few kB. In WooCommerce the gateway plugin renders that form for you onto a
page that already has jQuery; here you render it, and you own the hydration
decision.

**Going deeper:** [04 · Astro for theme developers](../from-wordpress/04-astro-for-theme-developers.md)
on islands and hydration, [05 · Astro](../learn/05-astro.md) for the mechanics.

---

## 6.8 📋 How to run multiple stores — sales channels, not Multisite

📋 **Supported, not configured here** — one channel exists and one storefront
uses it.

**In WordPress:** Multisite with a WooCommerce install per site, a multi-store
plugin, or separate installations with the catalogue synced between them. All
three work; all three store the product data more than once.

**Here:** a **sales channel** is core. One catalogue, many channels; each product
is assigned to the channels it appears in, and a storefront's publishable API
key is scoped to a channel. One brand's storefront literally cannot see another
brand's products, with no filtering code anywhere.

**Steps**

1. Create the channel in the Medusa admin at **http://localhost:9000/app** →
   Settings → Sales Channels. 📋 This repo has one, created by the seed.
2. Assign products to it. The assignment is a link row, not a column on the
   product.
3. Create a publishable key and attach it to that channel — what
   [`apps/commerce/src/scripts/bootstrap.ts`](../../apps/commerce/src/scripts/bootstrap.ts)
   already does for the one channel here, and documents:

   ```ts
   // apps/commerce/src/scripts/bootstrap.ts
   /**
    * A key with no sales channel attached still authenticates, but scopes the
    * caller to nothing — product listings come back empty and it looks like a bug
    * in your query. Attaching the channel is not optional in practice.
    */
   ```

4. Put that key in the new storefront's `.env` as `MEDUSA_PUBLISHABLE_KEY`.

**Verify** — the assignment is rows, so "which products does this storefront
see?" is a SQL question:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select sc.name as channel, p.title as product
from product_sales_channel psc
join sales_channel sc on sc.id = psc.sales_channel_id
join product p on p.id = psc.product_id
order by p.title;"
```

```
        channel        |              product
-----------------------+-----------------------------------
 Default Sales Channel | Application Performance Monitoring
 Default Sales Channel | Astro Commerce Toolkit
 Default Sales Channel | Certificate & Secrets Automation
 Default Sales Channel | Dedicated Edge Server
 Default Sales Channel | Global CDN
…
(15 rows)
```

One channel, fifteen products, fifteen rows. Add a second channel and this same query
answers the multi-store question directly. Multisite can be asked the same
question — it shares one database — but each site carries its own
`wp_N_posts`/`wp_N_postmeta` tables, so "which products does site 2 sell?" means
querying a different set of tables per site rather than filtering one catalogue.

⚠️ **Gotcha.** A publishable key with no channel attached does not error. It
authenticates, returns an empty product list, and looks exactly like a broken
query.

**Going deeper:** [04 · Medusa](../learn/04-medusa.md) §4.9 on the publishable
key, and §4.4 on links — a channel assignment is one.

---

## 6.9 📋 How to run multiple warehouses — stock locations and inventory levels

📋 **Supported, not configured here** — one location, twenty levels, nothing
reads them.

**In WordPress:** `_stock` and `_stock_status` are postmeta on the product or
variation (mirrored into `wc_product_meta_lookup` for fast queries). One number,
one shop, no concept of *where*. Multiple warehouses means a plugin, and the
capable ones add their own tables, because a single postmeta value cannot
express "40 in Malta, 0 in Copenhagen".

**Here:** inventory is its own module, with three nouns that do not collapse:

| Noun | Means | WooCommerce analogue |
|---|---|---|
| **stock location** | a warehouse, a shop floor, a 3PL | no core equivalent |
| **inventory item** | a stock-keeping thing, independent of the product | the `_sku` on a variation |
| **inventory level** | **how many of that item are at that location** | `_stock` postmeta, but per location |

That separation is the point: one inventory item can back several variants (a
black T-shirt sold under two brands is one pile of shirts) and stock at two
warehouses is two rows, not two plugins.

**Steps**

1. Create the location in the Medusa admin → Settings → Locations. 📋 One
   exists already, from
   [`apps/commerce/src/scripts/seed.ts`](../../apps/commerce/src/scripts/seed.ts).
2. Link it to a sales channel, so Medusa knows which storefront sells from it.
3. Set a level per inventory item per location — the seed does this in bulk:

   ```ts
   // apps/commerce/src/scripts/seed.ts
   const inventoryLevel = {
     location_id: stockLocation.id,
     stocked_quantity: 1000000,
     inventory_item_id: inventoryItem.id,
   };
   ```

4. Nothing else. Reservations and per-channel availability are the module's
   job, not yours.

**Verify** — every level, joined back to its warehouse and SKU:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select l.name as location, i.sku, lv.stocked_quantity, lv.reserved_quantity
from inventory_level lv
join stock_location l on l.id = lv.location_id
join inventory_item i on i.id = lv.inventory_item_id
order by i.sku limit 5;"
```

```
      location      |   sku    | stocked_quantity | reserved_quantity
--------------------+----------+------------------+-------------------
 European Warehouse | METAL-16 |          1000000 |                 0
 European Warehouse | METAL-32 |          1000000 |                 0
(2 rows)
```

⚠️ **Two rows, for a catalogue of fifteen products.** That is not a broken
seed — it is `manage_inventory: false`, set on every digital plan in
[`catalogue.ts`](../../apps/commerce/src/scripts/catalogue.ts). Medusa creates an
inventory item only for variants that are actually stock, so the one physical
product contributes two rows and the other fourteen contribute none.

That is the right model for licences and subscriptions: a VPS plan does not run
out. WooCommerce expresses the same idea with the "Manage stock?" checkbox per
product, and the consequence is the same — unchecked means no stock record
exists to decrement.

`reserved_quantity` is stock committed to a checkout that has not completed.
WooCommerce does have this — `wc_reserved_stock`, since 4.3 — but it holds stock
against a *pending order* for a fixed window, and there is only ever one pool to
hold it from. Here the reservation is per inventory item **per location**, so
two warehouses hold separately. A million of everything is the seed being a
demo, not a default.

⚠️ **Gotcha — the honest one.** Those twenty rows are read by nothing. Prove it:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
grep -rliE "sales_channel|stock_location|inventory|price_list|region" \
  apps/storefront/src apps/commerce/src/api apps/commerce/src/workflows apps/commerce/src/modules
```

```
apps/commerce/src/api/admin/schema/route.ts
```

One file, and there the words appear **only inside comments** about link-table
naming. The storefront does not even ask for prices —
[`apps/storefront/src/lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts)
requests `fields: 'id,title,handle,description,thumbnail'` and stops. No price,
no variant, no stock. You have read a correct description of core
multi-warehouse inventory and you have **not** seen it run.

**Going deeper:** [05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
§5.5 tabulates these same rows against their WooCommerce counterparts.

---

## 6.10 📋 Regions and price lists — currency, tax and sale pricing

📋 **Supported, not configured here.** One region exists; zero price lists do.

**In WordPress:** one store, one currency, unless you buy a multi-currency
plugin. Tax rates live in `wp_woocommerce_tax_rates`. A sale price is
`_sale_price` postmeta with two dates; customer-group pricing is another plugin.

**Here:** a **region** bundles four things that always travel together —
currency, the countries it covers, tax behaviour, and **which payment providers
it offers**. That last one is why §6.3 step 4 exists: a gateway is not global,
it belongs to the regions that offer it.

**Steps**

1. Create one region per currency you actually sell in, at
   **http://localhost:9000/app** → Settings → Regions. 📋 One exists here,
   created by
   [`apps/commerce/src/scripts/seed.ts:114`](../../apps/commerce/src/scripts/seed.ts).
2. Assign countries to it in that same form. `region_country` holds all 250
   countries as rows from the start; assignment is setting `region_id` on seven
   of them, not creating anything.
3. Attach the region's payment providers — the `payment_providers` array in the
   seed, or the same Regions form (§6.3 step 4).
4. For sale or customer-group pricing, create a **price list** at Settings →
   Price Lists: an override set of prices with an optional date window and
   rules. 📋 There are zero price lists here.

**Verify** — the single seeded region, with its country count and its providers:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "
select r.name, r.currency_code,
       (select count(*) from region_country c where c.region_id = r.id) as countries,
       (select string_agg(payment_provider_id, ', ')
          from region_payment_provider p where p.region_id = r.id) as providers
from region r;"
```

```
  name  | currency_code | countries |     providers
--------+---------------+-----------+-------------------
 Europe | eur           |         7 | pp_system_default
(1 row)
```

One region, seven countries, one no-op provider. That is the entire commercial
configuration of this repo.

⚠️ **Gotcha.** Price in Medusa is **computed in a context**, not stored on the
product — the context being region, currency, customer group and quantity. The
`price` rows you can count in the database are inputs to that calculation, not
the answer. Reaching for "the product's price" the way you reach for
`_regular_price` is the habit to drop; §5.4 of the WooCommerce chapter works
through it.

**Going deeper:** [05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
§5.4 and §5.5.

---

## 6.11 You do not custom-build any of this — and that is the real Medusa win

Count up from §6.8, §6.9 and §6.10: one sales channel, one stock location,
twenty inventory items, twenty inventory levels, one region, two shipping
options, zero price lists, zero promotions. Six of those eight have rows and
**one** is read by application code — the sales channel, because `bootstrap.ts`
links the publishable key to it. The rest are furniture. The comparison that
answers your question directly, and the clearest Medusa win in this stack:

| Capability | WooCommerce | Medusa v2 |
|---|---|---|
| Second storefront / brand | Multisite, or a second install | a **sales channel** — core |
| Second warehouse | a paid inventory plugin | a **stock location** — core |
| Stock per warehouse | not expressible in postmeta | an **inventory level** row — core |
| Stock reserved by open carts | `wc_reserved_stock`, core since 4.3, one pool | `reserved_quantity` — core, **per location** |
| Second currency | a multi-currency plugin | a **region** — core |
| Per-country tax | core, in `wp_woocommerce_tax_rates` | core, its own module |
| Sale / customer-group pricing | `_sale_price`, or a plugin | a **price list** — core |
| One SKU backing two products | not really possible | one inventory item, many variants |

**Do not custom-build any of these.** If you are writing a module to track stock
per warehouse, you have missed one that ships with the framework. The reflex to
unlearn is not a bad one — in WooCommerce "multiple warehouses" genuinely does
start with a plugin search, because it is not in core. Here it is.

---

## 6.12 When Medusa is the wrong answer, concretely

The table above is a real advantage and it is also a real cost. Say this to a
client before you quote them.

**A single-currency, single-warehouse shop with 200 products, one language and a
Stripe button is faster, cheaper and more maintainable in WooCommerce.** Not
"arguably" — concretely:

| | WooCommerce | This stack |
|---|---|---|
| Time to a working shop | an afternoon | there is no shop in this repo at all |
| Payment gateway | a plugin and two keys, 15 minutes | §6.3 — install, config, region, webhook, tunnel |
| Hosting | any shared PHP host, €5/month | Node processes, Postgres, Redis, a reverse proxy |
| Who can change a price | the owner, in wp-admin | the owner, in the Medusa admin — this one is a tie |
| Who can add a field | the owner, with ACF | a developer, a migration, a deploy |
| Tables in the database | ~30 WooCommerce tables on WordPress core's 12 | **146** in `medusa_crud` alone, counted |
| Finding a developer to maintain it | very easy | harder and more expensive |
| Reporting across the shop | one `JOIN` | a route, or a `query.graph` plan |

Medusa's advantages are narrow and real, and there are four: module isolation
that makes upgrades predictable, multi-region and multi-warehouse as core rather
than plugins, an immutable order model, and workflow compensation that rolls a
failed multi-step operation back. **If none of those four is a problem you
actually have, WooCommerce is the better engineering decision** — say so.

Reach for this stack when two or more are true: you sell in more than one
currency, you ship from more than one place, you run more than one storefront
against one catalogue, or the order lifecycle has steps that must not
half-complete. Otherwise you are paying 146 tables of generality for a shop that
needs twelve.

**Going deeper:** [05 · Medusa for WooCommerce builders](../from-wordpress/05-medusa-for-woocommerce.md)
§5.12 argues this from the other direction;
[09 · To production](../learn/09-to-production.md) prices the operational side.

---

## Check yourself

1. `medusa-payment-stripe` is version 6.0.11 and `@medusajs/payment-stripe` is
   2.21.2. Which one belongs in this repo, which command proves it, and why is
   the higher version number the wrong signal?
2. You install the Stripe provider and restart Medusa. Nothing appears at
   checkout. Name the two separate configuration steps that each produce this
   symptom silently.
3. Why does the Stripe secret key belong in `apps/commerce/.env` rather than
   `apps/storefront/.env`, and what does the `PUBLIC_` prefix actually do?
4. The storefront ships one React island today. Why would a card form have to be
   the second one, and why `client:load` rather than `client:visible`?
5. `inventory_level` has 20 rows and `stock_location` has one. What does a
   second warehouse change about those two numbers — and what does
   `reserved_quantity` measure that this repo can never produce?
6. A client sells 200 products, in euros, from one room, with a Stripe button.
   Make the case for WooCommerce in three sentences, using numbers from §6.12.

---

**Next:** [07-tools.md](07-tools.md) — the phpMyAdmin question: which client to
point at port 5433, and why reading rows is safe while writing them is not.

For the concepts underneath every recipe on this page, including the zero-row
inventory that makes §6.1 true, read
[05 · Medusa — if you have built WooCommerce stores](../from-wordpress/05-medusa-for-woocommerce.md).
