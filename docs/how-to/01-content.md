# 1 · Content — pages, posts, post types, fields and blocks

> Why it is shaped this way:
> [03 · Payload for ACF and CPT](../from-wordpress/03-payload-for-acf-and-cpt.md).
> How Payload works from zero: [03 · Payload](../learn/03-payload.md).
> **This file is the recipe card** — steps you can follow with your hands.

Six recipes get answered here, in this order: create a page, create a post,
create a post type, add a custom field to posts, create a block and reuse it,
and share one piece of content across every page. Each one is a numbered recipe
against the running system. Nothing below is theory; every command in this file
was run against this repo on 2026-10-04 and the output pasted back.

Two things to have open before you start.

**The admin panel** — <http://localhost:3000/admin>, `admin@local.test` /
`supersecret`. That is wp-admin's replacement, for the CMS half of the stack.

**The API key** — the storefront's machine credential, used by every `curl` in
this file. Put it in your shell once:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
echo "key length: ${#KEY}"
curl -s -o /dev/null -w 'auth check -> %{http_code}\n' \
  http://localhost:3000/api/users/me -H "Authorization: users API-Key $KEY"
```

```
key length: 36
auth check -> 200
```

⚠️ **The header is `Authorization: users API-Key <key>`, not `Bearer`.** `users`
is the collection slug, then a literal ` API-Key `. Get it wrong and writes come
back `403` with no hint — which is why
[`apps/cms/src/collections/Users.ts`](../../apps/cms/src/collections/Users.ts)
documents it in a comment block of its own.

---

## 1.1 "Create a page" is two jobs here, not one

Read this before the recipes; it is the thing that wastes a first afternoon.

In WordPress, **Pages → Add New** does two things in one act: it stores the
content, and it creates the URL. `/about-us/` exists because the post exists.
Here those are two different jobs in two different services, and they do not
know about each other:

| The job | WordPress | Here — service and file |
|---|---|---|
| Hold the content | `wp_posts` row, post type `page` | **Payload** — a `pages` document, [`Pages.ts`](../../apps/cms/src/collections/Pages.ts) |
| Serve the URL | derived from `post_name` by the rewrite rules | **Astro** — [`pages/pages/[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro) |
| Choose the template | the template hierarchy, `page-{slug}.php` | the route file you wrote |
| New page, no dev work | ✅ yes | ✅ yes — **if** a route already matches |
| New page *shape* | a new template file | a new route file, or a new block (§1.6) |

Creating a Payload `pages` document does **not** create a URL. Creating an Astro
route does **not** create content. `/pages/about-this-stack` works because both
halves exist: a document with that slug, and a route file with `[slug]` in its
name that fetches by it.

**WordPress is simpler here, and it is not close.** One screen, one click, a live
URL, a template picked for you. You have given that up. What you bought is a URL
space that is a directory you can read, where nobody creates a route by typing in
a text box.

**This file covers the Payload half.** The Astro half — routing, archive pages,
single-post pages — is
[02 §2.1](02-frontend.md#21-routing-is-a-map-of-files-not-a-cascade-you-memorise).
Do not look for routing settings in the Payload admin; there are none.

---

## 1.2 How to create a content page (a Pages document)

**In WordPress:** Pages → Add New, type, Publish. Gutenberg or Elementor supplies
the sections.

**Here:** Payload owns it. A page is a `title`, a `slug` and a `layout` — an
ordered list of **blocks** the editor assembles. Three block types exist today
and the editor cannot invent a fourth.

**Steps — in the admin UI** ✅

1. Open <http://localhost:3000/admin/collections/pages/create>.
2. Fill **Title**. Leave **Slug** (right-hand sidebar) blank — a field hook
   derives it, registered at
   [`Pages.ts:57`](../../apps/cms/src/collections/Pages.ts).
3. Under **Sections**, press **Add Section**. The picker offers exactly three
   entries — **Hero**, **Text**, **Stat row** — because those are the three
   blocks declared in
   [`Pages.ts:67-109`](../../apps/cms/src/collections/Pages.ts).
4. Fill the block's fields. Add more sections; drag to reorder. Order here is
   order on the page.
5. **Save.** There is no Publish button on Pages — see the gotcha below.

**Steps — over the REST API** ✅

1. Export `KEY` as in the preamble.
2. `POST /api/pages` with a JSON body. Every entry in `layout` needs a
   `blockType` naming one of the three block slugs.

```bash
curl -s -X POST http://localhost:3000/api/pages \
  -H "Authorization: users API-Key $KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Pricing",
    "layout": [
      { "blockType": "hero", "heading": "Simple pricing",
        "subheading": "No tiers, no surprises.", "align": "center" },
      { "blockType": "stats", "items": [
        { "value": "3", "label": "services" },
        { "value": "2", "label": "databases" } ] }
    ]
  }' | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; print(d["id"], d["slug"], [b["blockType"] for b in d["layout"]])'
```

```
3 pricing ['hero', 'stats']
```

Your id will differ; `3` is what this repo returned. Run the same `curl` twice
and the second one is a `400` — `slug` is `unique`, so the second `pricing` is
refused by the database constraint, not by a plugin you configured.

You sent no slug. `pricing` came back because the hook ran — the same hook, in
the same file, whether the write arrived from the admin UI or from curl. That is
worth pausing on: in WordPress, `wp_insert_post()` and the REST controller reach
the same `save_post` action by different paths. Here there is one write path.

**The blocks it accepts**, straight from
[`Pages.ts`](../../apps/cms/src/collections/Pages.ts):

| `blockType` | Editor label | Fields |
|---|---|---|
| `hero` | Hero | `heading` (text, **required**), `subheading` (textarea), `align` (select: `left` \| `center`) |
| `prose` | Text | `body` (richText — a Lexical JSON tree, not HTML) |
| `stats` | Stat row | `items` — an array, min 1 max 4, of `{ value, label }`, both required |

**Verify** — the content landed as real rows, not as a JSON blob:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c 'select p.slug, h.heading, h.align from pages p join pages_blocks_hero h on h._parent_id = p.id;'
```

```
       slug       |           heading            | align
------------------+------------------------------+--------
 about-this-stack | Three services, one frontend | center
 pricing          | Simple pricing               | center
(2 rows)
```

That is the difference from Elementor in one line: your page sections are
queryable. A `select` against a section is not a thing you can do to a
`postmeta` blob.

⚠️ **Pages deliberately have no drafts.** [`Pages.ts:113-120`](../../apps/cms/src/collections/Pages.ts)
leaves `versions` off and says why in the comment — drafts would double every one
of the four block tables. So **Save means live**: no "Save Draft" safety net, no
revision history to roll back to. Coming from WordPress, where every page
silently keeps revisions, assume the opposite here.

⚠️ **The page is not reachable until Astro serves it.** `/pages/pricing` works
only because [`[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro)
exists and queries by slug. Nothing in Payload published a URL — §1.1, and
[02 §2.1](02-frontend.md#21-routing-is-a-map-of-files-not-a-cascade-you-memorise)
for the route half.

**Going deeper:**
[from-wordpress 03 §3.4 — blocks are ACF Flexible Content](../from-wordpress/03-payload-for-acf-and-cpt.md),
and [learn 03 §3.14 — globals and blocks](../learn/03-payload.md).

---

## 1.3 How to create a post

**In WordPress:** Posts → Add New. Title, editor, categories box, tags box,
featured image, Publish — or Save Draft.

**Here:** Payload again, the `posts` collection. Same fields you know, with two
differences: the editor stores a JSON tree rather than HTML, and drafts are a
versioning feature you opted into rather than a `post_status` that was always
there.

What [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
gives you, and the WordPress box it replaces:

| Field | Type | WordPress equivalent |
|---|---|---|
| `title` | text, required, max 200 | the title field |
| `slug` | text, unique, indexed, auto-derived | `post_name` / the permalink editor |
| `excerpt` | textarea, max 300 | the Excerpt box |
| `content` | richText (Lexical) | the editor — **JSON, not HTML** |
| `category` | relationship → `categories` | the Categories box (but see the gotcha) |
| `coverImage` | upload → `media` | Featured Image ✅ configured and used — every seeded guide has one |
| `tags` | array of `{ tag }` | the Tags box (but see the gotcha) |
| `publishedAt` | date, day-and-time picker | the Publish-immediately / schedule control |

**Steps — in the admin UI** ✅

1. Open <http://localhost:3000/admin/collections/posts/create>.
2. Fill **Title**. Leave **Slug** blank; the hook at
   [`Posts.ts:72-75`](../../apps/cms/src/collections/Posts.ts) derives it.
3. Fill **Excerpt** and **Content**. Pick a **Category** and add **Tags** in the
   sidebar and body respectively.
4. Save as a draft first, then publish it. Posts have
   `versions: { drafts: true, maxPerDoc: 10 }` at
   [`Posts.ts:171`](../../apps/cms/src/collections/Posts.ts), so the document
   carries a `_status` of `draft` or `published`.
5. Leave **Published At** empty. A `beforeChange` hook at
   [`Posts.ts:130-141`](../../apps/cms/src/collections/Posts.ts) stamps it the
   first time the post actually goes live.

**Steps — over the REST API** ✅

1. Export `KEY`.
2. `POST /api/posts`. Send `"_status": "published"` to publish in the same call;
   omit it to get a draft.

```bash
curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Hello from the REST API",
    "excerpt": "Created with curl, not the admin panel.",
    "category": 1,
    "tags": [{ "tag": "cookbook" }],
    "_status": "published"
  }' | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; print(d["id"], d["slug"], d["_status"], d["publishedAt"])'
```

```
68 hello-from-the-rest-api published 2026-10-04T08:57:57.522Z
```

You sent no `publishedAt`. The hook stamped it. Your id will differ, and — as in
§1.2 — a second run of the same `curl` is a `400`, because `posts.slug` is
unique too. Change the title to create another.

**Verify — and see what a draft does.** Create one without `_status`, then ask
for it twice, once anonymously and once with the key:

```bash
curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"title":"Draft recipe post"}' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["doc"]; print("created:", d["id"], d["slug"], d["_status"])'

curl -gs "http://localhost:3000/api/posts?where[slug][equals]=draft-recipe-post&depth=0" \
  | python3 -c 'import json,sys; print("anonymous totalDocs:", json.load(sys.stdin)["totalDocs"])'

curl -gs "http://localhost:3000/api/posts?where[slug][equals]=draft-recipe-post&depth=0" \
  -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("with key totalDocs:", d["totalDocs"], d["docs"][0]["_status"])'
```

```
created: 69 draft-recipe-post draft
anonymous totalDocs: 0
with key totalDocs: 1 draft
```

(If you already ran this once, the create line is a `400` on the duplicate slug
while the two reads still answer — the point of the block is the two reads.)

Note the status code you did *not* get. The anonymous call was a `200` with
nothing in it, not a `403`, because the `read` access function at
[`Posts.ts:41-49`](../../apps/cms/src/collections/Posts.ts) returns a **query**,
not a boolean — the draft was filtered out of the SQL rather than refused. For an
anonymous caller that post does not exist. That is `current_user_can()` and
`pre_get_posts` collapsed into one expression that cannot disagree with itself,
and it is the best idea in Payload to take back to your WordPress work.

⚠️ **`category` is singular, and `tags` are not a taxonomy.** WordPress gives a
post many categories and many tags out of the box, with term archives and term
meta for both and hierarchy for categories. Here `category` is **one** foreign
key ([`Posts.ts:93-100`](../../apps/cms/src/collections/Posts.ts)) and `tags` is a
repeater of plain strings — no term IDs, no `/tag/foo/` archive, no
`get_the_terms()`. If your information architecture is taxonomy-shaped,
WordPress is genuinely ahead and you should say so in the estimate.

⚠️ **`content` is JSON, not HTML.** There is no `the_content()`, and sending
`"content": "<p>hi</p>"` does not do what you want. The storefront builds a
minimal Lexical tree in `toLexical()`
([`lib/payload.ts`](../../apps/storefront/src/lib/payload.ts)) and walks it back
to HTML in [`lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts).

**Going deeper:**
[from-wordpress 03 §3.9 — access control returns a query](../from-wordpress/03-payload-for-acf-and-cpt.md),
and [learn 03 §3.6 — drafts](../learn/03-payload.md).

---

## 1.4 How to create a new post type

**In WordPress:** `register_post_type('testimonial', [...])` in a plugin or
`functions.php`, hooked to `init`, plus a separate ACF field group bound to it by
a location rule. Two definitions, two places. Flush rewrite rules and it is live.

**Here:** one file. A collection is `register_post_type` *and* the field group
*and* the permissions *and* the lifecycle hooks in a single object, because all
four have to agree. The cost is that you edit code and restart a server.

The minimal template is
[`apps/cms/src/collections/Categories.ts`](../../apps/cms/src/collections/Categories.ts) —
the smallest real collection in the repo, trimmed here to its shape:

```ts
// apps/cms/src/collections/Categories.ts
import type { CollectionConfig } from 'payload'
import { slugFrom } from '../hooks/slugify'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'slug', 'updatedAt'] },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'slug', type: 'text', unique: true, index: true,
      admin: { description: 'Left blank, this is derived from the name.' },
      hooks: { beforeValidate: [slugFrom('name')] } },
    { name: 'description', type: 'textarea' },
  ],
}
```

Its own header comment lists what those few dozen lines bought: `GET`/`POST`
`/api/categories`, `GET`/`PATCH`/`DELETE` `/api/categories/:id`,
`GET /api/categories/count`, a GraphQL schema and a full admin CRUD screen.
Compare `apps/commerce/src/api/`, where every one of those verbs is a file
someone wrote by hand.

**Steps** ✅

1. Copy that file to a new one — `apps/cms/src/collections/Testimonials.ts` —
   and change `slug`, the export name, `useAsTitle`, `defaultColumns` and the
   `fields` array. Keep `access` as it is until you have a reason not to.
2. Import it in
   [`apps/cms/src/payload.config.ts`](../../apps/cms/src/payload.config.ts),
   beside the five imports already at lines 8–12.
3. **Add it to the `collections` array** — line 42 today:

   ```bash
   grep -n "collections:" apps/cms/src/payload.config.ts
   ```

   ```
   42:  collections: [Users, Media, Categories, Posts, Pages],
   ```

   The file alone does nothing. This array is the registration, the way
   `register_post_type` only counts when `init` actually fires.
4. **Restart the CMS.** Stop `npm run dev:cms` (or `npm run dev`) and start it
   again.
5. First request after the restart applies the schema. Payload's dev adapter is
   configured with `push`, documented in the config itself:

   ```ts
   // apps/cms/src/payload.config.ts
   db: postgresAdapter({
     pool: { connectionString: process.env.DATABASE_URL || '' },
     /**
      * `push` (the default in dev) diffs the config against the live database and
      * applies the change automatically — that is why adding a field here needs
      * no migration command.
      *
      * For production you set `push: false` and use:
      *   npm run payload migrate:create
      *   npm run payload migrate
      */
   }),
   ```
6. Regenerate the types:
   `npm --prefix apps/cms run generate:types`.

**Verify** — the tables, and the route. Run these with *your* slug; here they run
against `categories`, which this exact loop produced, next to a slug that was
never registered:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep categories
curl -s -o /dev/null -w '/api/categories  -> %{http_code}\n' http://localhost:3000/api/categories
curl -s -o /dev/null -w '/api/testimonials -> %{http_code}\n' http://localhost:3000/api/testimonials
```

```
 public | categories                    | table | postgres
/api/categories  -> 200
/api/testimonials -> 404
```

A `404` on your new slug means one of three things, in order of likelihood: you
did not add it to the `collections` array, you did not restart, or the slug in
the file is not the slug in the URL.

Payload also stamps a sentinel row every time a dev push runs, so you can check
whether the schema in the database is older than the schema in your config:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c "select name, batch, updated_at from payload_migrations where batch = -1;"
```

```
 name | batch |         updated_at
------+-------+----------------------------
 dev  |    -1 | 2026-10-04 08:59:35.194+00
(1 row)
```

The timestamp is whenever *your* CMS last connected and pushed, so it moves on
every restart. `name = dev` and `batch = -1` are the stable part: that row says
"this schema was pushed, not migrated".

⚠️ **The config is not hot-reloaded. This is the one that bites.** Next's dev
server recompiles your TypeScript happily, so the file looks live — but the
schema push runs when Payload *connects*, not when a module changes. Edit a
collection, see no error, see no table, and conclude the code is wrong: it is
not, you just have the old Payload instance. **Restart.** In WordPress a
`register_post_type` edit is live on the next request, with no build and no
process to bounce. That is a real convenience you no longer have.

⚠️ **Removing a field or a collection is not symmetrical.** Dev push prompts
before anything destructive, and a prompt in a non-interactive terminal can take
the CMS process down with it. Add freely; delete deliberately, with the database
backed up (`npm run db:export`).

**Going deeper:**
[from-wordpress 03 §3.2 — a collection is `register_post_type` and the field group in one file](../from-wordpress/03-payload-for-acf-and-cpt.md),
and [learn 03 §3.3 — a collection, field by field](../learn/03-payload.md).
Lab 7 in [06-labs.md](../learn/06-labs.md) walks this loop end to end.

---

## 1.5 How to add a custom field to posts

**In WordPress:** ACF → Field Groups → add a field, pick a type, set the location
rule to `Post Type is equal to Post`. Save. The field is live immediately and the
value lands in `wp_postmeta` as two rows — the value and its `_field_key` twin.
Nothing touches the schema.

**Here:** you edit the `fields` array in the collection file and the field
becomes a **real Postgres column**, typed and constrained. There is no Custom
Fields screen and you cannot add one by clicking.

**Steps** ✅

1. `docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts'` —
   look at the columns *before*, so the diff is yours rather than mine.
2. Open [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
   and add an entry to `fields` (lines 56–123). For a reading-time estimate:

   ```ts
   // apps/cms/src/collections/Posts.ts — inside `fields`
   {
     name: 'readingTime',
     type: 'number',
     admin: {
       position: 'sidebar',
       description: 'Minutes. Shown in listings.',
     },
   },
   ```

   `admin.position: 'sidebar'` is the nearest thing to choosing a meta box
   context — the same option `slug`, `category`, `coverImage` and `publishedAt`
   already use.
3. **Restart the CMS** — §1.4 step 4, same reason.
4. `docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts'`
   again. A `reading_time | numeric` row appears. Note the name: Payload
   snake-cases camelCase field names on the way into SQL.
5. `npm --prefix apps/cms run generate:types` so your editor knows about it:

   ```bash
   npm --prefix apps/cms run generate:types
   ```

   ```
   > cms@1.0.0 generate:types
   > cross-env NODE_OPTIONS=--no-deprecation payload generate:types

   [17:02:46] INFO: Compiling TS types for Collections and Globals...
   ```

**Verify** — this is `\d posts` as it stands today, before any field you add.
Every column below is a line in the `fields` array, and the mapping is the whole
point:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts' | sed -n '4,14p'
```

```
 id             | integer                     |           | not null | nextval('posts_id_seq'::regclass)
 title          | character varying           |           |          |
 slug           | character varying           |           |          |
 excerpt        | character varying           |           |          |
 content        | jsonb                       |           |          |
 category_id    | integer                     |           |          |
 cover_image_id | integer                     |           |          |
 published_at   | timestamp(3) with time zone |           |          |
 updated_at     | timestamp(3) with time zone |           | not null | now()
 created_at     | timestamp(3) with time zone |           | not null | now()
 _status        | enum_posts_status           |           |          | 'draft'::enum_posts_status
```

Drop the `sed` and you also get the unique index on `slug` and two foreign keys,
`category_id → categories(id)` and `cover_image_id → media(id)`, both
`ON DELETE SET NULL`. WordPress does clean up a post's `postmeta` when the post
is deleted — but rows left behind by a removed ACF field, or by a plugin that
wrote meta and then left, are yours to find with SQL. Here the constraint is
declared once and the database enforces it.

### Field types, and the ACF field you already know

Every row in this table was checked against this database.

| ACF field | Payload `type` | What Postgres gets | Seen here as |
|---|---|---|---|
| Text | `text` | `character varying` | `posts.title` |
| Text Area | `textarea` | `character varying` | `posts.excerpt` |
| Number | `number` | `numeric` | `media.filesize` |
| Select / Radio / Button Group | `select` | a **real enum type** | `enum_posts_status`, `enum_site_settings_announcement_tone` |
| True / False | `checkbox` | `boolean` | `site_settings.announcement_enabled` |
| Date Time Picker | `date` | `timestamp(3) with time zone` | `posts.published_at` |
| WYSIWYG | `richText` | `jsonb` — a node tree, **not HTML** | `posts.content` |
| Post Object / Relationship | `relationship` | `integer` FK + index | `posts.category_id` |
| Image / File | `upload` | `integer` FK to `media` | `posts.cover_image_id` |
| Repeater | `array` | **its own table**, with `_order` | `posts_tags` |
| Group | `group` | flattened to prefixed columns | `announcement_enabled`, `announcement_message`, `announcement_tone` |
| Flexible Content | `blocks` | **one table per block type** | `pages_blocks_hero`, `..._prose`, `..._stats` |
| Gallery | `upload` with `hasMany: true` | a join table of media FKs | 📋 supported; not used here |
| Clone, Taxonomy, Google Map, oEmbed | *no direct equivalent* | — | model it yourself |

The repeater is the one that surprises ACF people. Your instinct says "it is
serialised somewhere" and it is not. Run
`docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts_tags'`
and you get a real table with `_order`, `_parent_id`, `id` and `tag` columns and
a cascading foreign key — the orphaned-`postmeta` problem solved at schema
level, with row order kept as data rather than as array position.

⚠️ **`required: true` is not always `NOT NULL`.** Look at the `\d posts` output
above: `title` is `required: true` in the config and the column is still
nullable, because a collection with drafts enabled must be allowed to hold an
incomplete draft. Compare `pages.title`, which *is* `not null` — Pages has no
drafts. Do not read the schema as the validation rules; Payload enforces
`required` in the application layer regardless.

⚠️ **Drafts mean the field lands in two tables.** Add `readingTime` to Posts and
you get `reading_time` on `posts` **and** `version_reading_time` on `_posts_v` —
which matters the moment you write raw SQL or clean up a half-finished rename.

⚠️ **In dev, `push` applies schema changes silently. In production they are
migrations.** The friendliness of this loop is a development-mode affordance. On
a live database you set `push: false` and run `migrate:create` / `migrate`, which
is a deploy step WordPress never asked you for.

**Going deeper:**
[from-wordpress 03 §3.3 — fields become columns, not `postmeta` rows](../from-wordpress/03-payload-for-acf-and-cpt.md),
and [learn 10 §10.2 — why arrays and blocks explode the table count](../learn/10-databases.md).

---

## 1.6 How to create a custom block, and reuse it

**In WordPress:** ACF **Flexible Content** — a layout with a name and some
sub-fields, rendered by a `get_template_part()` in a loop. (Not Gutenberg blocks.
Get this mapping right or you will spend a day hunting for a block editor that
does not exist.)

**Here:** two separate pieces in two separate services, and keeping them
separate is the design.

1. **The shape** — a block definition inside a `blocks` field in Payload. It is
   a *type* the editor may insert as many times as they like, in any order.
2. **The rendering** — a `case` in an Astro component. Payload never renders
   anything.

**Steps — the Payload half** ✅

1. Open [`apps/cms/src/collections/Pages.ts`](../../apps/cms/src/collections/Pages.ts).
   The `layout` field at lines 59–110 holds the three existing blocks:

   ```ts
   // apps/cms/src/collections/Pages.ts
   {
     name: 'layout',
     type: 'blocks',
     minRows: 1,
     labels: { singular: 'Section', plural: 'Sections' },
     admin: { description: 'Add, reorder and remove sections. Order here is order on the page.' },
     blocks: [
       { slug: 'hero', labels: { singular: 'Hero', plural: 'Heroes' }, fields: [
         { name: 'heading', type: 'text', required: true },
         { name: 'subheading', type: 'textarea' },
         { name: 'align', type: 'select', defaultValue: 'left', options: [ … ] },
       ] },
       { slug: 'prose', labels: { singular: 'Text', plural: 'Text sections' },
         fields: [{ name: 'body', type: 'richText' }] },
       { slug: 'stats', labels: { singular: 'Stat row', plural: 'Stat rows' }, fields: [
         // An array INSIDE a block — this nests one more table deep.
         { name: 'items', type: 'array', minRows: 1, maxRows: 4, fields: [ … ] },
       ] },
     ],
   }
   ```

2. Add a fourth object to that `blocks` array. It needs a `slug`, optional
   `labels` (what the editor sees in the picker) and a `fields` array that takes
   every field type from §1.5.
3. **Restart the CMS**, then `npm --prefix apps/cms run generate:types`. A new
   `pages_blocks_<slug>` table appears.

**Steps — the Astro half** ✅

4. Add the block to the hand-written union `PageBlock` in
   [`apps/storefront/src/lib/payload.ts`](../../apps/storefront/src/lib/payload.ts)
   (line 299 today):

   ```ts
   // apps/storefront/src/lib/payload.ts
   /** One entry per block type in the Pages `layout` field. */
   export type PageBlock =
     | { blockType: 'hero'; id?: string; heading: string; subheading?: string | null; align?: 'left' | 'center' }
     | { blockType: 'prose'; id?: string; body?: LexicalRoot | null }
     | { blockType: 'stats'; id?: string; items?: { id?: string; value: string; label: string }[] }
   ```

5. Add a `case` to the switch in
   [`apps/storefront/src/pages/pages/[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro):

   ```astro
   <!-- apps/storefront/src/pages/pages/[slug].astro -->
   {blocks.map((block) => {
     switch (block.blockType) {
       case 'hero':
         return (
           <section class:list={['block-hero', block.align]}>
             <h2>{block.heading}</h2>
             {block.subheading && <p class="lede">{block.subheading}</p>}
           </section>
         )

       case 'prose':
         // set:html is safe here only because lexicalToHtml escapes every
         // text node itself. Never pass raw CMS output to it.
         return <section class="block-prose prose" set:html={lexicalToHtml(block.body)} />

       case 'stats':
         return ( … )

       default:
         // An editor should see a hint, not a blank gap.
         return <div class="notice info"><p>Unhandled block type — add a case for it in this file.</p></div>
     }
   })}
   ```

   `blockType` is a discriminated union, so TypeScript narrows each branch and
   refuses to let you read `block.heading` inside the `'stats'` case.

**Verify** — one table per block type, and the document returning the slugs you
registered. Four tables, because the `stats` block's `items` array nests one
level deeper:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt pages_blocks*'
curl -gs "http://localhost:3000/api/pages?where[slug][equals]=pricing&depth=0" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["docs"][0]; print(d["slug"], [b["blockType"] for b in d["layout"]])'
```

```
                  List of relations
 Schema |           Name           | Type  |  Owner
--------+--------------------------+-------+----------
 public | pages_blocks_hero        | table | postgres
 public | pages_blocks_prose       | table | postgres
 public | pages_blocks_stats       | table | postgres
 public | pages_blocks_stats_items | table | postgres
(4 rows)

pricing ['hero', 'stats', 'hero']
```

Add a fourth block slug and re-run the first command: a fifth table is there
after the restart, and nothing else moved.

⚠️ **Adding a block in Payload breaks no build by itself.** The union in step 4
is hand-written, not imported from `payload-types.ts`, so nothing in the
storefront has heard of your new block until you widen that type yourself. Until
you do, the `default:` branch renders a visible "Unhandled block type" notice.
That beats WordPress's nearest equivalent — forgetting
`template-parts/flexible/section-whatever.php` and getting silence — but it is a
runtime fallback, not a compile-time one.

### "Reusable" means two different things — and only one is a block

Be precise about which you are asking for.

**(a) Reusable as a type — the same section N times, with different content.**
That is what a block already is. No work required:

```bash
curl -s -X PATCH http://localhost:3000/api/pages/3 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"layout":[
    {"blockType":"hero","heading":"Simple pricing","align":"center"},
    {"blockType":"stats","items":[{"value":"3","label":"services"}]},
    {"blockType":"hero","heading":"Still simple, further down","align":"left"}
  ]}' | python3 -c 'import json,sys; print([b["blockType"] for b in json.load(sys.stdin)["doc"]["layout"]])'

docker exec apm-postgres psql -U postgres -d payload_crud \
  -c "select _parent_id, _order, _path, heading, align from pages_blocks_hero order by _parent_id, _order;"
```

```
['hero', 'stats', 'hero']
 _parent_id | _order | _path  |           heading            | align
------------+--------+--------+------------------------------+--------
          1 |      1 | layout | Three services, one frontend | center
          3 |      1 | layout | Simple pricing               | center
          3 |      3 | layout | Still simple, further down   | left
(3 rows)
```

Look at `_order` on the `pricing` page — id `3` here, whatever the create in
§1.2 returned for you: **1 and 3**, with 2 missing. The stats block holds
position 2 in a different table. Order is kept as data across all the block
tables, which is the `_order` column doing the job ACF's array index does inside
a serialised blob.

**(b) Reusable as content — one piece edited once, shown on every page.** That is
your WordPress **Reusable Block** — renamed a **synced pattern** in WordPress
6.3, still the `wp_block` post type — or an ACF options page field you echo in
the footer. A Payload block is **not** this. Two heroes on two
pages are two independent rows; editing one does nothing to the other. For that,
the answer is a **global** — §1.7.

⚠️ **There is no visual preview.** The admin shows you a form, not the page.
`@payloadcms/live-preview-react` 3.90.2 exists on npm and would narrow the gap,
but 📋 nothing here is configured for it —
[`payload.config.ts:103`](../../apps/cms/src/payload.config.ts) is literally
`plugins: []`. Elementor wins decisively on speed-to-first-page and editor
independence; blocks win on markup control, page weight, and being able to ask
the database a question about a section.

**Going deeper:**
[from-wordpress 03 §3.4 — blocks versus Elementor, with the comparison table](../from-wordpress/03-payload-for-acf-and-cpt.md),
and [02 §2.6](02-frontend.md#26-widget-part-one-a-reusable-block-an-editor-can-edit)
for the rendering half.

---

## 1.7 How to share one piece of content across every page

**In WordPress:** a synced pattern (a Reusable Block), a widget area if you are
on a classic theme, or `acf_add_options_page()` plus `get_field('x', 'option')`
in the footer template.

**Here:** a **global** — a collection with exactly one record. No list view, no
create, no delete, one edit screen.
[`apps/cms/src/globals/SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts)
is the live example, and it is already on every storefront page.

**Steps** ✅

1. Read the existing one first:
   <http://localhost:3000/admin/globals/site-settings>.
2. For a new one, create a file in `apps/cms/src/globals/` exporting a
   `GlobalConfig` — same `fields` array as a collection, no `access.create` or
   `access.delete` because there is nothing to create or delete:

   ```ts
   // apps/cms/src/globals/SiteSettings.ts
   export const SiteSettings: GlobalConfig = {
     slug: 'site-settings',
     label: 'Site settings',
     access: {
       // Public: the storefront renders these on every page.
       read: () => true,
       update: ({ req }) => Boolean(req.user),
     },
     fields: [
       { name: 'siteName', type: 'text', required: true, defaultValue: 'Astro · Payload · Medusa' },
       { name: 'tagline', type: 'text', defaultValue: 'A teaching stack you can read.' },
       { name: 'announcement', type: 'group', fields: [ … ] },
       { name: 'socialLinks', type: 'array', fields: [ … ] },
     ],
   }
   ```

3. Register it in the `globals` array in
   [`payload.config.ts:57`](../../apps/cms/src/payload.config.ts) — not
   `collections`.
4. Restart, regenerate types, then read it from Astro. The storefront already
   does, in `getSiteSettings()` at
   [`apps/storefront/src/lib/payload.ts:294`](../../apps/storefront/src/lib/payload.ts),
   called from
   [`apps/storefront/src/layouts/Layout.astro:39`](../../apps/storefront/src/layouts/Layout.astro).

**Verify** — one HTTP call and its one row:

```bash
curl -s http://localhost:3000/api/globals/site-settings \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["siteName"]); print(d["announcement"]); print([(l["label"], l["url"]) for l in d["socialLinks"]])'
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d site_settings' | sed -n '7,9p'
```

```
Astro · Payload · Medusa
{'enabled': True, 'message': 'This banner comes from a Payload global — one record, read on every page.', 'tone': 'info'}
[('Course', '/schema')]
 announcement_enabled | boolean                              |           |          | false
 announcement_message | character varying                    |           |          |
 announcement_tone    | enum_site_settings_announcement_tone |           |          | 'info'::enum_site_settings_announcement_tone
```

Flip `announcement.enabled` in the admin and the banner changes on every page of
the storefront, from one edit. That is the Reusable Block behaviour you wanted.
Notice the `group` field is nested in the JSON and **flat** in SQL —
`announcement_*` — exactly as ACF's group field behaves in `postmeta`. The verbs
differ too: a global is **GET and POST only**, because there is nothing to create
and nothing to delete.

⚠️ **A `wp_options` read was in-process; a global is an HTTP request.**
`Layout.astro` fetches this on **every** storefront page render, where WordPress
served the same data from the connection it already had. The rendering side, the
`try`/`catch` that keeps a failing global from taking down every page, and what
the round trip costs are in
[02 §2.6](02-frontend.md#26-widget-part-one-a-reusable-block-an-editor-can-edit);
why there is no caching plugin to fix it is
[05 §5.7](05-plugins.md#57-how-to-cache--and-why-there-is-no-caching-plugin).

**Reach for a global when** there is exactly one of the thing. **Avoid one when**
you can imagine a second — that is a collection.

**Going deeper:**
[from-wordpress 03 §3.5 — a global is an ACF options page with a real table](../from-wordpress/03-payload-for-acf-and-cpt.md).

---

## 1.8 Everything registered today

Five collections and one global, as of this writing. This is the complete content
model — there is nothing hidden in a plugin, because
[`payload.config.ts:103`](../../apps/cms/src/payload.config.ts) is `plugins: []`.

| Slug | Kind | File | Drafts | Notable fields | Rows |
|---|---|---|---|---|---|
| `users` | collection (auth) | [`Users.ts`](../../apps/cms/src/collections/Users.ts) | — | `name`, `role` (select admin\|editor); `auth: { useAPIKey: true }` | 1 |
| `media` | collection (upload) | [`Media.ts`](../../apps/cms/src/collections/Media.ts) | — | `alt` (required); sizes `thumbnail` 400×300, `card` 768×512 | **0** 📋 |
| `categories` | collection | [`Categories.ts`](../../apps/cms/src/collections/Categories.ts) | — | `name`, `slug` (unique), `description` | 3 |
| `posts` | collection | [`Posts.ts`](../../apps/cms/src/collections/Posts.ts) | ✅ `maxPerDoc: 10` | `title`, `slug`, `excerpt`, `content` (richText), `category` (rel), `coverImage` (upload), `tags` (array), `publishedAt` | 11 |
| `pages` | collection | [`Pages.ts`](../../apps/cms/src/collections/Pages.ts) | 🚫 deliberately off | `title`, `slug`, `layout` (blocks: `hero`, `prose`, `stats`) | 2 |
| `site-settings` | **global** | [`SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts) | — | `siteName`, `tagline`, `announcement` (group), `socialLinks` (array) | 1 |

Post counts move as you and the labs create things — treat that column as a
snapshot, not a constant. The shape does not move.

Those six definitions become **21 tables**, which the repo counts for you:

```bash
curl -s http://localhost:3000/api/schema -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["tableCount"], d["byKind"])'
```

```
21 {'versions': 2, 'collection': 10, 'internal': 6, 'sub-table': 2, 'auth': 1}
```

Six are Payload's own bookkeeping; the rest are yours, multiplied by arrays,
blocks and versions. Compare WordPress, where `wp_posts` and `wp_postmeta` hold
every post type and every custom field forever — genuinely simpler to reason
about, and genuinely harder to query.

### What is **not** here, said plainly

| You expect | Status | What to do instead |
|---|---|---|
| Taxonomies, term archives, term meta | 🚫 no concept | a collection + a `relationship`, and your own Astro route |
| Comments | 🚫 | a collection you design |
| Shortcodes | 🚫 | a block, or a custom Lexical node |
| Reusable Blocks / synced patterns (`wp_block`) | 🚫 as blocks | a **global** — §1.7 |
| Multiple categories per post | 🚫 as configured | `hasMany: true` on the relationship field |
| Parent/child pages, breadcrumbs | 📋 `@payloadcms/plugin-nested-docs` 3.90.2 exists; not installed | install it, or a self-relationship |
| SEO fields on posts | 📋 `@payloadcms/plugin-seo` 3.90.2 exists; not installed | [05 §5.6](05-plugins.md#56-how-to-do-seo-with-no-plugin-at-all) |
| Translations (WPML) | 📋 Payload `localization` exists; not configured | [05 §5.9](05-plugins.md#59-how-to-go-multilingual--the-wpml-question) |
| A visual page builder | 🚫 | blocks plus an Astro component — §1.6 |
| Tabs, polymorphic relationships, `join` fields | 📋 supported by Payload; unused here | read Payload's docs, not this repo |

⚠️ **The 📋 plugin versions above are npm's current latest, not this repo's.**
`apps/cms/package.json` pins Payload at `3.88.0`; the official plugins are on
`3.90.2` today. Install one and match the major version, then expect npm to want
to pull the rest of `@payloadcms/*` forward with it. None of them are in
`apps/cms/node_modules` right now — `plugins: []` is literal.

---

## Check yourself

1. You create a `pages` document with the slug `pricing` and nothing appears at
   `/pages/pricing`. Name the two independent things that must both be true, and
   which service owns each.
2. An ACF repeater with four rows and three sub-fields costs 26 `postmeta` rows.
   What does a Payload `array` field with four rows cost, and what is `_order`
   for?
3. `posts.title` is `required: true` and the column is nullable. `pages.title` is
   `required: true` and the column is `not null`. Why the difference?
4. You add a field to `Posts.ts`, save, and `\d posts` shows nothing new. Give
   the three things to check, in order.
5. Your client wants the same "Book a demo" panel on eleven pages, edited once.
   Is that a block or a global, and what breaks if you choose the other one?
6. The anonymous caller asking for a draft post gets `200` with zero documents,
   not `403`. Which function makes that happen, and what does it return?
7. You add a `testimonial` block in Payload and deploy before touching the
   storefront. What does a visitor see, and which branch of which file decides
   that?

---

**Next:** [02-frontend.md](02-frontend.md) — the other half of "create a page":
Astro routing, the posts archive, the single post page, and where the template
hierarchy went.
