# 2 · The concept map — every term, mapped

> Counterpart in the main course: [08 · Glossary](../learn/08-glossary.md).

This is the chapter you will come back to. It is mostly tables, and the column
that earns its space is the last one: **what actually differs**. An equals sign
would be a lie in most of these rows. ACF fields are not Payload fields with a
different syntax, and WooCommerce orders are not Medusa orders that nobody got
round to writing.

Where WordPress is simpler, better, or solved the problem first, the table says
so. That happens more often than the headless marketing material admits.

---

## 2.1 Every row carries a label, and the label is the point

Three labels, used in every row, and they are not decoration:

| Label | Means | What you may do with it |
|---|---|---|
| ✅ | **Running here.** Real file, real route, real rows in the database. | Run the commands. Open the file. |
| 📋 | **Built into the framework, not configured in this repo.** | Read it as a concept. There is no command. |
| 🚫 | **Not here at all.** No code, no rows, no config. | Treat it as a gap to be aware of, not a feature to find. |

The 📋 rows matter most: reach for something WordPress gave you free and the
framework will not stop you, it will simply not do it until you configure it.

⚠️ **A 🚫 row is never an invitation to go looking harder.** Several of them —
cart, checkout, order, customer — exist in Medusa and are genuinely absent from
*this* repo. Searching the codebase for them wastes an afternoon; §2.5 says
exactly which.

Every row that names a repo feature links to the main course chapter that
teaches it. This chapter is a map, not a tutorial: it says where a thing lives
and what is different about it, then hands you off.

---

## 2.2 Content modelling: ACF is the bridge, and it carries most of the traffic

Know ACF Pro well and you already understand most of Payload: the field types
map nearly one to one. What does *not* map is everything around them — where
values are stored, who may register a field, and when.

| WordPress | Here | What actually differs |
|---|---|---|
| Post | ✅ `posts` collection — [`Posts.ts`](../../apps/cms/src/collections/Posts.ts) | Nothing is built in. `posts` exists because somebody wrote a 183-line file. Delete it and the concept of a post stops existing. WordPress ships `post` and `page` as fixtures of the product. |
| Page | ✅ `pages` collection — [`Pages.ts`](../../apps/cms/src/collections/Pages.ts) | Same mechanism as Posts, different fields. WordPress's Page is a built-in type with a template dropdown; here it is an ordinary sibling of Posts that happens to have a `blocks` field and deliberately **no drafts**. |
| Custom Post Type | ✅ one more file in [`src/collections/`](../../apps/cms/src/collections/) plus one entry in the `collections` array | `register_post_type()` runs on `init`, on **every request**, and any plugin can call it. Payload's array is read once at boot and diffed against the database. You gain generated REST, GraphQL and TS types; you lose runtime registration entirely. |
| `register_taxonomy` / category / tag | ✅ `categories` collection + a `relationship` field on Posts | **There is no taxonomy system.** A category is just another collection and the link is a plain foreign key. No hierarchy, no term meta, no `wp_term_taxonomy` indirection, and no shared vocabulary across collections unless you point more fields at the same one. WordPress's taxonomy layer is genuinely more powerful than this. |
| Tag (as a free-text list) | ✅ `tags`, an `array` field of `{ tag: text }` | An `array` field becomes **its own Postgres table**, `posts_tags`, with a parent FK and an order column. WordPress would put these in `wp_terms` and share them site-wide; here they are private to the post and carry no identity, so "all posts tagged X" is a string comparison, not a join on a term id. |
| ACF field | ✅ one object in the `fields` array | **The core mapping of this whole track.** ACF stores a value in `wp_postmeta` under a `meta_key`, as a string that is serialized only when it is an array or object; a Payload field becomes a real typed column in the collection's table. Taught in [03 · Payload](../learn/03-payload.md) §3.3. |
| ACF field group | ✅ the `fields` array itself | ACF binds a group to a **location rule** — "post type = product AND template = landing". Payload has no location rules. Fields belong to the collection, full stop. Conditional field display exists (`admin.condition`) but 📋 — nothing in `apps/cms/src/` uses it. |
| ACF Flexible Content | ✅ `blocks` field — `layout` in [`Pages.ts`](../../apps/cms/src/collections/Pages.ts) | The closest analogue in the stack, and it behaves the way you expect: named layouts, each with its own fields, reorderable. The difference is on disk — each block type gets **its own table** (`pages_blocks_hero`, …), where ACF puts the whole structure in one serialized meta row. |
| ACF Repeater | ✅ `array` field | Same idea, same per-row table cost. |
| ACF Options Page | ✅ a **global** — [`SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts) | ACF options write into `wp_options`, mixed in with everything else WordPress keeps there. A Payload global is a typed record in its own table with exactly one row, its own REST path (`/api/globals/site-settings`) and only GET and POST — there is nothing to create or delete. |
| `get_post_meta` / `wp_postmeta` | 🚫 **no equivalent** | There is no key-value side table and no `add_post_meta`. If a field is not in the config, it has nowhere to go. This is a real loss of flexibility and a real gain in integrity: orphaned meta rows left behind by a plugin you removed years ago are not a thing that can happen here. |
| `wp_options` | ✅ the global (for editable settings) + `.env` files (for configuration) | The split is deliberate. WordPress keeps the site tagline and the Stripe API key in the same table, both editable by anyone with admin. Here, content lives in Postgres and secrets live in environment files the editor never sees — see [02 · Infrastructure](../learn/02-infrastructure.md). |
| Revisions | ✅ `versions: { drafts: true, maxPerDoc: 10 }` on Posts | WordPress revisions are rows in `wp_posts` with `post_type = 'revision'`, and unbounded unless you set `WP_POST_REVISIONS` — which is why trimming them is a standard maintenance job on a long-lived site. Payload puts them in a **separate table** (`_posts_v`) and caps them. Pages has versions **off** on purpose, so you can see the cost difference. |
| Draft / Publish / Pending / Private | ✅ `_status`, which is `'draft' \| 'published'` — two states | WordPress core registers eight statuses — `publish`, `future`, `draft`, `pending`, `private`, `trash`, `auto-draft`, `inherit` — plus whatever plugins add. Payload has two. `pending` and `private` have no equivalent; moderation queues are something you model yourself (Medusa's reviews do exactly that, with a three-value `status` enum). |
| Scheduled publishing | 🚫 **not here** | `publishedAt` is stamped by a `beforeChange` hook the first time a post goes live ([`Posts.ts:130-141`](../../apps/cms/src/collections/Posts.ts)); nothing reads a future date and flips the status later. WordPress's `future` status plus WP-Cron does this out of the box. |
| Permalink / slug | ✅ a `slug` field with a `beforeValidate` field hook — [`slugify.ts`](../../apps/cms/src/hooks/slugify.ts) | WordPress generates `post_name` for you and gives you a settings page of permalink structures. Here the slug is an ordinary unique, indexed column, the URL shape is decided by the Astro file tree, and there is no rewrite layer at all. |
| Media Library | ✅ `media` collection with `upload` — [`Media.ts`](../../apps/cms/src/collections/Media.ts) | Same idea: metadata in the database, files on disk, named size variants generated on upload (`thumbnail` 400×300, `card` 768×512). ✅ **Exercised here**: the seed generates a cover per guide and uploads it, so `apps/cms/public/media` holds 264 files for 88 documents — the original plus both derivatives. |
| `wp_get_attachment_image` / `srcset` | 🚫 **no equivalent** | Payload generates the size variants and exposes them under `doc.sizes`; nothing in this repo builds a `srcset` from them. WordPress does responsive images automatically, and that is a real convenience you are giving up. |

**Two differences cause most of the pain.** First, **a field is code, so adding
one is a deploy** — in ACF you add it in the admin and it is live; here you edit
a `.ts` file and Postgres gets a column. If a non-developer adding fields is
part of your workflow, this stack is a downgrade for it, and the client should
hear that up front. Second, **values are columns, not meta**: a filter is
`?where[title][contains]=CRUD` against a real column rather than the
`meta_query` join your host warns you about (§2.4 runs it).

See it: the `tags` array and the three `layout` block types each got a table.

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep -E 'posts|pages'
```

```
 public | _posts_v                      | table | postgres
 public | _posts_v_version_tags         | table | postgres
 public | pages                         | table | postgres
 public | pages_blocks_hero             | table | postgres
 public | pages_blocks_prose            | table | postgres
 public | pages_blocks_stats            | table | postgres
 public | pages_blocks_stats_items      | table | postgres
 public | posts                         | table | postgres
 public | posts_tags                    | table | postgres
```

Nine tables for two collections — [10 · Databases](../learn/10-databases.md)
§10.2 explains why, and it is the clearest picture of the trade: WordPress buys
schema flexibility with one wide meta table and pays in queries; Payload buys
query performance with many narrow tables and pays in migrations.

---

## 2.3 Templating: the hierarchy becomes a file tree, and the loop disappears

WordPress habits misfire hardest here, because the shapes look similar and the
rules are not.

| WordPress | Here | What actually differs |
|---|---|---|
| Theme | 🚫 **no equivalent** | [`apps/storefront`](../../apps/storefront/) is an application, not a theme. There is no theme directory, no `style.css` header, no switcher, and no concept of "the active theme". Swapping the front end means deploying a different app. |
| Child theme | 🚫 **no equivalent** | Nothing overrides anything by filename precedence. If you want a variant, you copy a component or parameterise it. The whole override-by-convention mechanism is gone. |
| Template hierarchy | ✅ file-based routing — [`src/pages/`](../../apps/storefront/src/pages/) | WordPress walks a cascade: `single-product.php` → `single.php` → `singular.php` → `index.php`. Astro does **not** cascade. A URL matches exactly one file or it 404s. Simpler to reason about, and you lose the free fallback you never had to think about. |
| `single.php` | ✅ [`posts/[slug].astro`](../../apps/storefront/src/pages/posts/) | The `[slug]` in the filename is the parameter. There is no `$post` in scope — you fetch the document yourself in the frontmatter. |
| `archive.php` | ✅ [`posts/index.astro`](../../apps/storefront/src/pages/posts/) | Same: you call `listPosts()` and map over the result. No query is implied by the file's name. |
| `page.php` | ✅ [`pages/[slug].astro`](../../apps/storefront/src/pages/pages/) | Renders Payload blocks as components, one component per `blockType`. |
| `header.php` / `footer.php` | ✅ one file — [`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) | WordPress splits the page into two half-open HTML fragments and relies on you calling both. Astro's layout is a **complete document with a slot**; the page is placed inside it. You cannot forget the footer, and you cannot leave a `<div>` unclosed across two files. |
| `get_header()` / `get_footer()` | ✅ `<Layout>…</Layout>` wrapping the page body | Composition, not sequential includes. |
| `get_template_part()` | ✅ an ordinary ES import of a `.astro` component | A template part receives globals and whatever is in scope. An Astro component receives **declared, typed props** and nothing else. More typing, far fewer "why is `$post` empty here" bugs. |
| The Loop | 🚫 **no equivalent, and nothing replaces it** | There is no global query, no `have_posts()`, no `the_post()` advancing a pointer, no `$post` to set up. You fetch an array and `.map()` over it. Everything the loop did implicitly — template tags reading the current post — is now an explicit variable. This is more code and less magic, in both directions. |
| Template tags (`the_title()`, …) | 🚫 **no equivalent** | `{post.title}`. There is no function that knows which post you mean, because nothing is ambient. |
| `wp_head()` / `wp_footer()` | 🚫 **no equivalent** | No plugin can inject into your `<head>`, which also means **nothing injects into your `<head>`** — no analytics, no SEO tags, no emoji script. You write every tag in `Layout.astro` yourself. Yoast's output is a thing you now hand-roll. |
| Shortcode | 🚫 **no equivalent** | Nothing scans content for `[gallery]` and substitutes markup. Rich text here is a Lexical node tree rendered by [`lexical.ts`](../../apps/storefront/src/lib/lexical.ts); an unknown node recurses into its children rather than being replaced. Shortcodes are genuinely convenient and genuinely absent. §2.10 says more. |
| Widget area / `register_sidebar` | 🚫 **no equivalent** | There is no drop zone an editor can fill. The nearest thing is reading a Payload global in the layout — the nav and announcement banner in `Layout.astro` come from `site-settings` — but the *positions* are fixed in code. |
| Gutenberg block | ✅ a Payload `blocks` entry + an Astro component | A Gutenberg block is editor UI plus markup — saved into `post_content` between HTML-comment delimiters, or, for a dynamic block, re-rendered on each request by a server callback. A Payload block is **structured rows**; the storefront decides the markup. You cannot paste the content into another system and get HTML, and you can render the same block as HTML, JSON or a native view. |
| Elementor section / widget | ✅ the same `blocks` field, with a much smaller menu | Elementor gives the editor near-total layout control and emits markup you did not design. Blocks give the editor **ordering and content** within a contract you wrote. For clients who expect Elementor's freedom, this is a downgrade and needs to be sold as a decision, not presented as an upgrade. |

**The thing to internalise: pages ship no JavaScript unless you ask.** Astro
renders components to HTML on the server and sends no runtime. A component only
becomes interactive when you add a `client:` directive, and in this entire
storefront there is **exactly one**, on
[`ReviewFilter.tsx`](../../apps/storefront/src/components/ReviewFilter.tsx) at
[`reviews/index.astro:76`](../../apps/storefront/src/pages/reviews/index.astro).

Prove it. Every island arrives in the HTML inside an `<astro-island>` element,
so counting the opening tags counts the islands. `/posts` does full create, edit
and delete; `/reviews` has one filter widget:

```bash
for p in /posts /reviews; do
  n=$(curl -s "http://localhost:4321$p" | grep -o '<astro-island' | wc -l)
  echo "$p  islands: $n"
done
```

```
/posts  islands: 0
/reviews  islands: 1
```

⚠️ **Grep for the bare string `astro-island` and you get seven on `/reviews`** —
the extra six are Astro's own runtime script and stylesheet mentioning the
element name. Count the `<` too.

Zero islands on the page that does CRUD; one on the page with a filter. The
WordPress comparison is not "WordPress ships more JavaScript" — a block theme
can ship almost none. It is that `wp_enqueue_script` is additive and nothing
reports the total: the theme enqueues, each plugin enqueues, and you find out
by loading the page. Here the total is the grep above.
[05 · Astro](../learn/05-astro.md) §5.11 has the directive list and what each
one costs.

---

## 2.4 Data and APIs: `WP_Query` becomes a URL, and there are now four API roots

WordPress has one query object and one API root. This stack has three query
languages across **four roots** — `:3000/api/*`, `:9000/store/*`,
`:9000/admin/*` and `:4321/api/*` — and knowing which you are talking to is most
of the battle.

| WordPress | Here | What actually differs |
|---|---|---|
| `WP_Query` | ✅ Payload query params (`where`, `sort`, `limit`, `depth`, `select`) — [03 §3.10](../learn/03-payload.md) | Both are declarative filter objects. The difference: `WP_Query` is one API over one schema, so a plugin can filter it with `pre_get_posts` and change every query on the site. Payload's query is per-request, per-collection, and **nothing can rewrite it from outside** except the collection's own access function. |
| `get_posts()` | ✅ `listPosts()` in [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts) | `get_posts()` talks to the database in the same process. `listPosts()` makes an **HTTP request to another service**. Every data read in the storefront is a network call, which is why failures are handled per call — see the `settle()` wrapper on the dashboard. |
| `$wpdb` | ✅ `payload.db.drizzle.execute(sql\`…\`)` in [`endpoints/schema.ts`](../../apps/cms/src/endpoints/schema.ts); ✅ `docker exec apm-postgres psql` | Both exist and both are escape hatches. The difference is that `$wpdb` is the normal way to do anything slightly unusual in WordPress, and dropping to raw SQL here is rare enough that the repo does it in exactly one endpoint. |
| WP REST API | ✅ generated by Payload; ✅ hand-written in Medusa | Payload's REST surface is **free** — add a collection and you get list, create, read, update, delete, bulk update, bulk delete, `/count`, `/versions` and duplicate, plus a GraphQL schema and an admin screen, without writing a route. Medusa's is the opposite: every route in [`apps/commerce/src/api/`](../../apps/commerce/src/api/) is a file somebody wrote. Same stack, two opposite philosophies, deliberately. [04 · Medusa](../learn/04-medusa.md) covers the second. |
| `/wp-json/` | ✅ three services, four roots: `:3000/api/*`, `:9000/store/*`, `:9000/admin/*`, `:4321/api/*` | WordPress has one base URL for everything. Here, which root you use determines **which credential you need** and what the response shape is. §2.6 has the matrix. |
| `register_rest_route()` | ✅ three different mechanisms | Payload: an `Endpoint` object in `endpoints: [...]` ([`postStats.ts`](../../apps/cms/src/endpoints/postStats.ts)). Medusa: a file at a path, `src/api/store/reviews/route.ts`, exporting `GET`/`POST`. Astro: a file at `src/pages/api/*.ts`. Three frameworks, three conventions, no shared idea of "registering" anything. |
| `admin-ajax.php?action=foo` | ✅ Astro Actions — POST to the page URL with `?_action=post.create` | A genuinely close parallel, including the shape of the URL. The differences: the Action is **typed and zod-validated** with field-level errors, and there is no single global router every plugin registers into — an Action exists only because this app declared it. It is not *protected*, though: the storefront has no authentication, so anyone who can reach `:4321` can call one (§2.6). See [`actions/index.ts`](../../apps/storefront/src/actions/index.ts). |
| `admin-post.php` (form POST, no JS) | ✅ the same Actions with `accept: 'form'` | This is the part worth noticing: Actions work with **JavaScript disabled**, exactly like `admin-post.php`. The browser posts, the handler runs, the page re-renders with the result. Progressive enhancement is the main argument for Pattern A over hand-written endpoints. |
| `wp_ajax_nopriv_*` | 🚫 **no equivalent** | There is no notion of a logged-out variant of a handler. Astro's storefront has **no authentication at all** right now ([09 §9.5](../learn/09-to-production.md)), so every endpoint is effectively `nopriv`. |
| `set_transient` / `get_transient` | 🚫 **no equivalent you can call** | Medusa runs a Redis cache module ([`medusa-config.ts`](../../apps/commerce/medusa-config.ts)), but that is framework infrastructure — no route or service in this repo reads or writes it. There is no page cache, no object cache API, and no `wp_cache_*`. WordPress gives you a caching API out of the box; this stack gives you Redis and a blank page. |
| WP-Cron | ✅ Medusa scheduled jobs — [`jobs/uptime-check.ts`](../../apps/commerce/src/jobs/uptime-check.ts), [`jobs/review-digest.ts`](../../apps/commerce/src/jobs/review-digest.ts) | **The difference is the trigger.** By default WP-Cron is fired by a *visitor's page view* (many installs set `DISABLE_WP_CRON` and drive it from system cron instead), so an untouched site runs no jobs and a site with lots of traffic checks the schedule constantly. Medusa has a real scheduler in the process: it fires on schedule whether or not anyone visits. The flip side is that it fires **once per instance** unless the Redis locking module stops it — WP-Cron has the same problem and guards it with a `doing_cron` lock. |

Two things to run. First, a `where` query — `meta_query` without the join:

```bash
curl -gs 'http://localhost:3000/api/posts?where[title][contains]=CRUD&limit=50&depth=0' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("matched:", d["totalDocs"]); [print(" -", p["title"]) for p in d["docs"]]'
```

```
matched: 1
 - How routing works in Astro
```

⚠️ **`curl` needs `-g` whenever the URL contains `[` or `]`** — without it you
get `bad range in URL position`.

Second, proof that the scheduler runs without traffic. Nobody visited anything
to make these rows appear:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c \
  "select target, count(*) as checks, max(created_at) as latest
     from uptime_check where created_at > now() - interval '10 minutes'
    group by target order by target;"
```

```
   target   | checks |           latest           
------------+--------+----------------------------
 medusa     |      9 | 2026-10-01 15:05:08.285+00
 payload    |      9 | 2026-10-01 15:05:08.285+00
 storefront |      9 | 2026-10-01 15:05:08.285+00
(3 rows)
```

Your timestamps will differ and the count will land somewhere around nine to
eleven depending where in the minute you run it — one sample a minute, per
target, with an idle browser.
[12 · Operating it](../learn/12-operating-it.md) §12.2 is the chapter for this.

---

## 2.5 Commerce: Medusa has every WooCommerce noun, and this repo uses four

Read these labels more carefully than any others in the chapter. The gap between
"Medusa supports it" and "this repo does it" is widest here, and the seed data
hides the gap if you only look at the database. **What this repo demonstrates is
reviews and operations built on Medusa's product module** — not a commerce demo.
Region, shipping, tax and inventory rows exist because `seed.ts` is Medusa's
stock starter seed, not because anything reads them.

| WooCommerce | Here | What actually differs |
|---|---|---|
| Product | ✅ Medusa's product module, read-only — [`lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts) | A WooCommerce product is a CPT with meta. A Medusa product belongs to a separate, isolated module with its own tables and its own service. You cannot JOIN to it from your code; you go through Query. |
| Product variation | ✅ **40 rows, rendered as a plans table** | `product_variant` holds the plan tiers. [`apps/storefront/`](../../apps/storefront/src/pages/products/) asks for `variants.title`, `variants.sku` and `*variants.calculated_price` — note the title has to be named explicitly, since expanding the price does not bring the variant with it. |
| Price | ✅ **86 price rows, in EUR and USD** | Medusa's pricing module does real work: price sets, currency rules, region rules. The storefront renders the cheapest variant as a "from €X" label and lists every tier on the detail page. ⚠️ A read without `region_id` returns no price at all — the single most confusing thing about Medusa pricing. |
| Cart | 🚫 **nothing creates one** | `cart` has zero rows, and every occurrence of the word in this repo's own source is a comment (three of them, in `medusa-config.ts`, `lib/medusa.ts` and `admin/schema/route.ts`). Medusa has a full cart module; this repo never touches it. |
| Checkout | 🚫 **zero occurrences in the entire codebase** | Not stubbed, not started. |
| Order | 🚫 **no custom code, zero rows** | ⚠️ **Not one match for `order` in this repo is an order.** Every hit is a sort parameter (`order: '-created_at'`), a SQL `order by`, a widget zone name like `order.details.before`, or the English word. Grepping for order handling will mislead you badly; this is the most common wrong turn in the codebase. |
| Customer | 🚫 **no custom code, zero rows** | Reviews carry a free-text `author_name` and `author_email` and are **not** linked to a customer record — see [`models/review.ts`](../../apps/commerce/src/modules/review/models/review.ts). WooCommerce stores a review as a comment, which carries a `user_id` when the reviewer was logged in (guests leave it empty); here there is no user to point at at all. |
| Coupon | 🚫 **zero occurrences** | Medusa calls this a promotion. Nothing here uses it. |
| Shipping zone / method | 📋 **1 region ("Europe", EUR, 7 countries) and 2 shipping options seeded** | Configured by the stock seed, read by nothing. |
| Tax class / tax rate | 📋 **tax regions seeded for 7 countries** | Same. |
| Stock / inventory | 📋 **20 inventory levels, 1 stock location** | Same. Medusa separates inventory from variants (a variant can be stocked in several locations); WooCommerce keeps a stock number in post meta. |
| Payment gateway | 🚫 | Only `payment_providers: ['pp_system_default']` on the seeded region. No gateway, no payment rows. |
| WC REST API consumer key / secret | ✅ two different credentials, not one pair | The store surface uses a **publishable key** in `x-publishable-api-key`; the admin surface uses a **JWT** obtained by logging in. WooCommerce's single key/secret pair covers both. §2.6 has the matrix. |
| Product reviews | ✅ a **custom module** — [`modules/review/`](../../apps/commerce/src/modules/review/) | WooCommerce reuses `wp_comments` with a `comment_type` of `review`, so you get threading, moderation and spam filtering for free. Medusa has no comment system, so reviews here are a hand-written module: a model, a service, migrations, routes, workflows, a link table and an admin widget. **That is the whole lesson of [04 · Medusa](../learn/04-medusa.md)** — and WordPress genuinely gets this feature for less work. |
| Review moderation queue | ✅ `status` enum `pending \| approved \| rejected` | Closely mirrors WordPress comment moderation, including the admin screen — but the screen is [a React widget somebody wrote](../../apps/commerce/src/admin/widgets/product-reviews.tsx), not a built-in. |

See the gap for yourself. Rows exist; code does not:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -c \
  "select 'product', count(*) from product
   union all select 'product_variant', count(*) from product_variant
   union all select 'price', count(*) from price
   union all select 'cart', count(*) from cart
   union all select 'order', count(*) from \"order\"
   union all select 'customer', count(*) from customer
   union all select 'promotion', count(*) from promotion
   union all select 'review', count(*) from review;"
```

```
 product         |     4
 product_variant |    20
 price           |    46
 cart            |     0
 order           |     0
 customer        |     0
 promotion       |     0
 review          |    24
```

Your review count will differ; the rest will not, because nothing here writes to
those tables. Forty-six price rows — and
[`medusa.ts:42`](../../apps/storefront/src/lib/medusa.ts) asks for
`id,title,handle,description,thumbnail` and stops.

**If you are quoting a WooCommerce migration, price this honestly.** Everything
in the 📋 and 🚫 rows above is work that WooCommerce had already done for you,
and most of it is not a weekend.

---

## 2.6 Users and auth: one `wp_users` table becomes three credential systems

WordPress has one identity — a `wp_users` row, a cookie, a capability map — and
every part of the site agrees on who you are. That is not true here, and there
is no single sign-on between the three services.

| WordPress | Here | What actually differs |
|---|---|---|
| `wp_users` row | ✅ Payload `users` collection; ✅ a separate Medusa admin user; 🚫 Medusa customer (zero rows) | **Three user tables in two databases, with no relationship between them.** An editor who logs into `localhost:3000/admin` is not logged into `localhost:9000/app`, and neither is logged into the storefront, which has no login at all. |
| Role | ✅ a `role` select field, `admin \| editor` — [`Users.ts`](../../apps/cms/src/collections/Users.ts) | WordPress roles are data: rows in `wp_options` with capability maps, editable at runtime by any plugin. Here the role list is a TypeScript union. Adding a third role is a code change and a deploy. |
| Capability | 🚫 **no equivalent** | There is no capability registry, no `add_cap`, no per-user overrides. The unit of authorisation is **an operation on a collection**, and there are exactly four of them: `create`, `read`, `update`, `delete`. |
| `current_user_can()` | ✅ an access function per operation — [`Posts.ts:41-53`](../../apps/cms/src/collections/Posts.ts) | The important difference, and the best idea in Payload. `current_user_can()` returns a boolean and you then filter the result set yourself. A Payload `read` function may return a **`Where` query instead of a boolean**, and Payload merges it into the SQL. Drafts are not *forbidden* to anonymous readers — they do not exist. [03 §3.4](../learn/03-payload.md) |
| `map_meta_cap` / per-post permissions | 📋 | Access functions receive the document on update and delete, so per-document rules are expressible. Nothing in this repo writes one; every rule here is per-role. |
| Nonce (`wp_nonce_field`) | ✅ Astro's origin check (`security.checkOrigin`, on by default for SSR) | **Not the same mechanism, and worth understanding.** A nonce is a per-user, per-action, time-limited token embedded in the form. An origin check is a header comparison. The nonce also protects against replay and confirms intent; the origin check does neither. It runs **upstream of middleware**, which is why rejected requests never appear in the request log ([12 §12.3](../learn/12-operating-it.md)). |
| Application password | ✅ Payload API key (`useAPIKey: true`) | Closest match in the stack. The header format is exact and catches everyone: `Authorization: users API-Key <key>` — the collection slug, then a literal `" API-Key "`. Not `Bearer`. |
| — | ✅ Medusa **publishable key**, `x-publishable-api-key` | No WordPress equivalent. It is not a secret and not an identity; it tells Medusa which sales channel a storefront request belongs to. Omit it and every `/store/*` call returns 400. |
| — | ✅ Medusa **admin JWT**, from `POST /auth/user/emailpass` | Short-lived, obtained by logging in, cached in module scope by [`lib/medusa-admin.ts`](../../apps/storefront/src/lib/medusa-admin.ts). The Medusa admin dashboard uses a session cookie instead; the storefront cannot, so it logs in as a machine. |
| Logged-in check on the front end | 🚫 **the storefront has no authentication whatsoever** | ⚠️ **Anyone who can reach `:4321` can delete any post and moderate any review.** That is deliberate and documented in [09 §9.5](../learn/09-to-production.md), not an oversight — but it means every "users and roles" idea in this table stops at the backend boundary. |

Here is the whole credential story in one block. Note that each service rejects
the other's credential, and rejects it with a *different status code*:

```bash
set -a; . apps/storefront/.env; set +a
TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MEDUSA_ADMIN_EMAIL\",\"password\":\"$MEDUSA_ADMIN_PASSWORD\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

code () { curl -s -o /dev/null -w '%{http_code}' "$@"; }
printf '%-34s %s\n' 'payload /api/posts   (no cred)' "$(code 'http://localhost:3000/api/posts?limit=1')"
printf '%-34s %s\n' 'payload /api/users   (no cred)' "$(code 'http://localhost:3000/api/users?limit=1')"
printf '%-34s %s\n' 'payload /api/users   (API key)' "$(code 'http://localhost:3000/api/users?limit=1' -H "Authorization: users API-Key $PAYLOAD_API_KEY")"
printf '%-34s %s\n' 'medusa  /store/reviews (none)'  "$(code 'http://localhost:9000/store/reviews?limit=1')"
printf '%-34s %s\n' 'medusa  /store/reviews (pub)'   "$(code 'http://localhost:9000/store/reviews?limit=1' -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY")"
printf '%-34s %s\n' 'medusa  /admin/reviews (pub)'   "$(code 'http://localhost:9000/admin/reviews?limit=1' -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY")"
printf '%-34s %s\n' 'medusa  /admin/reviews (JWT)'   "$(code 'http://localhost:9000/admin/reviews?limit=1' -H "Authorization: Bearer $TOKEN")"
```

```
payload /api/posts   (no cred)     200
payload /api/users   (no cred)     403
payload /api/users   (API key)     200
medusa  /store/reviews (none)      400
medusa  /store/reviews (pub)       200
medusa  /admin/reviews (pub)       401
medusa  /admin/reviews (JWT)       200
```

Three credentials, three failure codes: **403** is Payload understanding you and
saying no, **400** is Medusa's store surface refusing to look at a request with
no publishable key, **401** is the admin surface wanting a JWT. In WordPress all
three are one cookie and one `wp_die()`.

Now the nonce analogue — Astro's origin check guarding unsafe methods:

```bash
for m in GET POST PATCH DELETE; do
  printf '%-7s no Origin: %s   with Origin: %s\n' "$m" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X $m http://localhost:4321/api/reviews/abc)" \
    "$(curl -s -o /dev/null -w '%{http_code}' -X $m -H 'Origin: http://localhost:4321' http://localhost:4321/api/reviews/abc)"
done
```

```
GET     no Origin: 404   with Origin: 404
POST    no Origin: 403   with Origin: 404
PATCH   no Origin: 403   with Origin: 400
DELETE  no Origin: 403   with Origin: 502
```

`GET` passes through untouched; the three unsafe methods are rejected with 403
before any of your code runs, which is why the right-hand column shows the real
answers from the handler. ⚠️ **The check keys on the content type, not only the
method** — a `Content-Type: application/json` POST with no `Origin` is let
through, because a cross-origin request with that content type needs a CORS
preflight first. Form-encoded bodies, the ones an attacker's `<form>` can send,
are what it blocks.

---

## 2.7 Extensibility: there is no global hook system, and that is the biggest loss

If you take one thing from this chapter, take this. WordPress's extensibility
model is its best engineering decision, nothing in this stack replaces it, and
no amount of TypeScript makes up for it.

| WordPress | Here | What actually differs |
|---|---|---|
| Plugin | ✅ three unrelated systems: Payload `plugins`, Medusa modules, Astro integrations | Payload's array is `plugins: []` in [`payload.config.ts:103`](../../apps/cms/src/payload.config.ts) — **none installed**. Medusa loads two custom modules by path. Astro loads `react()`. None of the three can extend either of the others. |
| Installing a plugin | 🚫 **no equivalent** | There is no registry UI, no one-click install, no activate/deactivate. You `npm install`, edit a config file, restart, and in Medusa's case possibly write a migration. |
| `mu-plugin` | 🚫 **no equivalent** | The nearest thing is a module listed in [`medusa-config.ts`](../../apps/commerce/medusa-config.ts), which cannot be turned off from any UI — but that is because there is no UI, not because it is privileged. |
| Action (`do_action`) | ✅ Payload collection hooks (`afterChange`, `afterDelete`); ✅ Medusa subscribers; 📋 Medusa **workflow hooks** | The first two are real and both work. The limit: a Payload hook is **declared inside the collection file**. Nothing external can attach to it. Medusa subscribers are closer in spirit — they are discovered by scanning [`src/subscribers/`](../../apps/commerce/src/subscribers/) and nothing imports them — but only a file in your own repo can be discovered. The genuine `do_action` analogue is Medusa's workflow hook: a built-in workflow calls `createHook('productTypesCreated', …)` and a file of yours registers a handler on it. **Nothing in this repo declares or consumes one**, so it is 📋. |
| Filter (`apply_filters`) | 🚫 **no general equivalent** | **This is the real gap.** Nothing lets arbitrary code intercept and rewrite an arbitrary value in flight. `the_content`, `wp_mail_from`, `woocommerce_get_price_html` — the open-ended version of that is gone. The nearest thing is a Medusa workflow hook, whose handler returns a value the workflow can read back — but only at the points a workflow chose to expose, and none of this repo's workflows expose any. The Payload equivalent of changing a value is editing the hook; the Medusa equivalent is editing the service. |
| `add_action` / `add_filter` | 🚫 **no global registry** | There is no `$wp_filter`, and no name you can attach to without the owning code having published it. Medusa's workflow hooks are the one place where an outside file registers a handler, and they reach only the workflows that declared a hook. |
| Hook priority | 🚫 **no equivalent** | Ordering is array order within one file: `hooks: { beforeChange: [a, b] }` runs `a` then `b`. There is no integer priority and no way to insert between them from elsewhere. |
| `remove_action` | 🚫 **no equivalent** | You delete the line. |
| Hook lifecycle coverage | ✅ six registrations, total | WordPress fires thousands of hooks. The CMS has six: three field `beforeValidate` hooks sharing the one [`slugFrom`](../../apps/cms/src/hooks/slugify.ts) factory (Posts, Pages, Categories), plus `beforeChange` / `afterChange` / `afterDelete` on Posts. No `afterRead`, no `beforeLogin`, no `afterOperation` — Payload supports those, they are 📋 here. The full table is [03 §3.8](03-payload-for-acf-and-cpt.md). |

**What you get in exchange is not nothing.** When a WordPress site behaves
strangely the cause can be any of forty plugins filtering a value you never see.
Here, everything that can modify a post on its way to the database fits in one
grep:

```bash
grep -rn 'hooks:' apps/cms/src/collections apps/cms/src/globals | sort
```

```
apps/cms/src/collections/Categories.ts:49:      hooks: {
apps/cms/src/collections/Pages.ts:57:      hooks: { beforeValidate: [slugFrom('title')] },
apps/cms/src/collections/Posts.ts:125:  hooks: {
apps/cms/src/collections/Posts.ts:72:      hooks: {
```

Four declarations — the entire extension surface of the CMS. Debuggability up,
extensibility down, and which you need depends on whether anyone else will build
on your work.

⚠️ **Do not try to rebuild `add_filter` here.** It fights every other decision
in the stack: module isolation, typed contracts, and knowing at compile time
what a function returns.

---

## 2.8 Ops: one config file becomes six, and one host becomes five processes

| WordPress | Here | What actually differs |
|---|---|---|
| `wp-config.php` | ✅ three `.env` files (`apps/cms`, `apps/commerce`, `apps/storefront`) plus three framework configs | One file became six, and **no process reads another's env**. The same Postgres container serves both databases under two different `DATABASE_URL` values. Five processes have to be alive for the site to work: three Node servers, Postgres and Redis. [02 · Infrastructure](../learn/02-infrastructure.md) |
| `WP_DEBUG` | 🚫 **no single switch** | Each framework has its own idea of development mode, and the signal is the terminal. `npm run dev` runs all three with their logs teed to `logs/`. |
| `debug.log` | ✅ `logs/cms.log`, `logs/commerce.log`, `apps/storefront/.astro/dev.log` | Three logs, and ⚠️ **two different formats** — Astro writes JSON lines, the other two write prose. [12 §12.6](../learn/12-operating-it.md) explains why the asymmetry was kept rather than papered over. |
| WP-CLI | ✅ npm scripts + `payload` + `medusa exec` | WP-CLI is one tool that understands the whole site. Here you have `npm run seed:cms` (which ends up at `payload run src/scripts/seed.ts`), `npm run seed:commerce` (`medusa exec`), `npm run test:compensation`, and — note the prefix, because migrations are a Medusa script and not a root one — `npm --prefix apps/commerce run db:migrate`. Different CLIs per service, coordinated by the root `package.json`. WP-CLI is better at this, straightforwardly. |
| `wp db export` / UpdraftPlus | ✅ `npm run db:export` / `npm run db:import` | More careful than UpdraftPlus in one specific way: the manifest records migration ledgers and per-table row counts, and the import **refuses** on checksum failure or migration drift. Much less convenient in another: there is no schedule, no cloud destination, and no button. [12 §12.5](../learn/12-operating-it.md) |
| Wordfence | ✅ rate limiting only — [`middleware.ts`](../../apps/storefront/src/middleware.ts) and [`api/middlewares.ts`](../../apps/commerce/src/api/middlewares.ts) | ⚠️ **Do not read this row as a replacement.** Wordfence does firewalling, malware scanning, file-integrity checks, login hardening and country blocking. This stack has a sliding-window counter, per process, with no authentication behind it. On the security axis, a well-configured WordPress site is ahead. |
| WP Super Cache / W3 Total Cache | 🚫 **nothing** | There is no page cache, no object cache API, no CDN integration. Every page render makes live calls to Payload and Medusa — including `Layout.astro` reading the site-settings global on **every single page**. [09 §9.6](../learn/09-to-production.md) names this as the first thing to cache. |
| Hosting | 🚫 **no equivalent at any price** | §2.10. |

Everything you can run from the repo root:

```bash
python3 -c "import json;print(' '.join(sorted(json.load(open('package.json'))['scripts'])))" | fold -s -w 74
```

```
bootstrap:commerce db:down db:export db:import db:psql db:reset db:up dev 
dev:cms dev:commerce dev:storefront install:all logs logs:errors 
postman:env postman:test reset:all seed:cms seed:commerce setup test 
test:compensation test:unit typecheck
```

Twenty-four commands where WordPress has `wp`. The compensation: each is a few
lines of shell you can read.

---

## 2.9 Eight things with no WordPress equivalent — do not force one

These will not map, and an analogy makes each one harder. Each solves a problem
WordPress never had to solve, because WordPress chose differently decades ago.

### Module isolation

**WordPress:** no equivalent. Every plugin shares one connection, one table
prefix and one request, and can `JOIN` to another plugin's tables at will.

**The problem it solves:** making one part of the system independently
deployable, upgradeable and testable. Medusa's review module cannot import
`product` and has no foreign key to it — the model
([`models/review.ts`](../../apps/commerce/src/modules/review/models/review.ts))
has ten columns and none is a product id.

**What it costs you:** the N+1 on
[`products/index.astro`](../../apps/storefront/src/pages/products/index.astro),
labelled on the page itself, because "products with their ratings" is genuinely
not one query. In WordPress that is one `JOIN` you never think about again.
[04 · Medusa](../learn/04-medusa.md) is the chapter.

### Workflows and compensation

**WordPress:** no equivalent, and none needed — one database, one connection,
one transaction. This is a problem *created* by the architecture that solves
the previous one.

**The problem it solves:** a multi-step write where step 3 fails after steps 1
and 2 committed, in different modules, so no database transaction can cover
them. Each step declares how to undo itself and the orchestrator runs the undos
in reverse. [`create-review.ts`](../../apps/commerce/src/workflows/create-review.ts)
has four steps, two of which write;
[`link-review-to-product.ts:32`](../../apps/commerce/src/workflows/steps/link-review-to-product.ts)
carries a failure switch so you can watch the rollback.

```bash
npm run test:compensation 2>&1 | tail -8
```

```
info:    
info:    ── 2. the workflow fails at the link step ──
info:      PASS  the failure propagates to the caller
info:      PASS  no orphan review — 23 → 23
info:      PASS  no orphan link — 23 → 23
info:      PASS  the rolled-back row does not exist even as a soft delete — none
info:    
info:    ✓ compensation holds — a failed workflow left nothing behind
```

The `info:` prefix is Medusa's logger, not the test's. Your row counts will be
whatever `review` holds when you run it; what matters is that the two numbers on
each line are the same.

### Link tables and Query

**WordPress:** no equivalent. The closest thing — `wp_term_relationships` — is
a join table you query with SQL like any other.

**The problem it solves:** associating records across an isolation boundary you
have promised not to cross. [`defineLink`](../../apps/commerce/src/links/product-review.ts)
creates a third table whose only payload is two ids — the other four columns are
its own id and timestamps — and `query.graph` resolves it for you at read time.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d product_product_review_review' | head -9
```

```
                   Table "public.product_product_review_review"
   Column   |           Type           | Collation | Nullable |      Default      
------------+--------------------------+-----------+----------+-------------------
 product_id | character varying(255)   |           | not null | 
 review_id  | character varying(255)   |           | not null | 
 id         | character varying(255)   |           | not null | 
 created_at | timestamp with time zone |           | not null | CURRENT_TIMESTAMP
 updated_at | timestamp with time zone |           | not null | CURRENT_TIMESTAMP
 deleted_at | timestamp with time zone |           |          | 
```

⚠️ **There is no SQL join you are allowed to write across that table**, even
though `psql` shows you both ends of it. One works today and breaks the moment
either module changes its storage — which is the point of the boundary.

### Islands and partial hydration

**WordPress:** no equivalent, because the question does not arise. A WordPress
page's JavaScript is whatever the theme and plugins enqueued, and the baseline
is never zero.

**The problem it solves:** shipping interactivity for the 2% of the page that
needs it and nothing for the other 98%, decided per component in the markup —
`client:visible` on one line of
[`reviews/index.astro`](../../apps/storefront/src/pages/reviews/index.astro).
"How much JavaScript does this page ship" stops being an audit and becomes a
grep (§2.3).

### The BFF layer

**WordPress:** no equivalent, because the front end and the back end are the
same process. There is nothing to sit between.

**The problem it solves:** the browser needs data from two backends and must
hold neither backend's credentials. Astro fetches server-side, so
`PAYLOAD_API_KEY` and `MEDUSA_PUBLISHABLE_KEY` never reach the client.

```bash
curl -s 'http://localhost:4321/api/reviews?limit=2' \
  | python3 -c 'import json,sys; print("via Astro   :", list(json.load(sys.stdin).keys()))'
curl -s -o /dev/null -w 'direct Medusa: HTTP %{http_code} (no publishable key)\n' \
  'http://localhost:9000/store/reviews?limit=2'
```

```
via Astro   : ['reviews', 'count', 'limit', 'offset', 'source']
direct Medusa: HTTP 400 (no publishable key)
```

The browser got the data; it never got the key. [01 · Foundations](../learn/01-foundations.md)
defines the term.

### Three credential types at once

**WordPress:** no equivalent. One cookie, one user, one site.

**The problem it solves:** nothing — it is a *consequence*, not a solution.
Three services by three teams each chose an auth model and your frontend speaks
all three. A composable architecture composes its credential problems too (§2.6).

### Schema migrations as code

**WordPress:** `dbDelta()` in an activation hook, and `get_option('my_db_version')`.
It works, it is widely used, and it is not version controlled as a sequence.

**The problem it solves:** making the database's shape a reviewable, ordered,
replayable artefact. Medusa generates real migration files:

```bash
find apps/commerce/src -path '*migrations*' -name '*.ts'
```

```
apps/commerce/src/modules/ops/migrations/Migration20260918111206.ts
apps/commerce/src/modules/review/migrations/Migration20260819182718.ts
```

⚠️ **Payload in this repo has none** — it runs `push`, which diffs the config
against the live database and applies the difference. That is a development
convenience with two sharp edges ([03 §3.12](../learn/03-payload.md)), and the
two halves of this stack therefore disagree about how schema change works.

### Two databases

**WordPress:** no equivalent. One database, one prefix, and `$wpdb` reaches
everything.

**The problem it solves:** letting two services own their schemas outright, so
neither can be broken by the other's migration.

```bash
docker exec apm-postgres psql -U postgres -tAc \
  "select datname from pg_database where datname like '%crud';"
for db in payload_crud medusa_crud; do
  n=$(docker exec apm-postgres psql -U postgres -d $db -tAc \
    "select count(*) from information_schema.tables where table_schema='public';")
  printf '%-14s %s tables\n' "$db" "$n"
done
```

```
payload_crud
medusa_crud
payload_crud   21 tables
medusa_crud    146 tables
```

**What it costs:** no query spans content and commerce. "Posts mentioning our
best-reviewed product" is application code joining two HTTP responses, not SQL.
[10 · Databases](../learn/10-databases.md) walks both schemas.

---

## 2.10 Seven things WordPress has that this stack does not

As important as the previous list, and the part most migration write-ups leave
out. None of these is a small loss.

| What WordPress has | The honest position here |
|---|---|
| **A plugin ecosystem, and one-click install** | Sixty thousand plugins, installable by a non-developer in thirty seconds, most of them free. There is no equivalent. Payload has a plugin list (`plugins: []` — empty here) and Medusa has modules, but both mean npm, config, restart, and sometimes a migration. Features that a WordPress developer adds in an afternoon — forms, SEO, redirects, galleries, memberships, bookings — are **projects** here. |
| **Themes you can buy** | A client can pick a theme from a marketplace, and you can hand them a site in a week. This stack has no theme concept at all (§2.3), so every front end is bespoke. If the brief is "a good-looking brochure site by Friday", WordPress wins and it is not close. |
| **Shortcodes** | `[contact-form id="3"]` is a non-developer putting a dynamic component inside prose, with no build step and no deploy. Lexical rich text here is rendered by [`lexical.ts`](../../apps/storefront/src/lib/lexical.ts), which knows about paragraphs, lists and links — not about your components. Payload blocks solve part of this, but only at section level, never mid-paragraph. |
| **The Loop and template tags** | `while (have_posts())` with ambient context is less code than `.map()` with explicit props, and after twenty years every WordPress developer reads it instantly. The explicitness here is a real improvement for correctness and a real cost in keystrokes. Be honest about which one you are buying. |
| **WP-Cron, with zero infrastructure** | WordPress schedules jobs with no scheduler, no Redis and no second process — a page view fires what is due. It is a genuinely elegant hack for shared hosting. Medusa's scheduler is more correct and needs a long-running process, Redis locking to avoid duplicate runs, and a reason for the process to stay up. |
| **One admin for everything** | WordPress has one `/wp-admin`. This stack has **two admin panels** — `localhost:3000/admin` for content and `localhost:9000/app` for commerce — with two separate logins and no shared session (§2.6); the storefront on `localhost:4321` has no admin and no login at all. A client *will* ask why. There is no good answer except "they are separate systems". |
| **Hosting that costs five dollars a month** | Upload files by FTP; it runs. This stack needs Node processes for Payload, Medusa and Astro, a Postgres server, a Redis server, and something to keep all five alive. [09 · To production](../learn/09-to-production.md) lists what is still missing even then. The floor is not five dollars, and the operational knowledge required is not a cPanel login. |

Count them yourself — two admin panels, and a storefront that has neither:

```bash
for u in :3000/admin :9000/app :4321/; do printf '%-16s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost$u")"; done
```

```
:3000/admin      200
:9000/app        200
:4321/           200
```

⚠️ **Neither admin session knows about the other, and the third line is not an
admin at all.** Logging into Payload's admin does not log you into Medusa's, and
`:4321` has no login to log into — see [01 §1.4](01-the-shift.md).

---

## 2.11 False friends: eight words that changed meaning

The hardest terms are not the new ones. They are the familiar ones that now mean
something else, and each costs you an hour the first time.

| Word | In WordPress | Here |
|---|---|---|
| **Hook** | a named point in execution that any code can attach to, globally | two unrelated things wearing one word. A **Payload** hook is a function listed in a config object, attachable only from that file. A **Medusa** *workflow* hook is much closer to `do_action` — a named point a workflow exposes for an outside file to consume — and nothing here uses one. Astro does not use the word; its equivalents are middleware and steps |
| **Template** | a PHP file selected by a cascade | nothing; the word has no role. A `.astro` file is a route or a component |
| **Endpoint** | a REST route registered with `register_rest_route` | three different things: a Payload `Endpoint` object, a Medusa `route.ts` file, an Astro `src/pages/api/*.ts` file |
| **Query** | `WP_Query`, or SQL | Payload's `where` params; Medusa's `query.graph`, which resolves *across modules* and is not SQL at all |
| **Module** | nothing standard | **the** unit of isolation in Medusa: own tables, own service, own migrations, no imports across the boundary |
| **Block** | a Gutenberg block: editor UI plus a render callback | a Payload `blocks` entry: a named set of typed fields that becomes its own table. No UI, no renderer — the frontend supplies both |
| **Global** | a PHP global variable, usually `$post` | a Payload **global**: one typed record with its own table and its own REST path — a sibling of collections, not one of them |
| **Field** | an ACF field: a row in `wp_postmeta` | a column in a real table, declared in TypeScript, from which the schema, the API, the admin screen and the types are generated |

The quickest way to feel the split is to list the three `src/` directories side
by side. Each framework organises by its own nouns, and they barely overlap:

```bash
for d in apps/cms apps/commerce apps/storefront; do
  printf '%-16s %s\n' "$d" "$(ls $d/src | tr '\n' ' ')"
done
```

```
apps/cms         app collections endpoints globals hooks lib payload-types.ts payload.config.ts scripts 
apps/commerce    admin api jobs links modules scripts subscribers workflows 
apps/storefront  actions components layouts lib middleware.ts pages 
```

Three vocabularies, one repository. The [glossary](../learn/08-glossary.md)
defines about sixty of these terms from the stack's side; this chapter is the
half of the map that starts from what you already know.

---

## Check yourself

1. An ACF field and a Payload field look almost identical in the config. Name
   two things that are completely different about where the value goes.
2. Your client wants a non-developer to add a new field to a content type next
   Tuesday without a deploy. What do you tell them, and why?
3. WordPress returns a boolean from `current_user_can()`. What else can a
   Payload `read` access function return, and what does that change about how
   drafts behave for an anonymous reader?
4. Three credentials, three failure codes: 400, 401, 403. Which service and
   which surface produces each, and what does each one mean?
5. `apply_filters` has no equivalent in this stack. What do you gain from its
   absence, and what would you have to give up to get it back?
6. The `price` table has 46 rows and no page in this repo shows a price. Is that
   a ✅, a 📋 or a 🚫 — and what would you have to build to change it?
7. Pick three things from §2.10 that would appear in a quote for a WooCommerce
   migration. How would you price each one honestly?
8. Why can you see the link table in `psql` and still not be allowed to write a
   SQL join across it?

---

**Next:** [03-payload-for-acf-and-cpt.md](03-payload-for-acf-and-cpt.md) — the
ACF bridge, built properly: collections, fields, blocks, globals, hooks, access.
