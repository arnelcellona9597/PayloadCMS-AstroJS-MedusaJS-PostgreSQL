# How-to — recipes for a WordPress developer

A cookbook. Where [`../learn/`](../learn/README.md) explains how the stack works
and [`../from-wordpress/`](../from-wordpress/README.md) explains what each
WordPress idea became, this track answers **"how do I actually do it"** in
numbered steps you can follow with your hands — the exact file to edit, the exact
command to run, and a verification command with its real output pasted
underneath.

Every one of these seven pages was written against the running stack on
2026-10-04. Nothing in them is a sketch unless it carries a label saying so.

---

## The question index

You asked twenty-one questions. This table is the fastest way back to any of
them. Where two pages answer the same question from different ends — the admin
side and the frontend side, say — both are listed, in the order worth reading.

| # | Your question | Answered in |
|---|---|---|
| 1 | *How to create a page* | [01 §1.1](01-content.md#11-create-a-page-is-two-jobs-here-not-one) and [§1.2](01-content.md#12-how-to-create-a-content-page-a-pages-document) — the Payload document; then [02 §2.1](02-frontend.md#21-routing-is-a-map-of-files-not-a-cascade-you-memorise) — the Astro route that renders it |
| 2 | *How to create a posts* | [01 §1.3](01-content.md#13-how-to-create-a-post) — in the admin panel; [03 §3.8](03-data.md#38-how-to-add-a-post-from-a-form-with-javascript-disabled) and [§3.9](03-data.md#39-how-to-add-a-post-from-the-terminal) — from a form or the terminal |
| 3 | *How to create a post type* | [01 §1.4](01-content.md#14-how-to-create-a-new-post-type) — a new collection file, the `register_post_type` replacement |
| 4 | *How to create posts archive page* | [02 §2.2](02-frontend.md#22-how-to-build-a-posts-archive-page) — `posts/index.astro`, plus pagination honestly |
| 5 | *How to create single inner posts page* | [02 §2.3](02-frontend.md#23-how-to-build-a-single-post-page) — `posts/[slug].astro`; [02 §2.4](02-frontend.md#24-rich-text-is-a-json-tree-you-convert--the_content-has-no-equivalent) for rich text, which has no `the_content()` |
| 6 | *How to create custom field and assign into posts* | [01 §1.5](01-content.md#15-how-to-add-a-custom-field-to-posts) — the ACF field-type mapping is in the same section |
| 7 | *How to create a custom block, and reusable block* | [01 §1.6](01-content.md#16-how-to-create-a-custom-block-and-reuse-it) — blocks in Payload; [02 §2.6](02-frontend.md#26-widget-part-one-a-reusable-block-an-editor-can-edit) — rendering one. "Reusable" means two different things and [01 §1.6](01-content.md#reusable-means-two-different-things--and-only-one-is-a-block) separates them |
| 8 | *How to create a custom widget, and reusable block* | [02 §2.6](02-frontend.md#26-widget-part-one-a-reusable-block-an-editor-can-edit) — the editor-facing kind; [02 §2.7](02-frontend.md#27-widget-part-two-an-admin-dashboard-widget) — the admin-dashboard kind; [01 §1.7](01-content.md#17-how-to-share-one-piece-of-content-across-every-page) — one piece of content on every page |
| 9 | *How to fetch, get or show data* | [03 §3.1](03-data.md#31-how-to-read-payload-content-from-the-terminal) onwards — terminal, Astro page, and through your own endpoint; [03 §3.15](03-data.md#315-i-want-to-read-or-write-x--call-this) is the lookup table |
| 10 | *How to add, insert data* | [03 §3.8](03-data.md#38-how-to-add-a-post-from-a-form-with-javascript-disabled) onwards — form, terminal, and what [§3.10](03-data.md#310-how-to-add-a-review--and-what-it-runs-a-workflow-means-for-you) "it runs a workflow" costs you |
| 11 | *How to delete, remove data* | [03 §3.12](03-data.md#312-how-to-delete-a-post--the-row-is-really-gone) onwards — including the [`403`](03-data.md#314-the-403-you-will-hit-on-your-very-first-delete) you will hit first, and [why a deleted review is still in the table](03-data.md#313-how-to-delete-a-review--and-why-the-row-is-still-there-afterwards) |
| 12 | *Are there plugins or modules for SEO, Caching, etc?* | [05](05-plugins.md) — the whole page. [§5.2](05-plugins.md#52-the-packages-that-actually-exist-grouped-by-the-job-they-do) lists what exists, [§5.6](05-plugins.md#56-how-to-do-seo-with-no-plugin-at-all) does SEO with no plugin, [§5.7](05-plugins.md#57-how-to-cache--and-why-there-is-no-caching-plugin) explains why there is no caching plugin |
| 13 | *How to use the typescript for this stack? Is it only for payload cms?* | [04 §4.8](04-stack.md#48-typescript-is-all-three-apps-not-just-payload) onwards — all three apps, and the generated types nothing imports |
| 14 | *File structure … Is it only 1 .env file?* | [04 §4.1](04-stack.md#41-three-apps-three-npm-projects-one-repository) onwards — the trees; [04 §4.5](04-stack.md#45-there-are-three-env-files-and-no-root-env) — **three** `.env` files, no root one |
| 15 | *What are the terminal commands that I need to know?* | [04 §4.11](04-stack.md#411-the-terminal-commands-grouped-by-what-you-are-doing) — grouped by task; [04 §4.15](04-stack.md#415-the-five-you-will-actually-type) — the five you will actually type |
| 16 | *If I will implement an online payment gateway, what approach should I take?* | [06 §6.2](06-commerce.md#62-you-do-not-build-a-payment-gateway--you-register-a-provider) onwards — you register a provider, you do not build a gateway. Read [§6.1](06-commerce.md#61-nothing-on-this-page-is-running-in-this-repo--read-the-row-counts-first) first; read [§6.4](06-commerce.md#64--the-stripe-package-trap--you-will-find-the-wrong-one-first) before you `npm install` anything |
| 17 | *Multiple languages — the WPML question* | [05 §5.9](05-plugins.md#59-how-to-go-multilingual--the-wpml-question) — field-level localization, the config shape, and the four things WPML does that nothing here does |
| 18 | *Multiple stores, or products with multiple inventory* | [06 §6.8](06-commerce.md#68--how-to-run-multiple-stores--sales-channels-not-multisite) — sales channels; [06 §6.9](06-commerce.md#69--how-to-run-multiple-warehouses--stock-locations-and-inventory-levels) — stock locations and inventory levels; [06 §6.10](06-commerce.md#610--regions-and-price-lists--currency-tax-and-sale-pricing) — regions and price lists |
| 19 | *What is seeding? When to use it?* | [04 §4.13](04-stack.md#413-seeding-is-sample-content-as-code) — what it is and when; [04 §4.14](04-stack.md#414-how-to-re-seed-without-duplicating-everything) — how to re-seed without duplicating everything |
| 20 | *How do we manage and implement the routing?* | [02 §2.1](02-frontend.md#21-routing-is-a-map-of-files-not-a-cascade-you-memorise) — files are routes, there is no hierarchy and nothing to flush |
| 21 | *A tool to navigate and view PostgreSQL, like phpMyAdmin or adminer.php* | [07 §7.1](07-tools.md#71-every-client-wants-the-same-five-values-and-the-port-is-5433) onwards — six options compared, [pgAdmin wired up step by step](07-tools.md#73-how-to-connect-pgadmin-4-to-this-stack-), and [`psql` with nothing installed](07-tools.md#75-how-to-use-psql-without-installing-anything-) |

Two of those answers are shorter than you want them to be, and the pages say so
rather than padding: there is **no caching plugin** for this stack
([05 §5.7](05-plugins.md#57-how-to-cache--and-why-there-is-no-caching-plugin)), and
**nothing in this repo takes a payment**
([06 §6.1](06-commerce.md#61-nothing-on-this-page-is-running-in-this-repo--read-the-row-counts-first)).

---

## The seven pages

| # | Page | What it covers |
|---|---|---|
| 1 | [01 · Content](01-content.md) | Pages, posts, post types, custom fields, blocks and the global that appears on every page — all in Payload's admin and config files. |
| 2 | [02 · Frontend](02-frontend.md) | Routing, the archive page, the single post page, rich text, reusable components, both kinds of "widget", and when a component needs to become an island. |
| 3 | [03 · Data](03-data.md) | Read, create, update and delete — from `curl`, from Astro, and from a browser form — across Payload and Medusa, with the permission errors you will hit. |
| 4 | [04 · The stack itself](04-stack.md) | The file structure, the three `.env` files, TypeScript in all three apps, every terminal command grouped by job, and seeding. |
| 5 | [05 · Plugins and modules](05-plugins.md) | What exists instead of 60,000 plugins: the real package list, how to install one, SEO without a plugin, caching, forms, and multilingual. |
| 6 | [06 · Commerce](06-commerce.md) | Payment providers, multiple stores, multiple warehouses and price lists — and an honest row count showing none of it runs here. |
| 7 | [07 · Tools](07-tools.md) | The phpMyAdmin question: six database clients compared, pgAdmin connected step by step, and why you read with a GUI but write through the APIs. |

Read them in order on a first pass; pages 1 to 4 build on each other. After that,
use the question index above and jump.

---

## Three tracks, three jobs

| | [`../learn/`](../learn/README.md) | [`../from-wordpress/`](../from-wordpress/README.md) | `how-to/` (you are here) |
|---|---|---|---|
| Shape | 13 chapters, a course | 8 chapters, a mapping | 7 pages of recipes |
| Answers | *How does this work?* | *What did my WordPress thing become?* | *What do I type?* |
| Typical sentence | "A collection is a schema definition." | "A collection is `register_post_type` and the ACF field group in one file." | "Open `apps/cms/src/collections/Posts.ts`, add the field, save, run `npm --prefix apps/cms run generate:types`." |
| Use it when | you want the mechanism | you want the translation | you have a task in front of you |

**Which to use when.** Stuck on a task → start here, follow the steps, then take
the *Going deeper* link at the end of the recipe. Confused about a word → go to
[`../from-wordpress/02-concept-map.md`](../from-wordpress/02-concept-map.md).
Want to understand something properly rather than just do it → go to
[`../learn/`](../learn/README.md).

These pages **link rather than re-teach**. Module isolation, compensation, the
BFF pattern and Lexical's internals are all explained at length in the other two
tracks, so a recipe here will give you the step and then point at the chapter.
Follow the link when the step surprises you.

---

## The three honesty labels

Every claim in this cookbook carries one of these, so you never have to guess
whether an example is real.

| Mark | Meaning |
|---|---|
| ✅ | **Works here.** Real file, real path, a command that runs today. The output below it is the output it actually printed. |
| 📋 | **Supported, not configured here.** The framework does this; this repo does not. Read it as a design, not a tutorial — **there is no command to run**. |
| 🚫 | **Not in this repo at all.** No code, no rows. Explained conceptually so you know what you would have to build. |

The 📋 rows are the ones that cost you an afternoon. They are the places where
you reach for something WordPress gave you free, find that the capability really
does exist, and then discover nobody wired it up. Most of [06](06-commerce.md)
and [§5.9](05-plugins.md#59-how-to-go-multilingual--the-wpml-question) are 📋, and
both pages say so in their first screen
rather than letting you find out at the `npm install`.

---

## Before you start

**Do not read this track against a dead environment.** Almost every section ends
in a command whose real output is pasted underneath, and running it yourself is
most of the value.

From the repo root:

```bash
npm install && npm run setup   # first time only — idempotent, safe to repeat
npm run dev                    # all three apps, colour-coded
```

**Two of the three services must be up for most recipes to work.** Payload on
`:3000` owns posts, pages, categories, media and site settings; Medusa on `:9000`
owns products and reviews. Those two hold all the data, and every `curl` in
[01](01-content.md), [03](03-data.md) and [06](06-commerce.md) talks to one of
them directly. Astro on `:4321` owns nothing — it only calls the other two — so
it is required for [02](02-frontend.md) and for the Astro-side half of
[03](03-data.md), and optional elsewhere. Postgres must be running for any of it;
`npm run db:up` starts it.

Confirm the pieces, one layer at a time:

```bash
docker ps --filter name=apm- --format '{{.Names}}  {{.Status}}'
```

```
apm-postgres  Up 2 hours (healthy)
apm-redis  Up 2 hours (healthy)
```

```bash
curl -s -o /dev/null -L -m 10 -w 'payload :3000/admin  HTTP %{http_code}\n' http://localhost:3000/admin
curl -s -o /dev/null -L -m 10 -w 'medusa  :9000/app    HTTP %{http_code}\n' http://localhost:9000/app
```

```
payload :3000/admin  HTTP 200
medusa  :9000/app    HTTP 200
```

⚠️ **Ask Astro where it is instead of assuming 4321.** Astro 7 backgrounds its
own dev server and silently takes the next free port when the configured one is
busy, which is exactly what happened on this machine while these pages were
written:

```bash
cd apps/storefront && npx astro dev status
```

```
{"message":"Dev server running at http://localhost:4321 (pid 143892, uptime 32s, background)","label":"SKIP_FORMAT","level":"info"}
```

**Set `SF` to whatever it printed and keep it in your shell** — every storefront
command in [02](02-frontend.md) and [03](03-data.md) is written against `$SF`
rather than a hard-coded port:

```bash
SF=http://localhost:4321
```

Then let the storefront check the other two for you — this is the single most
useful command in the repo:

```bash
curl -s -m 15 "$SF/api/health" | python3 -m json.tool
```

```
{
    "ok": true,
    "services": {
        "payload": {
            "ok": true,
            "detail": "103 posts (3 draft), authenticated as admin@local.test",
            "url": "http://localhost:3000"
        },
        "medusa": {
            "ok": true,
            "detail": "33 approved reviews, products reachable",
            "url": "http://localhost:9000"
        }
    },
    "checkedAt": "2026-10-04T09:11:31.983Z"
}
```

Your counts will differ — the seed is a starting point and following these
recipes moves it. What matters is `"ok": true` in all three places.

Why Astro moves, and how to take 4321 back, is
[04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321).

Log in to Payload as `admin@local.test` / `supersecret`. If anything above fails,
[07 · Troubleshooting](../learn/07-troubleshooting.md) is the place to go, and
`npm run db:reset && npm run setup` puts the whole thing back — the repo is
disposable on purpose, so break it freely.

---

**Start with** [01-content.md](01-content.md) — creating a page, a post and a
post type, which is where six of your twenty-one questions live.
