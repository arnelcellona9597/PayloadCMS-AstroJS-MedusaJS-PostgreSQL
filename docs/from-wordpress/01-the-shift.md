# 1 · The shift — from one program to three

> Counterpart in the main course: [01 · Foundations](../learn/01-foundations.md)
> for the vocabulary and [02 · Infrastructure](../learn/02-infrastructure.md) for
> the machinery. This chapter is the bridge between those two and everything you
> already know about WordPress.

You have spent your career inside **one program**. WordPress owns the database,
the routing, the query, the admin UI, the templates and the HTML. Everything you
have ever written — a `functions.php` filter, an ACF field group, a custom
template — ran *inside* that program, with the whole system in scope.

Here there are **three programs**, each owning a slice, and nothing in scope
except what arrives over HTTP. That one sentence is the entire difficulty of this
stack. Most of the confusion that follows — "where do I put this?", "why can't I
just query that?", "why are there two logins?" — is the same question wearing
different clothes: **the boundaries moved, and they are now network boundaries.**

This chapter is the map. It does not teach Payload, Astro or Medusa; chapters 3,
4 and 5 do. It teaches you where things went.

**Run the commands.** Every block below was executed against the running stack on
this machine. Row counts drift as you work the repo, so read the *shape* of each
answer, not the digits.

---

## 1.1 One program became three, and the only thing between them is HTTP

| | WordPress | This stack |
|---|---|---|
| Processes serving your site | 1 (PHP-FPM) | **3** (Node × 3) |
| Databases | 1 MySQL | **2** Postgres, in one container |
| Admin UIs | 1 | **2** |
| Who renders HTML | WordPress | Astro, and only Astro |
| Who owns content | WordPress | **Payload** (`apps/cms`, :3000) |
| Who owns products and reviews | WooCommerce, inside WordPress | **Medusa** (`apps/commerce`, :9000) |
| How the renderer gets data | an in-process SQL query | **`fetch()` over HTTP** |

One rule keeps the architecture honest, and you can apply it to any new feature:
**Astro owns no domain data and has no database connection at all.** Payload owns
posts, pages, categories, media, users and site settings; Medusa owns products,
reviews, uptime history and workflows; Astro owns HTML, forms and the BFF layer.
If the storefront needs a number, it asks one of the other two for it.

Prove the three processes exist and are separate:

```bash
for p in 3000 9000 4321; do
  printf '%-6s ' ":$p"
  ss -ltnp 2>/dev/null | grep ":$p " | head -1 | grep -oP 'users:\(\("\K[^"]+' \
    || echo '(no listener)'
done
```

```
:3000  next-server (v1
:9000  node
:4321  node
```

Three separate OS processes. Kill one and the other two keep serving — degraded,
but serving. That is the bargain in one observation: **nothing takes the site
down all at once, and nothing works without integration.**
[01 · Foundations §§1.1–1.4](../learn/01-foundations.md) has the formal
vocabulary (headless, SSR, BFF) if those words are still fuzzy.

---

## 1.2 Two request lifecycles, drawn side by side

Learn these two pictures and most "where does my code go?" questions answer
themselves.

### WordPress: one process, one query, one template

```
GET /hello-world/
  │
  ├─ index.php → wp-blog-header.php → wp-load.php → wp-config.php
  │
  ├─ wp-settings.php               ← the long one
  │     ├─ load must-use plugins, then every active plugin, every request
  │     ├─ do_action('plugins_loaded')
  │     ├─ load the theme's functions.php     (CHILD first, then parent)
  │     ├─ do_action('after_setup_theme')
  │     └─ do_action('init')                  ← CPTs, taxonomies, shortcodes
  │
  ├─ wp()  →  WP::main()
  │     ├─ parse_request()         URL → query vars, via the rewrite rules
  │     ├─ query_posts()           ← THE MAIN QUERY. One WP_Query, built for you
  │     └─ handle_404()
  │
  ├─ template-loader.php
  │     └─ the template hierarchy picks exactly ONE file:
  │          single-post.php → single.php → singular.php → index.php
  │
  └─ that file runs, calls the_post(), echoes HTML
                                    ↓
                             HTML to the browser
```

Two properties of that picture are worth naming, because you are about to lose
both. **The main query happens whether you want it or not** — you *modify* that
decision (`pre_get_posts`) rather than making it. And **everything is in scope**:
inside `single.php` you can call any function any plugin defined, hit the
database with `$wpdb`, and read a WooCommerce order. One process, one memory
space.

### This stack: middleware, frontmatter, and explicit fetches

```
GET http://localhost:4321/
  │
  ├─ Astro's own origin check (security.checkOrigin)
  │     └─ a 403 here never reaches your code, and never reaches your log
  │
  ├─ src/middleware.ts        onRequest()
  │     ├─ rate limit?        /api/* and Action POSTs only
  │     ├─ record()           ring buffer, in THIS process
  │     └─ await next()
  │
  ├─ src/pages/index.astro    everything between the --- fences runs
  │                           ON THE SERVER, once, per request
  │     └─ await Promise.all([ … ])
  │            ├── fetch → :3000 /api/posts/stats            (Payload)
  │            ├── fetch → :3000 /api/categories?limit=100   (Payload)
  │            ├── fetch → :3000 /api/posts?limit=5          (Payload)
  │            ├── fetch → :9000 /store/products?limit=50    (Medusa)
  │            └── fetch → :9000 /admin/reviews?limit=100    (Medusa)
  │
  ├─ the template half of the same file renders with those values
  │
  └─ layouts/Layout.astro wraps it, and its OWN frontmatter runs here
        └── fetch → :3000 /api/globals/site-settings         (Payload)
                                    ↓
                             HTML to the browser
```

There is **no main query**. Nothing is fetched until you write the line that
fetches it. That is more work, and it is also the point: a page declares its own
data requirements, so you can read one file and know exactly what it costs.

Watch a single page view fan out across both backends:

```bash
BC=$(wc -l < logs/commerce.log); BP=$(wc -l < logs/cms.log)
curl -s -o /dev/null -w 'GET / -> HTTP %{http_code} in %{time_total}s\n' \
  http://localhost:4321/
sleep 1
echo 'Payload (:3000) saw:'
tail -n +$((BP+1)) logs/cms.log | grep -aoP '(GET|POST) /api/\S+' | sed 's/^/  /'
echo 'Medusa (:9000) saw:'
tail -n +$((BC+1)) logs/commerce.log | sed 's/\x1b\[[0-9;]*m//g' \
  | grep -aoP '(GET|POST) /(store|admin)/\S+' | sed 's/^/  /'
```

```
GET / -> HTTP 200 in 0.052296s
Payload (:3000) saw:
  GET /api/categories?limit=100&sort=name
  GET /api/posts/stats
  GET /api/posts?limit=5&page=1&sort=-updatedAt&depth=0
  GET /api/globals/site-settings
Medusa (:9000) saw:
  GET /admin/reviews?limit=100&offset=0&order=-created_at
  GET /store/products?limit=50&fields=id%2Ctitle%2Chandle%2Cdescription%2Cthumbnail
```

**One browser request became six HTTP requests across two services.** In
WordPress those would have been six SQL queries in one process, each well
under a millisecond and none of them leaving the machine. Here each is a network round trip, which is why
[`apps/storefront/src/pages/index.astro`](../../apps/storefront/src/pages/index.astro)
issues them concurrently:

```ts
// apps/storefront/src/pages/index.astro
const [stats, categories, recentPosts, products, reviews] = await Promise.all([
  settle(() => getPostStats({ authenticated: true })),
  settle(() => listCategories()),
  settle(() => listPosts({ limit: 5, sort: '-updatedAt', depth: 0, includeDrafts: true })),
  settle(() => listProducts(50)),
  settle(() => listAdminReviews({ limit: 100, order: '-created_at' })),
])
```

⚠️ **Sequential `await`s are the easiest habit to carry over, and the most
expensive.** Five queries one after another in PHP is fine; five
`await fetch()` calls one after another costs the *sum* of five round trips on
every render. `Promise.all` makes the page cost the slowest one instead.

The sixth call comes from
[`apps/storefront/src/layouts/Layout.astro`](../../apps/storefront/src/layouts/Layout.astro),
not from the page: its own frontmatter `await`s `getSiteSettings()` inside a
`try`/`catch` that falls back to `null`, because a layout that throws breaks
every page at once. [04 §4.3](04-astro-for-theme-developers.md) is the fuller
walk through that file, and [04 §4.6](04-astro-for-theme-developers.md) is the
chapter on fetching generally.

That is your `header.php` calling `get_option()` — except `get_option()` was a
cached in-process lookup and this is an HTTP request on **every page render**.
Caching it is [09 · To production](../learn/09-to-production.md) §9.6.

And the result really is server-rendered. The words live in Payload and arrive
inside the HTML:

```bash
curl -s http://localhost:3000/api/globals/site-settings \
  | python3 -c 'import json,sys; print("in payload:", json.load(sys.stdin)["announcement"]["message"])'
curl -s http://localhost:4321/posts \
  | grep -o 'This banner comes from a Payload global[^<]*' | sed 's/^/in html:   /'
```

```
in payload: This banner comes from a Payload global — one record, read on every page.
in html:   This banner comes from a Payload global — one record, read on every page.
```

**This is still server-side rendering.** View source and the content is there,
exactly as with WordPress — this repo hydrates JavaScript on exactly one
component in the whole storefront ([05 · Astro](../learn/05-astro.md) has the
SSR/CSR/island split).

---

## 1.3 `functions.php` split three ways — and some of it has nowhere to live

Every WordPress developer asks this within the first hour, and the honest answer
is unsatisfying: **there is no `functions.php`, and the things it did now live in
four different places across three programs.**

| What you wrote in `functions.php` | Where it goes here |
|---|---|
| `register_post_type()`, `register_taxonomy()`, ACF field groups | a file in `apps/cms/src/collections/` |
| `wp_insert_post_data` / `save_post` | a Payload **collection hook** |
| `sanitize_title` on save | a Payload **field hook** |
| `current_user_can()` gates | Payload `access` functions |
| `add_shortcode()` | an Astro component, or a Payload **block** |
| `add_filter('the_content', …)`, `wp_enqueue_scripts` | Astro components; there is no enqueue system |
| `template_redirect` guards | `apps/storefront/src/middleware.ts` |
| `wp_mail` on order placed | a Medusa **subscriber** |
| `wp_schedule_event` | a Medusa **job** (cron string in code) |
| WooCommerce order hooks | a Medusa **workflow** step |
| Anything that needed all of it at once | **nowhere** 🚫 |

That last row is not a joke. Take each real destination in turn.

### Payload hooks — field scope, then document scope

[`apps/cms/src/hooks/slugify.ts`](../../apps/cms/src/hooks/slugify.ts) exports
one factory, `slugFrom(sourceField)`: a **field hook** that slugifies the value
it is given, or derives one from a sibling field when the editor left it blank.
That is `sanitize_title()` wired to a single field and reusable across
collections — `slugFrom('title')` in Posts and Pages, `slugFrom('name')` in
Categories. The collection does not know slugs exist, and the hook never
overwrites a slug someone typed, because slugs are public URLs.

**Collection hooks** are the document-scoped tier.
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
declares three: `beforeChange` is `wp_insert_post_data` — **its return value is
what gets saved** — and it stamps `publishedAt` the first time a post goes live
and defaults `_status` to `draft` on create; `afterChange` and `afterDelete` are
`save_post` and `after_delete_post`, and here they deliberately only log.

Watch both tiers fire in one request. This creates a post and deletes it again,
so it leaves the database as it found it:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

DOC=$(curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"title":"Lifecycle probe from chapter 1"}')

echo "$DOC" | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; print("created  id=%s  slug=%s  status=%s" % (d["id"], d["slug"], d["_status"]))'

ID=$(echo "$DOC" | python3 -c 'import json,sys; print(json.load(sys.stdin)["doc"]["id"])')
curl -s -X DELETE "http://localhost:3000/api/posts/$ID" \
  -H "Authorization: users API-Key $KEY" -o /dev/null
```

```
created  id=39  slug=lifecycle-probe-from-chapter-1  status=draft
```

You sent a title and nothing else. The field hook derived the slug and
`beforeChange` defaulted the status, and the delete fired `afterDelete` on the
way out.

The complete hook inventory for this repo is **six registrations**: three field
`beforeValidate` hooks sharing that one factory, plus `beforeChange`,
`afterChange` and `afterDelete` on Posts. The source of each, the log lines they
write and the ordering rules are
[03 §3.8](03-payload-for-acf-and-cpt.md) and
[03 · Payload §3.5](../learn/03-payload.md) — this chapter only places them.
**There is no `remove_action`, no priority integer, and no global hook registry
you can inspect at runtime** — hooks are arrays on the collection that declares
them.

### Medusa subscribers — the asynchronous half

[`apps/commerce/src/subscribers/review-created.ts`](../../apps/commerce/src/subscribers/review-created.ts):

```ts
export default async function reviewCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string; product_id: string }>) { … }

export const config: SubscriberConfig = {
  event: "review.created",
}
```

The closest analogue is `add_action('woocommerce_new_order', …)`, with one
difference the file states in its own comments: **the caller already got its
response before this function started.** If it throws, nobody finds out, so work
the user must be told about belongs in the workflow instead.
[04 · Medusa](../learn/04-medusa.md) has the five places Medusa lets you run code.

Registration is **by convention**: nothing imports that file. Medusa scans
`src/subscribers/**` at boot, and the same is true of `src/jobs/`, `src/api/` and
`src/admin/` — unfamiliar next to `add_action()`, familiar next to WordPress's
own plugin-header scan.

### Astro middleware — the request-scoped half

[`apps/storefront/src/middleware.ts`](../../apps/storefront/src/middleware.ts) is
the one file that sees every request to the public site:

```ts
export const onRequest = defineMiddleware(async (context, next) => {
  const { request, url, clientAddress } = context
  …
})
```

This is `template_redirect` plus `init` plus whatever Wordfence was doing — one
function, running before anything else your code owns, and it is where §1.2's
diagram put it. Today it does rate limiting and request logging, and nothing
else.

⚠️ **It does not do authentication, and nothing else does either.** The file's own
header says so: right now anyone can delete anything. That is a deliberate
teaching gap documented in
[09 · To production](../learn/09-to-production.md) §9.5, not a pattern to copy.

### The part with nowhere to live

In WordPress, one `functions.php` could legitimately hold a function that read a
post, a WooCommerce order and a user, then decided something about all three.
**No file in this repo can do that.** Payload's hooks see Payload. Medusa's
workflows see Medusa. Astro sees both, but only over HTTP, without transactions,
and without being able to roll either one back.

| Cross-cutting logic | WordPress | Here |
|---|---|---|
| "On publish, if the author has an open order, …" | one function | two services, a network hop, **no transaction** |
| "Email the customer who wrote this review" | one function | reviews carry free-text `author_name`; there is no customer record to join to — 🚫 |
| "Recalculate everything nightly" | one `wp_schedule_event` | a Medusa job, plus a decision about which process owns the truth |

When you need that, you choose an owner, give it an HTTP client, and accept that
the operation can half-succeed.
[06 · The worked example](06-the-worked-example.md) is the chapter about making
that choice deliberately.

**WordPress is genuinely better here**, and it is worth saying plainly: a single
process with everything in scope is a real feature, not a limitation you have
grown out of. You are trading it for independent deployment and independent
failure, and if your project never needed those, you just paid for nothing.

---

## 1.4 `wp-admin` became two admin panels, and that is permanent

```bash
curl -s -o /dev/null -w 'payload admin  HTTP %{http_code}\n' -L http://localhost:3000/admin
curl -s -o /dev/null -w 'medusa admin   HTTP %{http_code}\n' -L http://localhost:9000/app
```

```
payload admin  HTTP 200
medusa admin   HTTP 200
```

| | Payload admin | Medusa admin |
|---|---|---|
| URL | `http://localhost:3000/admin` | `http://localhost:9000/app` |
| Generated from | your collection config | Medusa's own dashboard |
| Edits | posts, pages, categories, media, users, settings | products, reviews, regions, keys |
| Custom UI here | **none** — no `admin: { components }` anywhere 📋 | **one widget** ✅ |
| Session | Payload JWT, `payload_crud` | Medusa JWT, `medusa_crud` |

The one piece of custom admin UI in the entire repo is on the Medusa side —
[`apps/commerce/src/admin/widgets/product-reviews.tsx`](../../apps/commerce/src/admin/widgets/product-reviews.tsx):

```tsx
export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductReviewsWidget
```

That is `add_meta_box()`: your React component compiled into someone else's admin
screen at a declared insertion point — zones, auth and the moderation panel it
renders are [05 §5.11](05-medusa-for-woocommerce.md). Payload accepts the same
kind of injection; this repo simply does not use it. 📋

Now the part nobody advertises. The two admins have **separate accounts in
separate databases**, even when the email is identical:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -t -A -F' | ' \
  -c "select 'payload', id, email, role from users;"
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -F' | ' \
  -c $'select \'medusa \', id, email from "user";'
```

```
payload | 1 | admin@local.test | admin
medusa  | user_01M19CSFB69XZGS7WTGW89QWK3 | admin@local.test
```

Same address, two unrelated records, two different ID strategies. Changing the
password in one does nothing to the other. Offboarding a colleague is **two
tasks, in two systems, and forgetting one is a security incident.**

⚠️ **Two admin panels is a permanent cost, not a transitional one.** There is no
later milestone where they merge. You can hide it by building your own editor UI
against both APIs — but that is a product you now maintain, not a setting, and
every editor you onboard until then learns two interfaces and two logins. If
editorial convenience dominates your requirements, that is a legitimate reason to
stay on WordPress.

---

## 1.5 One database became two that cannot JOIN

In WordPress, `wp_posts`, `wp_postmeta`, `wp_users` and WooCommerce's tables all
live in one schema, and a JOIN across them is unremarkable. That is gone.

```bash
docker exec apm-postgres psql -U postgres -t -A \
  -c "select datname from pg_database where not datistemplate order by datname;"
```

```
medusa_crud
payload_crud
postgres
```

One container, one Postgres server, **two databases** — and in Postgres a
connection belongs to exactly one database. Try the JOIN and watch it refuse:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c "select p.title, r.title from posts p join review r on true limit 1;"
```

```
ERROR:  relation "review" does not exist
LINE 1: select p.title, r.title from posts p join review r on true l...
                                                  ^
```

The `review` table exists — it is in the other database, and from this connection
it may as well be on another continent. **This is not a configuration problem to
solve; it is the architecture.** Separate databases are what make the two
services independently deployable, migratable and restorable.

```bash
for db in payload_crud medusa_crud; do
  printf '%-14s ' "$db"
  docker exec apm-postgres psql -U postgres -d $db -t -A \
    -c "select count(*) || ' tables' from information_schema.tables
        where table_schema='public' and table_type='BASE TABLE';"
done
```

```
payload_crud   21 tables
medusa_crud    146 tables
```

Twenty-one tables came from five collection files and one global. One hundred and
forty-six came from Medusa's built-in modules, of which this repo wrote exactly
two (`review` and `uptime_check`).

⚠️ **That second number drifts.** [10 · Databases](../learn/10-databases.md)
counted 145; a module migration has landed since. The command is the fact; a
number in prose is a fact's expiry date.

So how *do* you relate a post to a product?

| Need | Mechanism |
|---|---|
| Relate two things **inside** Medusa | `defineLink()` → a generated link table ✅ |
| Relate two things **inside** Payload | a `relationship` field → a foreign key ✅ |
| Relate a Payload thing to a Medusa thing | store the other side's id as a plain string, join in application code |
| Enforce that relationship in the database | **you cannot** 🚫 |

This repo demonstrates the first — a Medusa link joins `product` to `review`
through a generated `product_product_review_review` table. It does **not**
demonstrate the third, because nothing here needs it, which is itself the right
lesson: do not reach across the boundary until a requirement forces you to.
[10 · Databases](../learn/10-databases.md) has both schemas and the two ID
strategies you saw in §1.4.

**WordPress is better here too, and it is not close.** One database, one backup,
one restore, one `JOIN`, referential integrity across your whole domain for free.
Make sure something in your requirements actually wants what you are trading it
for.

---

## 1.6 One plugin directory became four extension points

In WordPress there is one answer to "how do I add a capability": put a plugin in
`wp-content/plugins/` and activate it. One mechanism, essentially one directory
(`mu-plugins` and drop-ins aside), one admin screen, one update channel, one
wp.org with ratings and install counts.

Here there are four, and picking the wrong one is a real mistake.

| Extension point | WordPress analogue | Declared in | This repo |
|---|---|---|---|
| **npm package** | a plugin's vendored library | `package.json` | 27 direct deps across 3 apps ✅ |
| **Payload plugin** | a plugin adding post types/fields | `payload.config.ts` → `plugins` | **none** 📋 |
| **Medusa module** | a plugin adding its own tables | `medusa-config.ts` → `modules` | **6** ✅ |
| **Astro integration** | a theme feature | `astro.config.mjs` → `integrations` | **1** ✅ |

See all four in the real files:

```bash
echo '1 · npm packages (direct dependencies)'
for a in cms commerce storefront; do
  printf '   apps/%-11s ' "$a"
  python3 -c "import json; print(len(json.load(open('apps/$a/package.json')).get('dependencies',{})), 'direct')"
done
echo '2 · Payload plugins';    grep -n 'plugins:' apps/cms/src/payload.config.ts
echo '3 · Medusa modules';     grep -nE "key: Modules|resolve: '\./src/modules" apps/commerce/medusa-config.ts
echo '4 · Astro integrations'; grep -n 'integrations:' apps/storefront/astro.config.mjs
```

```
1 · npm packages (direct dependencies)
   apps/cms         12 direct
   apps/commerce    9 direct
   apps/storefront  6 direct
2 · Payload plugins
103:  plugins: [],
3 · Medusa modules
99:      key: Modules.CACHE,
104:      key: Modules.EVENT_BUS,
127:      key: Modules.WORKFLOW_ENGINE,
146:      key: Modules.LOCKING,
162:      resolve: './src/modules/review',
167:      resolve: './src/modules/ops',
4 · Astro integrations
38:  integrations: [react()],
```

Those 27 direct dependencies pull in several hundred packages per app on disk —
the npm bargain: small, composable, enormous in aggregate.

**`plugins: []` is empty on purpose.** Payload has a plugin ecosystem — SEO, form
builder, search, cloud storage — and this repo uses none of it, so everything in
`apps/cms/` is code you could have written yourself. 📋

Read the first four lines of that module output again: **only two of the six
modules are features.** The other four replace Medusa's in-memory cache, event
bus, workflow engine and locking with Redis-backed versions, in
[`apps/commerce/medusa-config.ts`](../../apps/commerce/medusa-config.ts).

There is no WordPress equivalent to that first group, and forcing one would be
dishonest. You never had to choose a cache driver, an event bus and a lock
manager to make `wp_schedule_event` run once instead of twice, because WordPress
assumed one process reading one database and `wp-cron` fired on a page view.
**This stack does not assume that, so you have to say it out loud.** That is the
problem the module system solves, and it is a problem WordPress mostly declined
to have. [04 · Medusa](../learn/04-medusa.md) covers modules properly.

What you lose with the ecosystem itself — separately from the §1.8 ledger:

| WordPress | Here |
|---|---|
| wp.org: ratings, install counts, "last updated 2 weeks ago" | npm, with none of that curation |
| Install from a web UI in 30 seconds | `npm install`, a config edit, a restart |
| One update screen for everything | `npm outdated` × 3, plus breaking-change reading |
| One plugin adds a post type, an admin screen and a shortcode | a collection file, an Astro component, possibly a Medusa module |

[07 · Cross-cutting](07-cross-cutting.md) takes your most-installed plugins —
Yoast, Gravity Forms, WPML, UpdraftPlus, Wordfence — one at a time.

---

## 1.7 The dev loop: three processes, three logs, five ports

WordPress development is "the site is running". Here **three things must be
running, and one of them is a container.**

```bash
npm run db:up      # Postgres + Redis, Docker, stays up between sessions
npm run dev        # the three Node processes, via concurrently
```

| What | Port | Started by | Log |
|---|---|---|---|
| Postgres | 5433 → 5432 | `npm run db:up` | `docker logs apm-postgres` |
| Redis | 6379 | `npm run db:up` | `docker logs apm-redis` |
| Payload (Next) | 3000 | `npm run dev` | `logs/cms.log` |
| Medusa | 9000 | `npm run dev` | `logs/commerce.log` |
| Astro | 4321 | `npm run dev` | `apps/storefront/.astro/dev.log` |

```bash
ss -ltn 2>/dev/null | grep -E ':(3000|9000|4321|5433|6379) ' | awk '{print $4}' | sort
```

```
*:3000
*:9000
0.0.0.0:5433
0.0.0.0:6379
127.0.0.1:4321
[::]:5433
[::]:6379
```

`npm run dev` prefixes every line with `[cms]`, `[commerce]` or `[store]` and
tees all three to `logs/`. Only two of those files are useful: Astro 7
backgrounds its own dev server when stdout is not a TTY, so
`logs/storefront-launch.log` holds just the launch notice and the real request
log is the JSON-lines file `apps/storefront/.astro/dev.log` —
[12 · Operating it §12.6](../learn/12-operating-it.md).

| WordPress habit | Replacement here |
|---|---|
| "the site is broken" | **ask which of the three is broken** — `/monitor`, or curl each port |
| read `debug.log` | read three logs; `npm run logs` tails all of them |
| edit a file, refresh | still true — all three hot-reload |
| add a field, refresh | still true in dev: Payload's `push` diffs the config against the live DB |

That last row is the pleasant surprise, and it is closer to the ACF experience
than anything else in this stack. Its sharp edges — `push` cannot cleanly drop
columns, and can block startup waiting for a `(y/N)` you never see — are in
[03 · Payload §3.12](../learn/03-payload.md).

⚠️ **The container outlives `npm run dev`.** Stopping the dev servers does not
stop Postgres, and a stale detached Astro dev server can keep serving an old
route table after you think you restarted. When something is inexplicably stale,
check both layers separately before changing any code;
[02 · Infrastructure](../learn/02-infrastructure.md) is the chapter for this and
is worth reading end to end early.

---

## 1.8 The blunt ledger: what you gain, what you lose

No hedging. Both columns are real.

| Gain | Why it is real here |
|---|---|
| Independent failure | Medusa can be down and `/posts` still renders — the dashboard `settle()`s each call |
| Independent deployment | the storefront ships without touching the CMS |
| The frontend is not the CMS's problem | Astro, a mobile app, a kiosk — all are just HTTP clients |
| Content is structured, not markup | rich text is a node tree; blocks are typed — [03 §3.7](../learn/03-payload.md) |
| Secrets stay on the server | API keys live in Astro's process and never reach the browser |
| Typed data access | `npm run typecheck` (`astro check`) catches a field the storefront's own types no longer carry — though **not** a rename made in Payload; see the losses table |
| Real transactional rollback | Medusa workflows compensate step by step; `npm run test:compensation` proves it |
| Real observability primitives | uptime history, workflow states, request log — [12](../learn/12-operating-it.md) |

| Loss | The honest size of it |
|---|---|
| **More moving parts** | 3 Node processes + Postgres + Redis, versus one PHP process |
| **Two admin UIs** | permanent; two logins, two user tables, two offboarding tasks (§1.4) |
| **No one-click plugin ecosystem** | no wp.org, no ratings, no install-and-activate, no single update screen |
| **You write your own SEO** | no Yoast; `<head>`, sitemaps, canonicals, structured data are yours |
| **You write your own forms** | no Gravity Forms; an Action plus a zod schema plus markup, per form |
| **You write your own caching** | no WP Super Cache; today every page render refetches the settings global |
| **Much higher setup cost** | a `.env` per app, two seeds, a bootstrap script, two kinds of API key |
| **No cross-service JOIN** | §1.5 — and no foreign key can enforce a cross-service relationship |
| **No cross-service transaction** | an operation touching both services can half-succeed |
| **Types are not shared end to end** | `payload-types.ts` is generated and imported **nowhere**; the storefront hand-writes its own in [`lib/types.ts`](../../apps/storefront/src/lib/types.ts) and explains why |
| **Localisation is not free** | Payload supports it, this repo does not configure it 📋 — your WPML instinct has no button to press |
| **No commerce flow** | products and reviews exist; cart, checkout, order, customer and payment are 🚫 |

That last row deserves emphasis, because the word "Medusa" invites the wrong
expectation. **This repo demonstrates reviews and operations built on Medusa's
product module. It is not a commerce demo.** Regions, shipping options, tax
regions and price rows exist in the database only because Medusa's stock starter
seed created them; no code here reads any of them.
[05 · Medusa for WooCommerce developers](05-medusa-for-woocommerce.md) has the
primitive-by-primitive verdict.

**If you read only part of the losses table, read the last four rows.** Those are
the ones that turn into a redesign rather than an afternoon.

| Your project | Verdict |
|---|---|
| Brochure site, one editor, a theme and six plugins | **stay on WordPress** — the whole cost, none of the benefit |
| One content model, several frontends (web, app, in-store screen) | this stack earns its keep |
| A team shipping the frontend weekly, the content model quarterly | independent deployment is worth real money |
| An existing WooCommerce store that works | migrating is a project, not a refactor |
| Editorial polish above all | WordPress's single admin is a genuine advantage |

---

## 1.9 Proof: the three health surfaces

Everything above rests on one claim: there are three independent programs. Here
are all three answering for themselves, each in its own idiom — which is itself
the lesson. **Three services means three health conventions.**

```bash
printf '%-12s ' 'payload'
curl -s http://localhost:3000/api/posts/stats \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("HTTP up —", d["counts"]["posts"], "posts visible anonymously")'

printf '%-12s ' 'medusa'
curl -s -w ' (HTTP %{http_code})\n' http://localhost:9000/health

printf '%-12s ' 'astro'
curl -s http://localhost:4321/api/health \
  | python3 -c '
import json,sys
d = json.load(sys.stdin)
print("ok =", d["ok"])
for name, s in d["services"].items():
    print("%-12s   └─ %-8s ok=%-5s %s" % ("", name, s["ok"], s["detail"]))'
```

```
payload      HTTP up — 85 posts visible anonymously
medusa       OK (HTTP 200)
astro        ok = True
               └─ payload  ok=True  103 posts (3 draft), authenticated as admin@local.test
               └─ medusa   ok=True  33 approved reviews, products reachable
```

Four things in five lines of output.

**Three different answers to "are you alive".** Medusa returns the two bytes
`OK`. Payload has no health route at all, so you ask it a cheap real question
instead. Astro returns structured JSON. Nobody standardised this for you.

**Payload reports fewer posts than Astro does** — six versus eight, from the
same database at the same moment. Not a bug: the anonymous `curl` is subject to
Payload's `read` access rule, which returns a *query* rather than a boolean, so
drafts simply do not exist for it, while the storefront sends an API key and sees
them. [03 · Payload §3.4](../learn/03-payload.md) is the full explanation, and it
is the single best idea in Payload.

**Astro's health check is about its dependencies, not itself.** Stop Payload and
it returns **503 even though Astro is running perfectly** — correct, because a
storefront that cannot reach its CMS cannot serve pages, and also the reason one
root cause produces two alerts.
[12 §12.9](../learn/12-operating-it.md) walks that experiment.

**The numbers will not match these.** They moved twice while this chapter was
being written, because other work on the repo was creating posts. In a system of
three programs, **a number you wrote down is a number that has already changed.**
Run the command.

---

## Check yourself

1. A browser request for `/` produced six HTTP requests to two backends. Name
   which file issued each group, and why five of them share one `Promise.all`.
2. You need to normalise a field's value before it is saved, across three
   collections. Payload field hook or collection hook, and why?
3. `wp_schedule_event` needed no dependencies. A Medusa job needs Redis locking
   to run exactly once. What changed about the assumptions?
4. A colleague leaves. List every place you must remove their access, and say
   what happens if you forget one.
5. You want "posts by the author of this product review" on a page. Where does
   that join happen, what can enforce it, and what can go wrong that could not go
   wrong in WordPress?
6. `payload-types.ts` is regenerated on every type run and imported by nothing.
   Why does the storefront hand-write its own types, and what does that cost?
7. The anonymous stats call and the storefront health check disagreed about how
   many posts exist. Explain the mechanism without using the word "permission".
8. Describe a project where this entire stack would be the wrong choice, and name
   the specific row of the §1.8 losses table that makes it wrong.

---

**Next:** [02-concept-map.md](02-concept-map.md) — every WordPress concept you
own, mapped to its counterpart here, including the honest list of the ones that
have no counterpart at all.
