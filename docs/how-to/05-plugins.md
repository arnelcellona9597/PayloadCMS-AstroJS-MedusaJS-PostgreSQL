# 5 · Plugins and modules — SEO, caching, forms and languages

> Why each WordPress plugin does or does not port is argued in
> [07 · Cross-cutting concerns](../from-wordpress/07-cross-cutting.md); what
> caching actually costs is in [09 · To production](../learn/09-to-production.md).
> This file is the steps.

**Are there plugins for this, and are they free?** No, not in the way you mean.

WordPress has roughly **60,000 free plugins** in the official directory, and you
install one by typing into a search box inside wp-admin, clicking Install Now,
clicking Activate, and getting on with your afternoon. No terminal, no build, no
restart, no file in git. Your client can do it themselves.

These three projects have, between them, perhaps **a few dozen official
packages**. You install one with `npm install` in the right app directory, add a
line to a config file, restart the server and commit the diff. No marketplace, no
one-click install, and far less "somebody already solved this in 2019". **That is
a real loss** — the WordPress plugin economy lets you buy a solved problem in an
afternoon, and here the honest answer to a client is sometimes "that is three
days, not three clicks".

What you get back is narrower and still worth something: everything you install
is a typed, versioned, lockfile-pinned package you can read. Nothing injects
itself into your `<head>`, filters your queries or adds an admin notice without a
line appearing in a file you own.

The entire extension surface of this repo, right now:

```bash
grep -n 'plugins:' apps/cms/src/payload.config.ts
grep -n 'integrations:' apps/storefront/astro.config.mjs
python3 -c "import json; print(len(json.load(open('apps/cms/package.json'))['dependencies']), 'direct deps in apps/cms')"
```

```
103:  plugins: [],
38:  integrations: [react()],
12 direct deps in apps/cms
```

An empty array, one integration, twelve dependencies. Everything this stack does
is in a file you can open.

---

## 5.1 The five places a "plugin" can plug in

WordPress has one slot — `wp-content/plugins/` — and one activation switch. This
stack has five, in three projects, and putting a package in the wrong one is the
most common first mistake.

| Slot | Project | File | What goes there | Today |
|---|---|---|---|---|
| `plugins: []` | Payload | [`apps/cms/src/payload.config.ts:103`](../../apps/cms/src/payload.config.ts) | Payload plugins — fields, collections, admin UI | **empty** |
| `integrations: []` | Astro | [`apps/storefront/astro.config.mjs:38`](../../apps/storefront/astro.config.mjs) | Astro integrations — build hooks, renderers | `react()` only |
| `modules: []` | Medusa | [`apps/commerce/medusa-config.ts:66`](../../apps/commerce/medusa-config.ts) | Medusa modules — cache, event bus, locking, your own | 4 Redis + 2 custom |
| a module's `options.providers: []` | Medusa | same file, [`medusa-config.ts:149`](../../apps/commerce/medusa-config.ts) | **providers** — payment, file, notification, locking | `locking-redis` |
| nothing — just `import` | all three | any `.ts` file | ordinary npm libraries | — |

⚠️ **The `providers` array inside a module is not the same slot as `modules`.**
This repo already contains the lesson, as a comment in
[`medusa-config.ts`](../../apps/commerce/medusa-config.ts): resolving
`@medusajs/locking-redis` directly in `modules` fails with *"No service found in
module Locking"*, because that package exports a provider, not a module service.
It belongs inside `@medusajs/locking`'s `providers` array — and **payment
providers use exactly this shape**, worked through in
[06 §6.2](06-commerce.md#62-you-do-not-build-a-payment-gateway--you-register-a-provider).

---

## 5.2 The packages that actually exist, grouped by the job they do

Every name and version below was checked against the npm registry on
**2026-10-04**. If you want a package that is not on this list, check it yourself
before you trust it:

```bash
for p in @payloadcms/plugin-seo @astrojs/sitemap @medusajs/payment-stripe; do
  printf '%-32s %s\n' "$p" "$(npm view "$p" version)"
done
```

```
@payloadcms/plugin-seo           3.90.2
@astrojs/sitemap                 3.7.4
@medusajs/payment-stripe         2.21.2
```

| Job | Package | Version on npm | Project | Your analogue | Installed here |
|---|---|---|---|---|---|
| SEO fields | `@payloadcms/plugin-seo` | 3.90.2 | Payload | Yoast's **fields**, not its analysis | 🚫 |
| SEO head tags | `astro-seo` | 1.2.0 | Astro | a community `<SEO>` component | 🚫 |
| Sitemap | `@astrojs/sitemap` | 3.7.4 | Astro | Yoast's XML sitemap — **read §5.5** | 🚫 |
| robots.txt | `astro-robots-txt` | 1.0.0 | Astro | community; `robots.txt` | 🚫 |
| RSS | `@astrojs/rss` | 4.0.19 | Astro | `/feed/`, free in WordPress | 🚫 |
| Redirects | `@payloadcms/plugin-redirects` | 3.90.2 | Payload | Redirection, Yoast Premium | 🚫 |
| Search | `@payloadcms/plugin-search` | 3.90.2 | Payload | Relevanssi / SearchWP | 🚫 |
| Forms | `@payloadcms/plugin-form-builder` | 3.90.2 | Payload | **Gravity Forms** — §5.8 | 🚫 |
| Page hierarchy | `@payloadcms/plugin-nested-docs` | 3.90.2 | Payload | parent pages + breadcrumbs | 🚫 |
| Multi-tenant | `@payloadcms/plugin-multi-tenant` | 3.90.2 | Payload | nearest thing to Multisite | 🚫 |
| Media storage | `@payloadcms/storage-s3` | 3.90.2 | Payload | WP Offload Media | 🚫 |
| Media storage | `@medusajs/file-s3` | 2.21.2 | Medusa | same, for product files | 🚫 |
| Preview | `@payloadcms/live-preview-react` | 3.90.2 | Payload | the Preview button, working | 🚫 |
| Third-party JS | `@astrojs/partytown` | 2.1.8 | Astro | "defer scripts" plugins | 🚫 |
| Payments | `@medusajs/payment-stripe` | 2.21.2 | Medusa | WooCommerce Stripe — **§5.3**, then [06 §6.3](06-commerce.md#63--how-to-add-stripe-to-this-stack) | 🚫 |
| Notifications | `@medusajs/notification-sendgrid` | 2.21.2 | Medusa | WP Mail SMTP | 🚫 |
| Query index | `@medusajs/index` | 2.21.2 | Medusa | — | 🚫 |
| Object cache | `@medusajs/cache-redis` | **2.19.0 installed** | Medusa | Redis Object Cache | ✅ |
| Event bus | `@medusajs/event-bus-redis` | **2.19.0 installed** | Medusa | no analogue | ✅ |
| Workflow engine | `@medusajs/workflow-engine-redis` | **2.19.0 installed** | Medusa | no analogue | ✅ |
| Locking | `@medusajs/locking` + `-redis` | **2.19.0 installed** | Medusa | WP-Cron lock hacks | ✅ |
| React island | `@astrojs/react` | **installed** | Astro | — | ✅ |

Two things to read out of that. **`astro-seo` and `astro-robots-txt` are
community packages**, not official `@astrojs/` ones — a distinction that matters
more than in the WordPress directory, because neither a review queue nor a
"tested up to" field sits behind them. Check the publish date before you depend
on one:

```bash
npm view astro-robots-txt time.modified
npm view astro-seo time.modified
```

```
2023-09-08T13:23:14.740Z
2026-08-28T10:48:14.412Z
```

`astro-robots-txt` has not been republished since 2023, three Astro majors ago.
It may still work; nobody has said so.
And **everything already installed is infrastructure**: this ecosystem is strong
on plumbing you would have paid for in WooCommerce, thin on the
content-marketing plugins you reach for.

The ones with no entry at all:

| You would install | Here |
|---|---|
| Wordfence, Sucuri | 🚫 — [07 §7.2](../from-wordpress/07-cross-cutting.md) |
| UpdraftPlus | 🚫 plugin; ✅ two shell scripts — [07 §7.1](../from-wordpress/07-cross-cutting.md) |
| WP Super Cache, W3 Total Cache | 🚫 **no caching plugin at all** — §5.7 |
| WPML, Polylang | 🚫 plugin; 📋 built-in localization — §5.9 |
| Elementor, Divi, WPBakery | 🚫 — [03 §3.4](../from-wordpress/03-payload-for-acf-and-cpt.md) |
| Akismet | 🚫 — no comment system; `POST /store/reviews` takes public writes and nothing scores them for spam |
| Yoast's readability analysis | 🚫 — nothing scores your prose |

---

## 5.3 Two traps that will cost you an evening each

### The Stripe trap ⚠️

**Search npm for "medusa stripe" and the first plausible result is wrong.**
`medusa-payment-stripe` (6.0.11) is the old Medusa **v1** community package and
will not work on v2, while the one you want — `@medusajs/payment-stripe`
(2.21.2) — looks older because its version tracks the Medusa core version. The
rule that saves you: **in Medusa 2, anything official is scoped `@medusajs/`.**

[06 §6.4](06-commerce.md#64--the-stripe-package-trap--you-will-find-the-wrong-one-first)
works the whole trap through with `npm view <name> peerDependencies` on both
packages and a `--dry-run` that fails and then succeeds. Read it before you
install a payment provider.

### The version-drift trap ⚠️

What is installed here and what npm hands you today are not the same: **Payload
3.88.0** against a 3.90.2 plugin line, **Medusa 2.19.0** against 2.21.2, Astro
7.2.4. And Payload plugins pin their core peer **exactly**, which is stricter
than almost anything you have met in WordPress:

```bash
npm view @payloadcms/plugin-seo peerDependencies
( cd apps/cms && npm install --dry-run @payloadcms/plugin-seo 2>&1 \
  | grep -E 'ERESOLVE unable|Found:|peer payload' )
```

```
{
  react: '^19.0.1 || ^19.1.2 || ^19.2.1',
  payload: '3.90.2',
  'react-dom': '^19.0.1 || ^19.1.2 || ^19.2.1'
}
npm error ERESOLVE unable to resolve dependency tree
npm error Found: payload@3.88.0
npm error peer payload@"3.90.2" from @payloadcms/plugin-seo@3.90.2
```

Note `payload: '3.90.2'` — not `^3.90.2`, not `>=3.88`. An exact pin, so
installing today's SEO plugin into this repo **fails before it downloads
anything**. WordPress guards the same ground and guards it well: since 5.2 the
plugins screen greys out **Activate** when a plugin's `Requires at least` or
`Requires PHP` header is not met. The difference is scope, not diligence. That
header is one floor, typed by the author into a file comment and never checked
against the code; npm resolves an exact version against your whole installed
tree, and refuses before anything reaches disk.

⚠️ **Do not reach for `--force` or `--legacy-peer-deps` when you see that
error.** npm suggests both in the message and both let you install a plugin
compiled against a different Payload than the one running. The correct fix is to
upgrade Payload to match the plugin, in its own commit, before you add the
plugin — §5.4 step 1.

---

## 5.4 How to install a Payload plugin

**In WordPress:** Plugins → Add New → search "Yoast" → Install Now → Activate.
The new meta box appears on the post edit screen immediately. Nothing restarts.

**Here:** Payload owns content, so SEO fields are Payload's job. A plugin is an
npm package that returns a function; you call it inside the `plugins` array of
[`payload.config.ts`](../../apps/cms/src/payload.config.ts) and restart.

**Steps**, worked through with `@payloadcms/plugin-seo`.

1. **Match the versions first** (§5.3). If `peerDependencies` and what is
   installed differ, upgrade Payload in its own commit — `payload`,
   `@payloadcms/db-postgres`, `@payloadcms/next`, `@payloadcms/richtext-lexical`
   and `@payloadcms/ui` in
   [`apps/cms/package.json`](../../apps/cms/package.json) all move together.
   Upgrading one is how you get a half-upgraded tree.

2. **Install into the right app.** There is no root `node_modules` here — three
   apps, three trees, three lockfiles
   ([04 §4.1](04-stack.md#41-three-apps-three-npm-projects-one-repository)):

   ```
   npm --prefix apps/cms install @payloadcms/plugin-seo
   ```

3. **Edit [`apps/cms/src/payload.config.ts`](../../apps/cms/src/payload.config.ts).**
   Add the import at the top and replace line 103's empty array:

   ```ts
   // apps/cms/src/payload.config.ts
   import { seoPlugin } from '@payloadcms/plugin-seo'
   …
   plugins: [
     seoPlugin({
       collections: ['posts', 'pages'],
       uploadsCollection: 'media',
       generateTitle: ({ doc }) => `${doc.title} · Astro · Payload · Medusa`,
     }),
   ],
   ```

   That is the whole activation — and it is a diff. WordPress's activation is a
   row in `wp_options` that no code review will ever see.

4. **Restart Payload.** `plugins` is read once at boot, so hot reload will not
   pick it up:

   ```
   npm run dev:cms
   ```

5. **Let `push` migrate the schema.** The plugin adds a `meta` group, which means
   new **columns**. In dev `postgresAdapter` has `push` on
   ([`payload.config.ts:91-99`](../../apps/cms/src/payload.config.ts) explains
   it), so they appear on boot with no migration command. In production you set
   `push: false` and run `npm --prefix apps/cms run payload migrate:create`,
   then `npm --prefix apps/cms run payload migrate`.

6. **Regenerate the types** so your editor knows the new fields exist:

   ```
   npm --prefix apps/cms run generate:types
   ```

**Verify** — the shape of a post document is the proof. This is the repo
**today**, before any plugin:

```bash
curl -s 'http://localhost:3000/api/posts?limit=1&depth=0' \
  | python3 -c 'import json,sys; print(sorted(json.load(sys.stdin)["docs"][0].keys()))'
```

```
['_status', 'category', 'content', 'coverImage', 'createdAt', 'excerpt', 'id', 'publishedAt', 'slug', 'tags', 'title', 'updatedAt']
```

No `meta`. Run the same command after step 5 and `meta` is in that list, with
`title`, `description` and `image` inside it. If it is not, the plugin did not
load — check that you edited the array and not just the import.

⚠️ **Gotcha — an empty `plugins: []` is not a "nothing installed yet"
placeholder, it is the finished state of this repo.** Before you install one,
check whether the thing you want is forty lines in a collection config: several
of the Payload plugins above are, at small scale, a field group plus a hook.
§5.6 does exactly that for SEO.

**Going deeper:**
[03 §3.3](../from-wordpress/03-payload-for-acf-and-cpt.md) — how a field
declaration becomes a Postgres column, which is what step 5 is really doing.

---

## 5.5 How to install an Astro integration

**In WordPress:** the same Add New screen. A sitemap plugin starts writing
`/sitemap_index.xml` the moment you activate it.

**Here:** Astro integrations hook the **build and dev pipeline** — adding routes,
injecting scripts, registering a renderer. They go in `integrations` in
[`astro.config.mjs`](../../apps/storefront/astro.config.mjs), which holds exactly
one entry today.

**Steps**, with `@astrojs/sitemap` — and then an honest warning about it.

1. **Install into the storefront:**

   ```
   npm --prefix apps/storefront install @astrojs/sitemap
   ```

2. **Edit
   [`apps/storefront/astro.config.mjs`](../../apps/storefront/astro.config.mjs)** —
   import at the top, integration in the array, and `site`, which the sitemap
   needs for absolute URLs and which this repo does not set
   ([07 §7.6.1](../from-wordpress/07-cross-cutting.md) flags the same missing
   line as the blocker for canonicals):

   ```js
   // apps/storefront/astro.config.mjs
   import sitemap from '@astrojs/sitemap'

   export default defineConfig({
     site: 'http://localhost:4321',
     output: 'server',
     integrations: [react(), sitemap()],
     …
   })
   ```

3. **Restart the storefront.** `astro.config.mjs` is read at startup only:

   ```
   cd apps/storefront && npx astro dev stop
   npm run dev:storefront
   ```

   ⚠️ **Astro 7 backgrounds its own dev server**, so `Ctrl-C` in the terminal
   that started it does not always stop it. `npx astro dev stop` is the reliable
   way, and starting a second one silently serves stale config —
   [04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321).

**Verify** — the starting state, which is one integration and two favicons:

```bash
grep -n 'integrations:' apps/storefront/astro.config.mjs
ls apps/storefront/public/
```

```
38:  integrations: [react()],
favicon.ico
favicon.svg
```

After step 3 the first command shows two entries. An integration that emits files
only does so during `npm --prefix apps/storefront run build`, not in dev — so
build, then look in `apps/storefront/dist/` for what it wrote.

⚠️ **Gotcha — `@astrojs/sitemap` is the wrong tool for this particular repo, and
it will not tell you so.** It installs cleanly — no ERESOLVE, unlike §5.4 — and
then builds its URL list at **build** time from routes that have a fixed
pathname. Under `output: 'server'` nothing is prerendered, so every dynamic
route is skipped, and the dynamic routes here are exactly the content:

```bash
find apps/storefront/src/pages -name '*.astro' | sed 's|apps/storefront/src/pages||' | sort \
  | awk '{print (/\[/ ? "dynamic — never in the sitemap" : "static  — all you get "), $0}'
```

```
static  — all you get  /index.astro
static  — all you get  /monitor.astro
dynamic — never in the sitemap /pages/[slug].astro
dynamic — never in the sitemap /posts/[id]/edit.astro
dynamic — never in the sitemap /posts/[slug].astro
static  — all you get  /posts/index.astro
static  — all you get  /posts/new.astro
dynamic — never in the sitemap /products/[handle].astro
static  — all you get  /products/index.astro
dynamic — never in the sitemap /reviews/[id]/edit.astro
static  — all you get  /reviews/index.astro
static  — all you get  /schema.astro
```

Seven static, five dynamic. The sitemap you ship lists the seven — including
`/monitor`, `/schema` and `/posts/new`, which you actively do not want indexed —
and not one post, page or product. That is worse than no sitemap, because it
looks like one. The right answer is an SSR endpoint,
`src/pages/sitemap.xml.ts`, asking Payload for published documents at request
time — sketched in [07 §7.6.1](../from-wordpress/07-cross-cutting.md), with
`src/pages/api/` as the template. **WordPress is simply ahead here:** Yoast
builds its sitemap from the database on request, so a new post is in it without
a rebuild.

**Going deeper:**
[04 · Astro for theme developers](../from-wordpress/04-astro-for-theme-developers.md).

---

## 5.6 How to do SEO with no plugin at all

**In WordPress:** Yoast. Meta title and description with a live SERP preview,
canonicals, Open Graph, XML sitemaps, article and breadcrumb schema,
`robots.txt` editing, and the readability light your clients chase.

**Here:** two services share the job. **Payload holds the values**, because it
owns the content; **Astro renders them into `<head>`**, because it owns the
markup. Nothing connects the two but a prop you pass. **Say this out loud before
you quote the work: Yoast is better than what you will hand-roll, and it will
stay better for a long time.** 📋 **Supported, not configured here** — this repo
has no `seo` field group, so the steps are the shape to build and **Verify**
shows the baseline.

**Steps**

1. **Add the fields in Payload.** Pure ACF muscle memory — a `group`, the same
   shape as `announcement` in
   [`apps/cms/src/globals/SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts),
   added to the `fields` array of
   [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
   and [`Pages.ts`](../../apps/cms/src/collections/Pages.ts):

   ```ts
   { name: 'seo', type: 'group', fields: [
     { name: 'metaTitle', type: 'text' },
     { name: 'metaDescription', type: 'textarea', maxLength: 160 },
     { name: 'ogImage', type: 'upload', relationTo: 'media' },
     { name: 'noIndex', type: 'checkbox', defaultValue: false },
   ] }
   ```

   A `group` flattens to prefixed columns — `seo_meta_title`,
   `seo_meta_description` — exactly as
   [03 §3.3](../from-wordpress/03-payload-for-acf-and-cpt.md) describes for
   `announcement_*`.

2. **Set `site`** in
   [`astro.config.mjs`](../../apps/storefront/astro.config.mjs). Without it
   `Astro.site` is `undefined` and you have no absolute canonical URL.

3. **Widen the hand-written type.** The storefront does **not** import Payload's
   generated types; it declares its own contract in
   [`apps/storefront/src/lib/types.ts`](../../apps/storefront/src/lib/types.ts),
   and argues the case in that file's header comment. Add `seo` there or
   `astro check` rejects the new prop.

4. **Render it in one place.** Give
   [`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) an optional
   `seo` prop and emit the tags beside lines 61–62, so the fallback policy
   ("meta description, else excerpt, else the site default") lives in one file
   rather than in every page.

5. **Pass it from the page.** `posts/[slug].astro` already passes `title` and
   `subtitle` into the layout; `seo` goes the same way.

**Verify** — the baseline, today:

```bash
grep -rn 'canonical\|og:\|hreflang\|sitemap\|robots' apps/storefront/src | wc -l
```

```
0
```

Zero. After step 4 that number is your progress bar.

⚠️ **Gotcha — per-page titles already work, and that is the only part that
does.** Lines 61–62 are real and `posts/[slug].astro` really does pass the post's
title and excerpt through, so it is easy to see a correct `<title>` and assume
the rest followed. It did not: no canonical, no Open Graph, no sitemap, no
`robots.txt`, no structured data, and no content analysis ever, unless you write
it.

**Going deeper:**
[07 §7.6 — Yoast becomes code you own](../from-wordpress/07-cross-cutting.md).

---

## 5.7 How to cache — and why there is no caching plugin

**In WordPress:** install WP Super Cache or W3 Total Cache, tick a box. PHP
writes the rendered HTML to disk, and **the next visitor gets that file instead
of a full WordPress bootstrap and a few dozen MySQL queries** — in WP Super
Cache's mod_rewrite mode, served by Apache before PHP starts at all. It is one
of the best effort-to-payoff trades in web development.

**Here:** 🚫 **there is no caching plugin, for any of the three projects.** Not a
different approach — nothing of that kind exists to install.

The model does not port because that trick needs two things this stack does not
have: a rendered HTML file sitting on disk, and something cheap in front of the
app that can serve it. Astro under `output: 'server'` with the standalone Node
adapter ([`astro.config.mjs:40-44`](../../apps/storefront/astro.config.mjs))
renders on every request and has nothing in front of it. The equivalent bypass
is a CDN or reverse proxy, instructed by `Cache-Control` headers you set
yourself. No file for a plugin to write, no server to intercept the request.
Per layer:

| Layer | WordPress | Here | Status |
|---|---|---|---|
| Full-page HTML | WP Super Cache writes `.html` | `Cache-Control: s-maxage` + a CDN | 🚫 |
| Object cache | `wp_cache_*` + Redis drop-in | `@medusajs/cache-redis` is **registered** | ✅ module / 🚫 app data |
| Query / fragment cache | transients | nothing built in for SSR fragments | 🚫 |
| Purge on write | `save_post` hook | `Posts.afterChange` — **the seam exists and logs** | 🚫 |
| Astro page render | — | re-fetches both backends **every request** | 🚫 by design |

**Steps** 🚫 — **none of this exists in this repo.** This is the shape to build;
the **Verify** below proves the starting point, not the finish.

1. **Pick one cacheable page.** It has to be public and identical for every
   visitor. [`apps/storefront/src/pages/products/index.astro`](../../apps/storefront/src/pages/products/index.astro)
   qualifies; `/monitor`, `/schema` and anything under `/posts/*/edit` do not.

2. **Set the header in that page's frontmatter** — one line, no package:

   ```ts
   Astro.response.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
   ```

   This caches nothing by itself. It is an instruction to whatever sits in
   front of Astro.

3. **Put something in front that obeys it.** A CDN, or nginx `proxy_cache`.
   There is no such layer in this repo or in `infra/docker-compose.yml`, so
   this is a deployment step, costed in
   [09 §9.6](../learn/09-to-production.md).

4. **Write the purge route.** A new file
   `apps/storefront/src/pages/api/revalidate.ts`, in the shape of the existing
   handlers in [`src/pages/api/`](../../apps/storefront/src/pages/api/), that
   tells the CDN to drop the key.

5. **Fire it from the seam that already exists.** `afterChange` on
   [`apps/cms/src/collections/Posts.ts:149-155`](../../apps/cms/src/collections/Posts.ts)
   logs and nothing else — a deliberate placeholder, and
   [09 §9.6](../learn/09-to-production.md) shows the `fetch` that belongs in it.

6. **Authenticate step 4 before you deploy step 5.** See the gotcha below.

**Verify** — the starting point, three claims at once:

```bash
grep -rn 'Cache-Control\|s-maxage\|revalidate' apps/storefront/src apps/cms/src | wc -l
docker exec apm-redis redis-cli --scan --pattern 'medusa:*' | wc -l
test "$(docker exec apm-redis redis-cli dbsize)" \
   = "$(docker exec apm-redis redis-cli --scan | grep -cE '^(bull:|RedisEventBusService:)')" \
  && echo 'every key in redis is a queue key'
```

```
0
0
every key in redis is a queue key
```

Read the three lines together, because they are the whole truth: **no cache
header anywhere in either codebase**; **no `medusa:*` cache entry**; and the
third line says why — `dbsize` and the count of BullMQ / event-bus keys are
equal, so every key Redis holds belongs to the workflow engine or the event
bus. The cache module is registered and correct; nothing has asked it to cache
anything.

⚠️ **Do not expect a fixed key count.** The uptime job writes a repeat key every
minute, so `dbsize` drifts — a few dozen, climbing. The claim worth checking is
the equality, not the number.

Steps 1, 2, 4 and 5 need no new package at all — the only thing you cannot do
with code you already own is step 3.

⚠️ **Gotcha — authenticate the purge endpoint on the day you write it.** An
unauthenticated `POST /api/revalidate` is a button an attacker holds down to make
every request a cache miss, and the storefront has **no authentication at all**
today ([07 §7.8](../from-wordpress/07-cross-cutting.md)).

**Credit where it is due: WordPress is simpler here by a long way.** Install,
tick, done, measurably faster. This stack asks you to choose a layer, write the
headers, build the purge path and secure it.

**Going deeper:** [09 §9.6 — Caching](../learn/09-to-production.md), three layers
in order of cost.

---

## 5.8 How to build a form — the Gravity Forms question

**In WordPress:** Gravity Forms. Drag fields onto a canvas and you get the
rendered form, server-side validation, an entries table in wp-admin, email
notifications, conditional logic, file uploads, CSV export and payment add-ons.

**Here:** two routes. **The plugin gives you the builder; the repo's existing
pattern gives you everything else more cheaply than you expect.**

| | `@payloadcms/plugin-form-builder` 3.90.2 | Astro Action + Payload collection |
|---|---|---|
| Who defines the form | an **editor**, in the admin | **you**, in TypeScript |
| Entries table | the plugin's `form-submissions` collection | a collection you declare |
| Validation | the plugin's field config | `astro/zod`, field-level errors |
| Email | the plugin's `emails` config — **needs a transport** | an `afterChange` hook — same |
| Already demonstrated here | 🚫 | ✅ three actions for posts |

**Route A — install the plugin** when a non-developer must create new forms
without a deploy. That is the genuine Gravity Forms use case and the only reason
to take the dependency. Install it exactly as §5.4: `npm --prefix apps/cms
install @payloadcms/plugin-form-builder`, add `formBuilderPlugin({...})` to
`plugins: []`, restart, let `push` create the tables.

**Route B — Action plus collection** when it is one contact form that will not
change. 📋 **No contact form exists in this repo**, but both halves of the
pattern do, in working code.

**Steps** for route B:

1. **Declare the collection** — a new file in
   [`apps/cms/src/collections/`](../../apps/cms/src/collections/) beside
   `Posts.ts`, with the access rules doing the real work:

   ```ts
   access: { create: () => true, read: ({ req }) => Boolean(req.user) },
   ```

   Public write, private read, two lines — and Payload generates the list view,
   the filters, the detail screen and the search box. **That is the entries
   table, free**, and it is the part of Gravity Forms that would have taken you
   longest to rebuild.

2. **Register it** in the `collections` array at
   [`payload.config.ts:42`](../../apps/cms/src/payload.config.ts).

3. **Write the Action** in
   [`apps/storefront/src/actions/index.ts`](../../apps/storefront/src/actions/index.ts),
   copying the twelve-line shape of `post.create`
   ([`index.ts:100-111`](../../apps/storefront/src/actions/index.ts)) —
   `accept: 'form'`,
   `input: z.object(…)`, a handler that calls into
   [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts) and maps
   failures through `toActionError`.

4. **Point a plain HTML form at it** —
   `<form method="POST" action={actions.contact.submit}>` — and render errors
   with [`FieldError.astro`](../../apps/storefront/src/components/FieldError.astro).
   Because `accept: 'form'` makes it an ordinary POST, it works with JavaScript
   disabled — which Gravity Forms' conditional logic, being front-end
   JavaScript, cannot.

5. **Put the notification in the Payload `afterChange` hook, not the Action**, so
   a mail failure cannot lose a submission that is already saved.

**Verify** — the pattern it copies is live. Payload's own validation, rejecting
a write, with no form involved:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"excerpt":"no title"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print([(e["path"], e["message"]) for e in d["errors"][0]["data"]["errors"]])'
```

```
[('title', 'This field is required.')]
```

That rule came from `required: true` in a collection file — no validator, no
error message and no response shape written by you.

⚠️ **Gotcha — there is no mail transport in this repo, and neither route adds
one.** Gravity Forms sends mail because WordPress has `wp_mail()` and your host
usually has something behind it — though often enough it does not, which is why
WP Mail SMTP exists, so this is not quite free there either. Here "email the
submission" is a dependency you choose:
`@medusajs/notification-sendgrid` 2.21.2 on the Medusa side, a provider you wire
yourself on the Payload side. Scope it as work, not a checkbox.

**Going deeper:**
[07 §7.4 — Gravity Forms: the mechanism exists, the product does not](../from-wordpress/07-cross-cutting.md).

---

## 5.9 How to go multilingual — the WPML question

**In WordPress:** install WPML, pick your languages, and you get per-language
posts, a language switcher, `hreflang` tags, a string-translation screen, a
translator workflow, XLIFF export and translation memory. One purchase, one
afternoon.

**Here:** 📋 **three built-in features in three projects, none of them
configured.** Payload localizes content fields, Astro routes URLs, Medusa handles
currency and tax by region. No single package does all three, and none will.

**Verify** — the starting point: the capability is present in `node_modules`
and absent from both configs.

```bash
grep -n "localization?: false" apps/cms/node_modules/payload/dist/config/types.d.ts
grep -n "localized?: boolean" apps/cms/node_modules/payload/dist/fields/config/types.d.ts | head -1
grep -n "i18n?: {" apps/storefront/node_modules/astro/dist/types/public/config.d.ts
grep -c "localization" apps/cms/src/payload.config.ts
grep -c "i18n" apps/storefront/astro.config.mjs
```

```
1092:    localization?: false | LocalizationConfig;
327:    localized?: boolean;
2562:    i18n?: {
0
0
```

Three type definitions, two zeroes. **The capability is one config key per app
away. The data model it gives you is not WPML's, and that difference is the part
that matters.**

### 5.9.1 WPML duplicates documents; Payload localizes fields

The single idea to take from this section.

**WPML makes a translation a separate post.** The German version of post 42 is
post 57 — its own row in `wp_posts`, its own ID, slug, revision history, publish
status and meta — joined to the original through `icl_translations`. Every query
you write has to be language-aware.

**Payload localizes fields inside one document.** Post 42 stays post 42 forever.
Marking `title` as `localized: true` means that *field* stores a value per
locale, and a request carries `?locale=de`. One row, one ID, one version history,
many language values.

| | WPML | Payload localization |
|---|---|---|
| Unit of translation | the whole post | **a field** |
| IDs | one per language | **one, shared** |
| Relationships | per-language, re-linked | shared by default |
| Draft / publish state | **independent per language** | **one state per document** |
| Slug | always per-language | only if you localize the slug field |
| Structure can diverge | yes — different blocks per language | no, unless you localize the layout |
| Missing translation | a missing post, you pick a fallback | field-level fallback to `defaultLocale` |
| "The German site has 3 extra articles" | natural | awkward — needs a locale-aware filter |
| "One article in four languages, in step" | awkward — four posts to keep aligned | natural |
| UI string translation | WPML String Translation | **Astro's job, not Payload's** |
| Translator workflow, memory, XLIFF | built in | **nothing** |

Neither model is right in the abstract. Ask one question: **do the language
versions stay in step, or diverge?** Documentation and catalogues stay in step,
and Payload makes "the English page was updated and the German one was not"
structurally impossible. National marketing sites sharing a brand and nothing
else diverge, and there WPML is simply the better shape.

⚠️ **Independent publish state is the row people underestimate.** WPML lets you
publish English today and hold German in draft until the translation lands; a
Payload document has one `_status`, so that workflow needs a per-locale flag you
design yourself. Check it against how your editors work **before** you choose,
not after the content is in.

### 5.9.2 How to turn it on — the config shapes 📋

**Steps** 📋 — **not configured here, so nothing in this subsection is
runnable.** The **Verify** at the top of §5.9 is the proof of the starting
point.

1. **Start on an empty database.** `npm run db:reset` then `npm run setup`.
   Step 3 is a data move, not just a schema change — see the gotcha below.

2. **Add one key to
   [`apps/cms/src/payload.config.ts`](../../apps/cms/src/payload.config.ts)**,
   beside `collections` and `plugins`:

   ```ts
   // apps/cms/src/payload.config.ts — NOT PRESENT IN THIS REPO
   localization: { locales: ['en', 'de', 'fr'], defaultLocale: 'en', fallback: true },
   ```

   `locales` and `defaultLocale` are the required pair. `fallback` defaults to
   `true`, so a missing German value serves the English one — see
   `BaseLocalizationConfig` at `payload/dist/config/types.d.ts:374-402`, which
   also carries the optional `defaultLocalePublishOption` and
   `filterAvailableLocales` this one-liner leaves at their defaults.

3. **Flag each field you want translated**, in
   [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
   and [`Pages.ts`](../../apps/cms/src/collections/Pages.ts). The real `title`
   field is at `Posts.ts:57-62`; one key is the whole change:

   ```ts
   // apps/cms/src/collections/Posts.ts — `localized` IS NOT PRESENT IN THIS REPO
   { name: 'title', type: 'text', required: true, maxLength: 200, localized: true },
   ```

4. **Restart Payload** (`npm run dev:cms`) and let `push` build the new tables,
   then `npm --prefix apps/cms run generate:types`. Reads now take
   `?locale=de`.

5. **Add the matching key to
   [`apps/storefront/astro.config.mjs`](../../apps/storefront/astro.config.mjs)**.
   Astro's i18n gives you URL prefixes and nothing else — it has never heard of
   Payload's locales:

   ```js
   // apps/storefront/astro.config.mjs — NOT PRESENT IN THIS REPO
   i18n: { locales: ['en', 'de', 'fr'], defaultLocale: 'en' },
   ```

   Both keys are required (`astro/dist/types/public/config.d.ts:2562`). That
   buys `/de/posts/…`, `Astro.currentLocale` and a `fallback` strategy for
   missing routes.

6. **Write the glue, because nothing else will.** Read `Astro.currentLocale` in
   each page and pass it to `listPosts()` in
   [`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts) as a `locale`
   parameter; widen
   [`lib/types.ts`](../../apps/storefront/src/lib/types.ts) to match, or
   `astro check` rejects it. §5.9.4 is the rest of the list.

7. **Restart the storefront**: `cd apps/storefront && npx astro dev stop`, then
   `npm run dev:storefront`.

**Verify** — after step 4, `curl -s 'http://localhost:3000/api/posts?locale=de&limit=1'`
returns German values where they exist and English where they do not. Today
that query returns the same English document for every value of `locale`,
because no field is localized.

⚠️ **`localized: true` changes the SQL.** A localized field moves out of `posts`
into a `posts_locales` table keyed by locale. With `push` on in dev that happens
on restart with no migration command, and with existing content it is a data
move, not just a schema change. That is why step 1 is step 1.

### 5.9.3 The Medusa half — regions, not languages

Medusa translates nothing. It models the *commercial* side of a multi-country
site — currency, tax, shipping, available payment providers — as a **region**,
and that is a built-in, not a plugin. One exists here:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c 'select name, currency_code from region;'
```

```
  name  | currency_code 
--------+---------------
 Europe | eur
(1 row)
```

A second region is a row, not a package — a genuine advantage over WooCommerce,
where multi-currency is a paid plugin.

### 5.9.4 The four things WPML does that nothing here does

Even with both config keys set, you still write:

| | Who does it here |
|---|---|
| Routing glue — Astro locale → Payload `?locale=` | **you**, in every page |
| `hreflang` + canonical tags | **you** — nothing emits them (§5.6) |
| UI string dictionary ("Read more", "Add to cart") | **you**, or an i18n library |
| Updating [`lib/types.ts`](../../apps/storefront/src/lib/types.ts) | **you** — only `astro check` notices drift |

**That list is most of why people pay for WPML, and saying so is not a criticism
of this stack.** The costs on the WPML side are a licence, a join against
`icl_translations` on every language-aware query, and a migration away that has
to rebuild every relationship by hand.

**Going deeper:**
[07 §7.5 — WPML translates documents; Payload translates fields](../from-wordpress/07-cross-cutting.md).

---

## 5.10 Before you install anything, ask these four questions

| Question | If yes | If no |
|---|---|---|
| Does a non-developer need to change it without a deploy? | take the plugin | write it |
| Is it a protocol with edge cases? (S3, Stripe, OAuth) | take the plugin | — |
| Would it be under ~100 lines in a config file? | — | **write it** |
| Does its peer range match what is installed? | install | **upgrade core first** (§5.3) |

Several of the Payload plugins in §5.2 are, at the scale you work at, a field
group plus a hook plus a render branch — `plugin-seo` is (§5.6), and
`plugin-redirects` is a `redirects` collection plus a lookup in
[`middleware.ts`](../../apps/storefront/src/middleware.ts). The two worth
the dependency on day one are **`storage-s3`**, because local disk loses your
uploads on redeploy, and **`payment-stripe`**, because you should never
hand-roll a payment integration ([06 §6.3](06-commerce.md#63--how-to-add-stripe-to-this-stack)).
That is the opposite of the WordPress calculus,
where installing is almost always cheaper than writing — and both calculations
are correct for their own ecosystem.

---

## Check yourself

1. `plugins: []`, `integrations: []`, `modules: []` and a module's
   `options.providers: []` are four different slots. Which project owns each,
   and which one does a Stripe gateway go in?
2. npm shows `medusa-payment-stripe@6.0.11` and
   `@medusajs/payment-stripe@2.21.2`. The first has a much higher version number.
   Why is it the wrong one, and what rule would have saved you?
3. `npm install @payloadcms/plugin-seo` fails in `apps/cms` with ERESOLVE. npm
   suggests `--force` and `--legacy-peer-deps`. What should you actually do, and
   what does the exact pin `payload: '3.90.2'` check that a `Requires at least`
   header does not?
4. Redis is running with several dozen keys and the Medusa cache module is
   registered, yet the scan for `medusa:*` returns 0 and the count of
   `bull:`/`RedisEventBusService:` keys equals `dbsize`. What is true, and what
   is not?
5. `@astrojs/sitemap` installs cleanly and lists seven of this repo's twelve
   page routes — and not one post, page or product. Why those seven, and what
   is the fix?
6. WPML makes post 42's German version into post 57. Payload keeps it as post 42.
   Name one editorial workflow each model makes easy and the other makes hard.
7. You set `localized: true` on `Posts.title` against a database with 5 posts in
   it. What happens to the SQL schema, and why should you try it on an empty
   database first?
8. A client wants a contact form with an entries screen and an email
   notification. Which part does Payload hand you free, and which part is not in
   this repo at all?

---

**Next:** [06-commerce.md](06-commerce.md) — payments, multiple stores and
inventory: where `@medusajs/payment-stripe` actually plugs in, and which of
WooCommerce's paid add-ons are built-ins here. TypeScript, the three `.env`
files and the terminal commands are back in
[04 · The stack itself](04-stack.md).
