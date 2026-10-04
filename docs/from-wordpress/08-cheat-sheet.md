# 8 · Cheat sheet — WordPress to this stack

> Counterpart in the main course: [08 · Glossary](../learn/08-glossary.md) and
> [07 · Troubleshooting](../learn/07-troubleshooting.md).

Lookup, not teaching. Nothing here is new — every row points at the chapter in
this track that explains it. If you are reading a row for the first time, follow
the link; the row alone will mislead you.

| Mark | Means |
|---|---|
| ✅ | Running in this repo now |
| 📋 | The framework supports it; this repo does not configure it |
| 🚫 | Not here at all |

---

## 8.1 Term to term

Alphabetical by the WordPress word.

| WordPress | Here | Mark | Chapter |
|---|---|---|---|
| ACF field | one object in a collection's `fields` array | ✅ | [03 §3.3](03-payload-for-acf-and-cpt.md) |
| ACF field group | the `fields` array itself — no location rules | ✅ | [03 §3.2](03-payload-for-acf-and-cpt.md) |
| ACF Flexible Content | `type: 'blocks'` — `layout` on Pages | ✅ | [03 §3.4](03-payload-for-acf-and-cpt.md) |
| ACF Options Page | a **global**, `SiteSettings.ts` | ✅ | [03 §3.5](03-payload-for-acf-and-cpt.md) |
| ACF Relationship / Post Object | `type: 'relationship'` + `?depth=` | ✅ | [03 §3.6](03-payload-for-acf-and-cpt.md) |
| ACF Repeater | `type: 'array'` — becomes its own table | ✅ | [03 §3.3](03-payload-for-acf-and-cpt.md) |
| `add_action` | collection/field `hooks`; Medusa subscribers | ✅ | [02 §2.7](02-concept-map.md) |
| `add_filter` / `apply_filters` | **no equivalent** — the biggest single loss | 🚫 | [02 §2.7](02-concept-map.md) |
| `admin-ajax.php?action=` | Astro Action, `POST ?_action=post.create` | ✅ | [04 §4.8](04-astro-for-theme-developers.md) |
| `admin-post.php` | the same Actions with `accept: 'form'`, JS-off | ✅ | [04 §4.8](04-astro-for-theme-developers.md) |
| Application password | Payload API key (`auth: { useAPIKey: true }`) | ✅ | [02 §2.6](02-concept-map.md) |
| `archive.php` | `posts/index.astro` — no query is implied | ✅ | [04 §4.2](04-astro-for-theme-developers.md) |
| Attachment | a row in the `media` collection | ✅ | [03 §3.7](03-payload-for-acf-and-cpt.md) |
| Capability | **no equivalent** — four operations, that is all | 🚫 | [02 §2.6](02-concept-map.md) |
| Cart | no code, no UI, 0 rows | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| Checkout | zero occurrences in the repo | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| Child theme | **no equivalent** — nothing overrides by filename | 🚫 | [02 §2.3](02-concept-map.md) |
| Comment | **no equivalent** — Medusa reviews are the nearest | 🚫 | [05 §5.7](05-medusa-for-woocommerce.md) |
| Coupon / promotion | zero occurrences | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| `current_user_can()` | an `access` function per operation | ✅ | [03 §3.9](03-payload-for-acf-and-cpt.md) |
| Customer | no code, 0 rows; reviews carry free-text names | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| `dbDelta` / schema upgrade | `medusa db:generate` + `db:migrate`; Payload dev `push` | ✅ | [05 §5.7](05-medusa-for-woocommerce.md) |
| Draft / Publish / Pending / Private | `_status`, two values only | ✅ | [03 §3.10](03-payload-for-acf-and-cpt.md) |
| Elementor section / widget | the same `blocks` field, much smaller menu | ✅ | [03 §3.4](03-payload-for-acf-and-cpt.md) |
| `functions.php` | split four ways, and some of it has nowhere to live | — | [01 §1.3](01-the-shift.md) |
| `get_header()` / `get_footer()` | `<Layout>…</Layout>` — one complete document | ✅ | [04 §4.3](04-astro-for-theme-developers.md) |
| `get_post_meta()` / `wp_postmeta` | **no key-value side table at all** | 🚫 | [02 §2.2](02-concept-map.md) |
| `get_posts()` | `listPosts()` — an HTTP call to another service | ✅ | [04 §4.6](04-astro-for-theme-developers.md) |
| `get_template_part()` | an ES import of a `.astro` component, typed props | ✅ | [04 §4.4](04-astro-for-theme-developers.md) |
| Gravity Forms | Astro Actions + `astro/zod` — mechanism only | ✅/🚫 | [07 §7.4](07-cross-cutting.md) |
| Gutenberg block | a Payload `blocks` entry + an Astro component | ✅ | [02 §2.11](02-concept-map.md) |
| `header.php` / `footer.php` | one file, `Layout.astro` | ✅ | [04 §4.3](04-astro-for-theme-developers.md) |
| Hook priority | array order inside one file; no integers | 🚫 | [02 §2.7](02-concept-map.md) |
| Hosting at $5/month | five processes to keep alive | 🚫 | [02 §2.10](02-concept-map.md) |
| `index.php` | `src/pages/index.astro` | ✅ | [04 §4.2](04-astro-for-theme-developers.md) |
| Inventory (`_stock`) | 20 items / 20 levels seeded, no code reads them | 📋 | [05 §5.5](05-medusa-for-woocommerce.md) |
| Loop (`have_posts()`) | **no equivalent** — fetch an array, `.map()` over it | 🚫 | [02 §2.3](02-concept-map.md) |
| `map_meta_cap` / per-post caps | access functions receive the document | 📋 | [02 §2.6](02-concept-map.md) |
| Media Library | the `media` collection — configured, and empty | ✅/📋 | [03 §3.7](03-payload-for-acf-and-cpt.md) |
| `meta_query` | `?where[title][contains]=…` against a real column | ✅ | [02 §2.4](02-concept-map.md) |
| `mu-plugins/` | `src/middleware.ts` — not privileged, just unavoidable | ✅ | [04 §4.9](04-astro-for-theme-developers.md) |
| Nonce | Astro `security.checkOrigin` — **not the same mechanism** | ✅ | [02 §2.6](02-concept-map.md) |
| Order | no code, 0 rows. Every `order` hit is a sort param | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| Page (built-in type) | the `pages` collection — deliberately no drafts | ✅ | [03 §3.10](03-payload-for-acf-and-cpt.md) |
| `page.php` | `pages/[slug].astro`, rendering blocks | ✅ | [04 §4.2](04-astro-for-theme-developers.md) |
| Payment gateway | a provider id on the seeded region, nothing more | 🚫 | [05 §5.6](05-medusa-for-woocommerce.md) |
| Permalink settings | the file tree in `src/pages/`; no rewrite layer | 🚫 | [02 §2.2](02-concept-map.md) |
| Plugin | four unrelated extension points | — | [01 §1.6](01-the-shift.md) |
| `pre_get_posts` | **no equivalent** — nothing can rewrite a query from outside | 🚫 | [02 §2.4](02-concept-map.md) |
| Price (`_price` postmeta) | Medusa price rows — 86 of them, needs a `region_id` | ✅ | [05 §5.4](05-medusa-for-woocommerce.md) |
| Product | Medusa product — seeded, read by the storefront | ✅ | [05 §5.3](05-medusa-for-woocommerce.md) |
| Product variation | Medusa variant — 40 rows, rendered as plan tiers | ✅ | [05 §5.3](05-medusa-for-woocommerce.md) |
| `register_post_type()` | a file in `src/collections/` + one array entry | ✅ | [03 §3.2](03-payload-for-acf-and-cpt.md) |
| `register_rest_route()` | three mechanisms, one per service | ✅ | [02 §2.4](02-concept-map.md) |
| `register_sidebar()` / widget area | **no equivalent** — positions are fixed in code | 🚫 | [02 §2.3](02-concept-map.md) |
| `register_taxonomy()` | another collection + a `relationship` field | ✅ | [02 §2.2](02-concept-map.md) |
| `remove_action()` | delete the line | 🚫 | [02 §2.7](02-concept-map.md) |
| Revisions | `versions: { drafts: true, maxPerDoc: 10 }` → `_posts_v` | ✅ | [03 §3.10](03-payload-for-acf-and-cpt.md) |
| Role | a `role` select field, `admin \| editor` | ✅ | [02 §2.6](02-concept-map.md) |
| Scheduled publishing (`future`) | **not here** — nothing flips a status on a date | 🚫 | [02 §2.2](02-concept-map.md) |
| Shipping zone | 2 shipping options seeded, no code reads them | 📋 | [05 §5.5](05-medusa-for-woocommerce.md) |
| Shortcode | **no equivalent** — blocks work at section level only | 🚫 | [02 §2.10](02-concept-map.md) |
| `single.php` | `posts/[slug].astro`; there is no `$post` in scope | ✅ | [04 §4.2](04-astro-for-theme-developers.md) |
| Site title / tagline | the `site-settings` global | ✅ | [03 §3.5](03-payload-for-acf-and-cpt.md) |
| `srcset` / `wp_get_attachment_image()` | sizes are generated; nothing builds a `srcset` | 🚫 | [02 §2.2](02-concept-map.md) |
| `style.css` theme header | `astro.config.mjs`; CSS lives in `<style>` blocks | ✅ | [04 §4.1](04-astro-for-theme-developers.md) |
| Tag | a `tags` array field — private to the post, no term id | ✅ | [02 §2.2](02-concept-map.md) |
| Taxonomy term | a row in `categories` | ✅ | [02 §2.2](02-concept-map.md) |
| Template hierarchy | file-based routing, **no cascade and no fallback** | ✅ | [04 §4.2](04-astro-for-theme-developers.md) |
| Template tag (`the_title()`) | `{post.title}` — nothing is ambient | 🚫 | [02 §2.3](02-concept-map.md) |
| Theme | **no equivalent** — `apps/storefront` is an application | 🚫 | [02 §2.3](02-concept-map.md) |
| Transient / object cache | Redis is configured for Medusa; no code reads it | 📋 | [07 §7.7](07-cross-cutting.md) |
| UpdraftPlus | `npm run db:export` / `db:import` + a drift check | ✅ | [07 §7.1](07-cross-cutting.md) |
| Uploads directory | `apps/cms/public/media` — exists, zero files | ✅/📋 | [03 §3.7](03-payload-for-acf-and-cpt.md) |
| User (`wp_users` row) | **three user tables in two databases**, unrelated | — | [02 §2.6](02-concept-map.md) |
| WooCommerce | Medusa — every noun exists, this repo uses four | — | [05 §5.1](05-medusa-for-woocommerce.md) |
| Wordfence | rate limiting only, in two middlewares | ✅ | [07 §7.2](07-cross-cutting.md) |
| WP-CLI | npm scripts + `payload` + `medusa exec` — §8.3 | ✅ | [02 §2.8](02-concept-map.md) |
| WP-Cron / `wp_schedule_event()` | a file in `apps/commerce/src/jobs/` with a cron string | ✅ | [07 §7.3](07-cross-cutting.md) |
| WP Super Cache / W3TC | **nothing caches anything** | 📋 | [07 §7.7](07-cross-cutting.md) |
| `WP_Query` | Payload query params; the Local API `payload.find()` | ✅ | [02 §2.4](02-concept-map.md) |
| `wp-admin` | **two** admin panels, two logins, no shared session | — | [01 §1.4](01-the-shift.md) |
| `wp-config.php` | three `.env` files + three framework configs | — | [02 §2.8](02-concept-map.md) |
| `wp-content/plugins/` | `node_modules` + three config arrays | — | [01 §1.6](01-the-shift.md) |
| `wp-json` | four API roots across three services | — | [02 §2.4](02-concept-map.md) |
| `wp_ajax_nopriv_*` | **no equivalent** — everything is effectively `nopriv` | 🚫 | [02 §2.4](02-concept-map.md) |
| `$wpdb` | `payload.db.drizzle.execute(sql\`…\`)`; `docker exec … psql` | ✅ | [02 §2.4](02-concept-map.md) |
| `wp_enqueue_script()` | a `client:*` directive — used **once** in the whole app | ✅ | [04 §4.7](04-astro-for-theme-developers.md) |
| `wp_head()` / `wp_footer()` | **no equivalent** — nothing injects into your `<head>` | 🚫 | [02 §2.3](02-concept-map.md) |
| `wp_nonce_field()` | the origin check; no per-user, per-action token | ✅ | [02 §2.6](02-concept-map.md) |
| `wp_options` | the global (editable) + `.env` (configuration) | ✅ | [02 §2.2](02-concept-map.md) |
| WPML / Polylang | Payload `localization` — installed, not configured | 📋 | [07 §7.5](07-cross-cutting.md) |
| Yoast SEO | a `<title>` and a `<meta description>` in `Layout.astro` | ✅/🚫 | [07 §7.6](07-cross-cutting.md) |

⚠️ **A 🚫 row is never an invitation to go looking harder.** Cart, checkout,
order and customer exist in Medusa and are genuinely absent from *this* repo.

---

## 8.2 "I want to …"

| I want to… | In WordPress | Here |
|---|---|---|
| Add a field | ACF admin UI, live immediately | edit the `fields` array in [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts), restart the CMS; dev `push` syncs the column ✅ |
| Add a content type | `register_post_type()` | new file in [`apps/cms/src/collections/`](../../apps/cms/src/collections/), add it to `collections` in [`payload.config.ts`](../../apps/cms/src/payload.config.ts) ✅ |
| Add a page (content) | Pages → Add New | Payload admin → Pages, compose the `layout` blocks ✅ |
| Add a page (route) | a template plus a rewrite | drop a file in [`apps/storefront/src/pages/`](../../apps/storefront/src/pages/) — nothing to register ✅ |
| Add a template | `single-{type}.php`, picked by the cascade | **no equivalent.** One file per route, no fallback. A variant is a prop or a new component 🚫 |
| Query content | `WP_Query` / `get_posts()` | `curl -g ':3000/api/posts?where[…]'`, or `listPosts()` in [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts) ✅ |
| Add a form | Gravity Forms | an Action in [`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts) with `astro/zod`. The mechanism is ✅; a form **builder** is 🚫 |
| Restrict access | `current_user_can()` in the template | an `access.read` function on the collection — return a `Where`, not a boolean ✅ |
| Schedule a job | `wp_schedule_event()` | a file in [`apps/commerce/src/jobs/`](../../apps/commerce/src/jobs/) exporting `config.schedule` ✅ |
| Upload an image | Media Library | Payload admin → Media ✅ configured. **Nothing in the storefront renders one** 📋 |
| Add a product | Products → Add New | Medusa admin at `:9000/app` ✅. No code in this repo creates or prices products 📋 |
| Take a backup | UpdraftPlus | `npm run db:export` ✅ — no schedule, no cloud target, no restore button |
| See the logs | `debug.log` | `npm run logs`, `npm run logs:errors`, or `/monitor` ✅ |
| Change site-wide settings | Settings → General | Payload admin → Site settings for content; `.env` for configuration ✅ |
| Add a block | register a Gutenberg block | **three edits**: a block in `layout` in [`Pages.ts`](../../apps/cms/src/collections/Pages.ts), the `PageBlock` union in [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts), and a branch in the `switch (block.blockType)` in [`pages/[slug].astro`](../../apps/storefront/src/pages/pages/) ✅ |
| Know who is logged in on the front end | `wp_get_current_user()` | **nothing.** The storefront has no authentication 🚫 |

---

## 8.3 Command to command

| WP-CLI | Here |
|---|---|
| `wp core install` | `npm install && npm run setup` |
| (start the site) | `npm run db:up` then `npm run dev` |
| `wp db export` | `npm run db:export` |
| `wp db import` | `npm run db:import` |
| `wp db cli` | `npm run db:psql` |
| `wp db query "…"` | `docker exec apm-postgres psql -U postgres -d payload_crud -c "…"` |
| `wp db reset` | `npm run db:reset` — **destroys the volumes**, both keys change |
| `wp db reset && wp import` | `npm run reset:all` |
| `wp post list` | `curl -s 'http://localhost:3000/api/posts?depth=0'` |
| `wp option get blogname` | `curl -s http://localhost:3000/api/globals/site-settings` |
| `wp user create` | `npm --prefix apps/commerce run user -- -e … -p …` (Medusa). Payload users: the admin UI, or the seed |
| `wp eval-file f.php` | `payload run <file>` in `apps/cms` · `medusa exec <file>` in `apps/commerce` — exactly what the `seed` scripts in each `package.json` do |
| `wp plugin install` | `npm install`, edit a config, restart — sometimes a migration |
| `wp cron event list` | **no equivalent.** Jobs are files in `apps/commerce/src/jobs/` |
| `wp search-replace` | **no equivalent** |
| `wp theme activate` | **no equivalent** — there are no themes |
| `wp db migrate` (plugin-specific) | `npm --prefix apps/commerce run db:generate` then `… run db:migrate`. Payload uses dev `push`, **no migration files on disk** |
| — | `npm run typecheck`, `npm run test`, `npm run test:compensation`, `npm run postman:test` |
| — | `npm run seed:cms`, `npm run seed:commerce`, `npm run bootstrap:commerce` |
| — | `npm --prefix apps/cms run generate:types` |

⚠️ **Note the `--prefix`.** Migrations, the Medusa user command and type
generation are per-app scripts, not root ones.

Every script that exists, in all four `package.json` files:

```bash
python3 - <<'PY'
import json
for label, path in [('root','package.json'),('apps/cms','apps/cms/package.json'),
                    ('apps/commerce','apps/commerce/package.json'),
                    ('apps/storefront','apps/storefront/package.json')]:
    s = sorted(json.load(open(path))['scripts'])
    print(f'{label}:')
    line = '  '
    for n in s:
        if len(line) + len(n) > 72:
            print(line); line = '  '
        line += n + ' '
    print(line)
PY
```

```
root:
  bootstrap:commerce db:down db:export db:import db:psql db:reset db:up 
  dev dev:cms dev:commerce dev:storefront install:all logs logs:errors 
  postman:env postman:test reset:all seed:cms seed:commerce setup test 
  test:compensation test:unit typecheck 
apps/cms:
  build dev devsafe generate:importmap generate:types lint payload seed 
  start typecheck 
apps/commerce:
  bootstrap build db:generate db:migrate dev seed seed:reviews start 
  test:compensation typecheck user 
apps/storefront:
  astro build dev preview test test:watch typecheck
```

WP-CLI is one tool that understands the whole site. These are four tools that
each understand a quarter of it. WP-CLI is better at this, straightforwardly.

---

## 8.4 File to file

| WordPress | Here |
|---|---|
| `wp-config.php` | [`apps/cms/.env`](../../apps/cms/), [`apps/commerce/.env`](../../apps/commerce/), [`apps/storefront/.env`](../../apps/storefront/) — **no process reads another's** |
| (framework config) | [`payload.config.ts`](../../apps/cms/src/payload.config.ts) · [`medusa-config.ts`](../../apps/commerce/medusa-config.ts) · [`astro.config.mjs`](../../apps/storefront/astro.config.mjs) |
| `functions.php` | deliberately nowhere. Field/collection hooks → `apps/cms/src/collections/`; async reactions → `apps/commerce/src/subscribers/`; per-request → [`src/middleware.ts`](../../apps/storefront/src/middleware.ts); helpers → [`src/lib/`](../../apps/storefront/src/lib/) |
| `single.php` | [`apps/storefront/src/pages/posts/[slug].astro`](../../apps/storefront/src/pages/posts/) |
| `archive.php` | `apps/storefront/src/pages/posts/index.astro` |
| `page.php` | `apps/storefront/src/pages/pages/[slug].astro` |
| `header.php` + `footer.php` | [`src/layouts/Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) |
| `template-parts/*.php` | [`src/components/`](../../apps/storefront/src/components/) — 7 `.astro`, 1 `.tsx` |
| `style.css` | no global stylesheet. `<style is:global>` in `Layout.astro`, scoped `<style>` blocks elsewhere |
| `wp-content/plugins/` | `node_modules` + `plugins: []` (Payload, empty) + `modules` (Medusa, 6) + `integrations` (Astro, 1) |
| `wp-content/uploads/` | `apps/cms/public/media` — Astro stores nothing |
| `wp-content/themes/` | **no equivalent.** `apps/storefront` is an application |
| `debug.log` | `logs/cms.log`, `logs/commerce.log`, `apps/storefront/.astro/dev.log` — ⚠️ **two different formats** |
| `wp-cli.yml` | the root [`package.json`](../../package.json) `scripts` block |
| a migration in a plugin | `apps/commerce/src/modules/*/migrations/`. Payload has none |

---

## 8.5 URL to URL

| WordPress | Here |
|---|---|
| `/wp-admin` | `:3000/admin` (content) · `:9000/app` (commerce) · no third — the storefront has no admin |
| `/wp-login.php` | `:3000/admin/login` · `:9000/app/login`. **Two logins, no shared session** |
| `/wp-json/` | `:3000/api/*` · `:9000/store/*` · `:9000/admin/*` · `:4321/api/*` |
| `/wp-json/wp/v2/posts` | `:3000/api/posts` |
| (no equivalent) | `:3000/api/graphql` — Payload generates a GraphQL schema too |
| `/wp-json/wp/v2/settings` | `:3000/api/globals/site-settings` |
| a custom REST route | `:3000/api/posts/stats` · `:3000/api/schema` · `:9000/store/reviews` · `:9000/admin/uptime` |
| the site itself | `:4321/` · `/posts` · `/pages/:slug` · `/products` · `/reviews` |
| (no equivalent) | `:4321/schema` — live schema tour · `:4321/monitor` — ops panel · `:4321/api/health` |

```bash
for u in :3000/admin :3000/api/posts :3000/api/globals/site-settings \
         :3000/api/posts/stats :9000/app :9000/store/reviews \
         :9000/admin/reviews :4321/ :4321/schema :4321/monitor \
         :4321/api/health; do
  printf '%-34s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost$u")"
done
```

```
:3000/admin                        200
:3000/api/posts                    200
:3000/api/globals/site-settings    200
:3000/api/posts/stats              200
:9000/app                          200
:9000/store/reviews                400
:9000/admin/reviews                401
:4321/                             200
:4321/schema                       200
:4321/monitor                      200
:4321/api/health                   200
```

The two non-200s are the point: **400** is Medusa's store surface refusing a
request with no publishable key, **401** is its admin surface wanting a JWT.

---

## 8.6 Credential to credential

| WordPress | Here | Sent as |
|---|---|---|
| Login cookie | Payload session cookie (admin UI only) | cookie, `:3000/admin` |
| Application password | **Payload API key** | `Authorization: users API-Key <key>` — slug, then a literal `" API-Key "`. Not `Bearer` |
| — | **Medusa publishable key** — not a secret, not an identity; it names a sales channel | `x-publishable-api-key: pk_…` on every `/store/*` |
| — | **Medusa admin JWT** from `POST /auth/user/emailpass` | `Authorization: Bearer <jwt>` on every `/admin/*` |
| Nonce (`wp_nonce_field`) | Astro's origin check — a header comparison, upstream of middleware | `Origin:` on unsafe methods |
| `current_user_can()` on the front end | **nothing** | — |

```bash
set -a; . apps/storefront/.env; set +a
TOKEN=$(curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$MEDUSA_ADMIN_EMAIL\",\"password\":\"$MEDUSA_ADMIN_PASSWORD\"}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
code () { curl -s -o /dev/null -w '%{http_code}' "$@"; }
printf '%-42s %s\n' 'GET :3000/api/users   none'          "$(code 'http://localhost:3000/api/users?limit=1')"
printf '%-42s %s\n' 'GET :3000/api/users   API-Key'       "$(code 'http://localhost:3000/api/users?limit=1' -H "Authorization: users API-Key $PAYLOAD_API_KEY")"
printf '%-42s %s\n' 'GET :9000/store/reviews none'        "$(code 'http://localhost:9000/store/reviews?limit=1')"
printf '%-42s %s\n' 'GET :9000/store/reviews publishable' "$(code 'http://localhost:9000/store/reviews?limit=1' -H "x-publishable-api-key: $MEDUSA_PUBLISHABLE_KEY")"
printf '%-42s %s\n' 'GET :9000/admin/reviews none'        "$(code 'http://localhost:9000/admin/reviews?limit=1')"
printf '%-42s %s\n' 'GET :9000/admin/reviews Bearer JWT'  "$(code 'http://localhost:9000/admin/reviews?limit=1' -H "Authorization: Bearer $TOKEN")"
printf '%-42s %s\n' 'DELETE :4321/api/reviews/x no Origin' "$(code -X DELETE 'http://localhost:4321/api/reviews/x')"
```

```
GET :3000/api/users   none                 403
GET :3000/api/users   API-Key              200
GET :9000/store/reviews none               400
GET :9000/store/reviews publishable        200
GET :9000/admin/reviews none               401
GET :9000/admin/reviews Bearer JWT         200
DELETE :4321/api/reviews/x no Origin       403
```

⚠️ **That last 403 asked *where did you come from*, not *who are you*.** Add an
`Origin` header and the delete goes through — nobody is authenticated anywhere on
`:4321`. See [07 §7.8](07-cross-cutting.md).

---

## 8.7 If you see this error

Fuller symptom list: [07 · Troubleshooting](../learn/07-troubleshooting.md).

| You see | It means | Do |
|---|---|---|
| `400 Publishable API key required` | every `/store/*` route needs the header, custom routes included | `npm --prefix apps/commerce run bootstrap` prints the key |
| Medusa returns `200` with empty results | the key exists but is **not linked to a sales channel** | same command — it links it |
| `401` from `:9000/admin/*` | the publishable key is not enough | `POST /auth/user/emailpass`, send `Authorization: Bearer` |
| `403` from Payload with a valid key | header format | `Authorization: users API-Key <key>` — not `Bearer`, not bare `API-Key` |
| `403 Cross-site POST/DELETE form submissions are forbidden` | Astro's origin check, upstream of middleware | submit from the page, or send `Origin:` |
| Everything `401`/`400` after `npm run db:reset` | both keys were regenerated | `npm run setup` rewrites `apps/storefront/.env`; your scratch files are dead |
| `429 Too Many Requests` | Astro `/api/*` + Actions 120/60s; Medusa `/store/*` 240/60s | wait, or raise `RATE_LIMIT_MAX` in the right `.env` |
| `missing secret key…to secure Payload` | `PAYLOAD_SECRET` is unset | set it in `apps/cms/.env` |
| `EADDRINUSE` | 3000, 9000 or 4321 is already taken | kill the old process |
| `502` from Astro | Astro reached a backend and **the backend** failed | read the backend's log, not Astro's |
| `column does not exist` after editing a Medusa model | the migration was never generated | `npm --prefix apps/commerce run db:generate` then `db:migrate` |
| Payload: a new collection returns `404` | it is not in the `collections` array, or no restart | add it, restart the CMS |
| `expected string, received null` in an Action | an empty form field | the `optionalText` helper in `src/actions/index.ts` |
| Two incompatible `ZodType` errors | wrong zod import | Medusa: `@medusajs/framework/zod`. Astro: `astro/zod` |
| `curl: (3) bad range in URL position` | `[` or `]` in the URL | add `-g` |
| `_jsxDEV is not a function` | an island in dev | restart the Astro dev server |

**Escalation ladder, in order:** restart one service → delete `.next`/`.astro`/
`.medusa` → reinstall that app's `node_modules` → `npm run db:reset && npm run
setup`.

---

## 8.8 The one screen

```
PORTS      3000 Payload   9000 Medusa   4321 Astro   5433 Postgres   6379 Redis
ADMIN      :3000/admin    :9000/app     :4321 has none
OWNS       Payload: posts pages categories media users settings  (payload_crud, 21 tables)
           Medusa:  products variants prices regions reviews uptime (medusa_crud, 146)
           Astro:   nothing. No database, no ORM, no migrations.
CREDENTIAL Payload  Authorization: users API-Key <key>
           Medusa   x-publishable-api-key: pk_…      (/store/*)
           Medusa   Authorization: Bearer <jwt>       (/admin/*)
           Astro    none. Anyone can delete anything.
DAILY      npm run db:up && npm run dev     npm run logs     npm run typecheck
RESCUE     npm run db:reset && npm run setup
LABELS     ✅ running here   📋 supported, not configured   🚫 not here at all
GONE       add_filter · the Loop · shortcodes · taxonomies · transients ·
           capabilities · themes · the plugin ecosystem · one admin · $5 hosting
NEW        module isolation · workflows + compensation · link tables · islands ·
           the BFF layer · three credentials · migrations as code · two databases
RULE       Delete two services in your head. The one that still needs the data
           owns it. If the answer is Astro, the answer is wrong.
```

---

**Next:** [README.md](README.md) — the track index, and where to go after this.
