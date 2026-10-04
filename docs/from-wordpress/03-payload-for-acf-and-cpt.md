# 3 · Payload — if you know ACF and custom post types

> Counterpart in the main course: [03 · Payload](../learn/03-payload.md). That
> chapter teaches Payload on its own terms; this one teaches it in yours.

This is where the stack should start feeling familiar. If you have shipped ACF Pro
on fifteen sites you already hold most of the ideas Payload is built from: field
groups, field types, repeaters, flexible content, options pages, relationship
pickers. What changes is **where those definitions live and what they become**.

In WordPress a field group is a row in `wp_posts` with post type
`acf-field-group`, edited through a UI and mirrored to JSON by ACF's Local JSON
once an `acf-json/` directory exists. In Payload it is a TypeScript file, that
file is the only definition there is, and it compiles to real SQL columns.

**One sentence:** ACF describes a form over `wp_postmeta`; Payload describes a
schema, and the form, the REST API, the GraphQL API, the admin screens and the
TypeScript types all fall out of it.

Log in first — **http://localhost:3000/admin**, `admin@local.test` /
`supersecret`. Then:

```bash
curl -s 'http://localhost:3000/api/categories?limit=3&depth=0' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["totalDocs"], [c["slug"] for c in d["docs"]])'
```

```
3 ['release-notes', 'tutorials', 'architecture']
```

Nobody wrote that endpoint.

---

## 3.1 Almost everything on your ACF toolbar has a name here

| WordPress / ACF | Payload here | Label |
|---|---|---|
| `register_post_type()` | a file in [`apps/cms/src/collections/`](../../apps/cms/src/collections/) | ✅ |
| ACF field group | the `fields` array in that same file | ✅ |
| ACF Repeater | `type: 'array'` | ✅ |
| ACF Flexible Content | `type: 'blocks'` | ✅ |
| ACF Options Page | a **global**, [`SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts) | ✅ |
| ACF Relationship / Post Object | `type: 'relationship'` | ✅ |
| ACF Image, Media Library | `type: 'upload'` → the `media` collection | ✅ configured, 📋 unused |
| `add_action` / `add_filter` | collection and field `hooks` | ✅ |
| `current_user_can()` | per-operation `access` functions | ✅ |
| Revisions, draft status | `versions: { drafts: true }` | ✅ |
| `WP_Query` | the **Local API**, `payload.find()` | ✅ |
| `wp-json` | REST at `/api/<slug>` | ✅ |
| `register_rest_route()` | `endpoints` on a collection or the config | ✅ |
| Meta boxes, Gutenberg sidebar panels | `admin: { components: … }` | 📋 not used here |
| WPML / Polylang | Payload `localization` | 📋 not configured |
| Gutenberg, Elementor | *no equivalent* — §3.4 | — |
| Taxonomies, comments, shortcodes | *no equivalent* — §3.15 | 🚫 |

Three rows are the whole chapter: **fields become columns** (§3.3), **blocks are
Flexible Content** (§3.4), **access control returns a query** (§3.9).

⚠️ **Nothing here corresponds to a plugin.** `plugins: []` in
[`payload.config.ts`](../../apps/cms/src/payload.config.ts) is literally empty and
every behaviour is in a file you can open. That is a loss as well as a gain:
WordPress's plugin economy lets you buy a solved problem in an afternoon, and here
you cannot.

---

## 3.2 A collection is `register_post_type` and the field group in one file

**WordPress:** `register_post_type()` in a plugin, plus a separate ACF field group
bound to it by a location rule. Two definitions, two places, joined by a
condition.

**What it is, and why it exists** — Payload collapses the two. One object declares
the post type *and* its fields *and* its permissions *and* its lifecycle hooks,
because all four have to agree and keeping them in separate systems is how they
drift. The config is not a description of the application; it **is** the
application.

**Simple** — `{ slug: 'categories', fields: [{ name: 'name', type: 'text' }] }`
is a complete collection.

**Real** — [`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts),
trimmed to its shape:

```ts
// apps/cms/src/collections/Posts.ts
export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'category', '_status', 'publishedAt', 'updatedAt'],
    listSearchableFields: ['title', 'excerpt'],
  },
  access: { … },                               // §3.9
  fields: [ … ],                               // §3.3
  hooks: { … },                                // §3.8
  versions: { drafts: true, maxPerDoc: 10 },   // §3.10
  endpoints: [postStats],                      // §3.13
  timestamps: true,
}
```

`defaultColumns` is `manage_posts_columns` plus `manage_posts_custom_column`, as
data; `listSearchableFields` is the `posts_search` filter you would otherwise
hand-write to widen the admin list search. Neither needs a callback, because
neither is a hook. Five
collections exist — `Users`, `Media`, `Categories`, `Posts`, `Pages` — and
registering one is the whole cost of a REST resource
([03 §3.3](../learn/03-payload.md) lists the routes it generates).

**Reach for a collection when** there can be more than one of the thing. **Avoid
it when** there is exactly one — that is a global (§3.5).

**The WordPress habit that misfires:** reaching for a UI. There is no Custom
Fields screen, you cannot add a field by clicking, and that is the point — the
change arrives in git with a diff, a blame line and a review. The flip side is
honest: a WordPress owner can add a field themselves at 11pm; here they file a
ticket.

---

## 3.3 Fields become columns and sub-tables, not `postmeta` rows

**WordPress:** every ACF value is a row in `wp_postmeta` — `meta_key`,
`meta_value LONGTEXT` — plus a second row keyed `_<name>` holding the field key
(`field_abc123`). Everything is a string, and a repeater with four rows and three
sub-fields costs 26 rows: 4 × 3 values, each with its key row, plus two for the
repeater count itself.

**What it is, and why it exists** — Payload runs Drizzle against Postgres, so a
field declaration is a column declaration. `type: 'date'` is a `timestamptz`, not
a string you parse; `type: 'select'` is a Postgres enum, so a typo cannot be
stored; `unique` is an index the database enforces rather than whichever code
path remembered to check. `required` becomes `NOT NULL` — with one exception
worth knowing before you read the output below: on a collection with drafts
enabled Payload leaves the column nullable, because a draft is allowed to be
incomplete. `media.alt` and `pages.title` are `not null`; `posts.title` is not,
and it is `required: true` all the same.

WordPress made the opposite trade deliberately. `postmeta` means adding a field
never touches the schema, never needs a migration and never locks a table.
Payload's answer is faster and stricter and costs you a schema change every time.

**Simple** — `{ name: 'publishedAt', type: 'date' }`.

**Real** — the field list in [`Posts.ts`](../../apps/cms/src/collections/Posts.ts):

```ts
// apps/cms/src/collections/Posts.ts
{ name: 'title', type: 'text', required: true, maxLength: 200 },
{ name: 'slug', type: 'text', unique: true, index: true, hooks: { … } },
{ name: 'excerpt', type: 'textarea', maxLength: 300 },
{ name: 'content', type: 'richText' },
{ name: 'category', type: 'relationship', relationTo: 'categories' },
{ name: 'coverImage', type: 'upload', relationTo: 'media' },
{
  name: 'tags',
  type: 'array',
  fields: [{ name: 'tag', type: 'text', required: true }],
  // An `array` field becomes its OWN Postgres table (posts_tags) with a
  // parent FK and an order column. Worth knowing when you write raw SQL.
},
{ name: 'publishedAt', type: 'date', … },
```

What that produced:

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

Drop the `sed` to see the rest: a unique index on `slug`, and two foreign keys,
`category_id → categories(id)` and `cover_image_id → media(id)`, both
`ON DELETE SET NULL`.

The ACF translation table, every row verified against this database:

| ACF field | Payload field | Postgres result here |
|---|---|---|
| Text | `text` | `character varying` |
| Text Area | `textarea` | `character varying` |
| Select / Radio | `select` | a real enum — `enum_posts_status`, `enum_users_role` |
| True / False | `checkbox` | `boolean` — `announcement_enabled` |
| Number | `number` | `numeric` — `media.filesize` |
| Date Time Picker | `date` | `timestamp(3) with time zone` |
| WYSIWYG | `richText` | `jsonb` — a node tree, **not HTML** |
| Post Object / Relationship | `relationship` | `integer` FK + index — `category_id` |
| Image / File | `upload` | `integer` FK to `media` — `cover_image_id` |
| Repeater | `array` | **its own table** — `posts_tags` |
| Group | `group` | flattened to prefixed columns — `announcement_*` |
| Flexible Content | `blocks` | **one table per block type** — §3.4 |
| Clone, Gallery, Taxonomy, Google Map | *no direct equivalent* | model it yourself |

The repeater is the one that surprises people — your ACF instinct says "it is
serialised somewhere", and it is not:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts_tags' | head -7
```

```
                    Table "public.posts_tags"
   Column   |       Type        | Collation | Nullable | Default
------------+-------------------+-----------+----------+---------
 _order     | integer           |           | not null |
 _parent_id | integer           |           | not null |
 id         | character varying |           | not null |
 tag        | character varying |           |          |
```

`_order` keeps repeater row order as data rather than array position, and the FK
below it is `ON DELETE CASCADE` — the orphaned-postmeta problem solved at schema
level. You have cleaned up orphaned meta with a WP-CLI one-liner; here the
database does it.

### Five collections, twenty-one tables

This repo introspects its own schema through a root endpoint that needs a user:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s http://localhost:3000/api/schema -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["tableCount"], d["byKind"]); print(d["collections"]["yours"])'
```

```
21 {'versions': 2, 'collection': 10, 'internal': 6, 'sub-table': 2, 'auth': 1}
['users', 'media', 'categories', 'posts', 'pages']
```

Five collections and one global became **21 tables**: six are Payload's own
bookkeeping, fifteen are yours, expanded by arrays, blocks and versions.
[10-databases.md](../learn/10-databases.md) walks all of them. Compare WordPress,
where `wp_posts` and `wp_postmeta` hold every post type and every custom field
forever, however many field groups you add — genuinely simpler to reason about and
genuinely harder to query. The `meta_query` joins you have hand-written are the
price of it.

**Reach for a typed field when** the value has a shape worth enforcing. **Avoid
adding fields casually** — in dev `push` applies schema changes silently; in
production they are migrations, with edges in
[07-troubleshooting.md](../learn/07-troubleshooting.md).

⚠️ **`richText` is JSON, not HTML.** There is no `the_content()`. The storefront
walks the node tree itself in
[`apps/storefront/src/lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts).
If you expected to echo a string, that is the WordPress habit to unlearn first.

---

## 3.4 Blocks are ACF Flexible Content — not Gutenberg, not Elementor

**WordPress:** ACF **Flexible Content**. Not the block editor. Get this mapping
right and the section is obvious; get it wrong and you will hunt for features that
do not exist.

**What it is, and why it exists** — a `blocks` field offers the editor a menu of
typed sections to assemble in any order, any number of times. Each block type has
known fields, so the frontend renders it as a real component instead of guessing.
The editor controls layout, you control markup — precisely the Flexible Content
bargain.

**Simple** — `{ name: 'layout', type: 'blocks', blocks: [{ slug: 'hero', fields: [ … ] }] }`.

**Real** — [`apps/cms/src/collections/Pages.ts`](../../apps/cms/src/collections/Pages.ts)
defines exactly three block types:

```ts
// apps/cms/src/collections/Pages.ts
{ name: 'layout', type: 'blocks', minRows: 1, blocks: [
  { slug: 'hero', fields: [
    { name: 'heading', type: 'text', required: true },
    { name: 'subheading', type: 'textarea' },
    { name: 'align', type: 'select', defaultValue: 'left', options: [ … ] },
  ] },
  { slug: 'prose', fields: [{ name: 'body', type: 'richText' }] },
  { slug: 'stats', fields: [
    { name: 'items', type: 'array', minRows: 1, maxRows: 4,
      // An array INSIDE a block — this nests one more table deep.
      fields: [
        { name: 'value', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
      ] },
  ] },
] }
```

One field, four tables, and a seeded page that really uses three of them:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep pages
curl -s 'http://localhost:3000/api/pages?limit=1&depth=0' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin)["docs"][0]; print([b["blockType"] for b in d["layout"]])'
```

```
 public | pages                         | table | postgres
 public | pages_blocks_hero             | table | postgres
 public | pages_blocks_prose            | table | postgres
 public | pages_blocks_stats            | table | postgres
 public | pages_blocks_stats_items      | table | postgres
['hero', 'stats', 'prose']
```

### The honest comparison with Elementor

You have Elementor on seventeen sites. Elementor is not this, and pretending
otherwise would waste your time.

| | Elementor | Payload blocks |
|---|---|---|
| Who composes | editor, visual canvas | editor, a form list |
| Who writes the markup | Elementor's widgets | **you**, in a component |
| What is stored | one JSON blob in `postmeta` | typed rows across block tables |
| Preview | WYSIWYG, pixel-accurate | the admin shows fields, not the page |
| New section type | pick a widget, now | a dev adds a block and a render branch |
| Markup you did not design | possible | **impossible** |
| Query a section in SQL | parse the blob | `select * from pages_blocks_stats` |

Elementor wins decisively on speed-to-first-page and editor independence. Blocks
win on markup control, page weight, and being able to ask the database a question
about your content.

The rendering lives in Astro, not Payload —
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
      return (
        /*
         * set:html is safe here only because lexicalToHtml escapes every
         * text node itself. Never pass raw CMS output to it.
         */
        <section class="block-prose prose" set:html={lexicalToHtml(block.body)} />
      )

    case 'stats':
      return ( … )

    default:
      /*
       * Unreachable while the union is exhaustive — but if someone adds a
       * block type in Payload and deploys before updating this file, an
       * editor should see a hint rather than a blank gap.
       */
      return (
        <div class="notice info">
          <p>Unhandled block type — add a case for it in this file.</p>
        </div>
      )
  }
})}
```

`blockType` is a discriminated union, so TypeScript narrows each branch and
refuses to let you read `block.heading` inside the `'stats'` case. Be precise
about where that guarantee stops, though, because it is easy to oversell: the
union is **hand-written**, in
[`apps/storefront/src/lib/payload.ts`](../../apps/storefront/src/lib/payload.ts)
(`PageBlock`, line 299), for the reasons §3.11 sets out. Adding a block type in
Payload therefore breaks no build by itself — nothing in the storefront has heard
of it yet. You widen `PageBlock` by hand, and *that* edit is what `tsc` checks
against the switch. Until you do, the `default:` branch above renders a visible
"Unhandled block type" notice. That is better than WordPress's nearest
equivalent — forgetting `template-parts/flexible/section-whatever.php` and
getting silence — but it is a runtime fallback, not a compile-time one. How Astro
renders all this is [05-astro.md](../learn/05-astro.md); this chapter stops at the
Payload boundary. See it running at
**http://localhost:4321/pages/about-this-stack**.

**Reach for blocks when** editors need layout freedom and you need markup control.
**Avoid them when** the page shape is fixed — ordinary fields are cheaper on disk
and simpler to query.

**Mistakes:** expecting a visual preview, and underestimating disk cost. Blocks
multiply tables and drafts would double them again, which is why
[`Pages.ts`](../../apps/cms/src/collections/Pages.ts) deliberately has no versions
and says so in a comment — [10-databases.md](../learn/10-databases.md) §10.2.

---

## 3.5 A global is an ACF options page with a real table

**WordPress:** `acf_add_options_page()`, values landing in `wp_options` as
`options_<name>` rows — autoload off unless you turn ACF's `autoload` setting on
— read with `get_field('x', 'option')`.

**What it is, and why it exists** — some things are singular: site settings, a
footer, a banner. Modelling them as a collection means defending against "what if
there are two?" forever. A global is one record, one edit screen, no list view, no
create, no delete.

**Simple** — `export const SiteSettings: GlobalConfig = { slug: 'site-settings', fields: [ … ] }`.

**Real** — [`apps/cms/src/globals/SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts):

```ts
// apps/cms/src/globals/SiteSettings.ts
access: {
  // Public: the storefront renders these on every page.
  read: () => true,
  update: ({ req }) => Boolean(req.user),
},
fields: [
  { name: 'siteName', type: 'text', required: true, defaultValue: 'Astro · Payload · Medusa' },
  { name: 'tagline', type: 'text', defaultValue: 'A teaching stack you can read.' },
  { name: 'announcement', type: 'group', fields: [
    { name: 'enabled', type: 'checkbox', defaultValue: false },
    { name: 'message', type: 'text' },
    { name: 'tone', type: 'select', defaultValue: 'info', options: [ … ] },
  ] },
  { name: 'socialLinks', type: 'array', fields: [ … ] },
]
```

```bash
curl -s http://localhost:3000/api/globals/site-settings \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["siteName"]); print(d["announcement"]); print(d["socialLinks"])'
```

```
Astro · Payload · Medusa
{'enabled': True, 'message': 'This banner comes from a Payload global — one record, read on every page.', 'tone': 'info'}
[{'id': '6aa0dc110ef9392db171496c', 'label': 'Course', 'url': '/schema'}]
```

The `group` field is nested in JSON and flat in SQL — `announcement_enabled`,
`announcement_message`, `announcement_tone` are three columns on `site_settings`.
ACF's group field behaves the same way in `postmeta`, so this one should feel
natural.

| | ACF options page | Payload global |
|---|---|---|
| Storage | `wp_options`, one row per field | its own table, one row |
| Read | `get_field('x', 'option')` | `GET /api/globals/site-settings` |
| Verbs | n/a | **GET and POST only** — nothing to create or delete |
| Empty state | `null` until saved | Payload returns field defaults |

**Reach for a global when** there is exactly one. **Avoid one when** you can
imagine a second.

⚠️ **A `wp_options` read is in-process; a global is an HTTP request.**
`Layout.astro` reads this on **every** storefront page render — a Payload round
trip per page. WordPress served the same data from the database connection it
already had, often from the object cache. Caching it is the first optimisation
this stack needs ([09 §9.6](../learn/09-to-production.md)).

---

## 3.6 Relationships are foreign keys, and `depth` is your third argument

**WordPress:** ACF Relationship or Post Object. The stored value is a post ID;
whether `get_field()` hands you that ID or a `WP_Post` depends on the field's
Return Format setting, and `$format_value = false` always gives you the raw ID.

**What it is, and why it exists** — a `relationship` field is a real foreign key
with a real index. The API returns the ID by default and expands on request,
because expanding relationships nobody renders is the quiet performance bug in
every headless CMS.

**Simple** — `{ name: 'category', type: 'relationship', relationTo: 'categories' }`.

**Real** — that is the only relationship field in the repo, in
[`Posts.ts`](../../apps/cms/src/collections/Posts.ts), with its comment intact:

```ts
// apps/cms/src/collections/Posts.ts
{
  name: 'category',
  type: 'relationship',
  relationTo: 'categories',
  admin: { position: 'sidebar' },
  // Returned as an ID by default; `?depth=1` on the request replaces it
  // with the full category document.
}
```

```bash
curl -gs 'http://localhost:3000/api/posts?limit=1&depth=0&sort=id' \
  | python3 -c 'import json,sys; print("depth=0 ->", json.load(sys.stdin)["docs"][0]["category"])'
curl -gs 'http://localhost:3000/api/posts?limit=1&depth=1&sort=id' \
  | python3 -c 'import json,sys; c=json.load(sys.stdin)["docs"][0]["category"]; print("depth=1 ->", {k:c[k] for k in ("id","name","slug")})'
```

```
depth=0 -> 1
depth=1 -> {'id': 1, 'name': 'Architecture', 'slug': 'architecture'}
```

`depth` is per request, not per field — `depth=2` expands relationships *inside*
the expanded documents. The parameter table is in
[03 §3.10](../learn/03-payload.md).

**Reach for a relationship when** the other side is a document. **Avoid `depth`
above 1** unless you are rendering the tree you asked for.

**What is missing, said plainly:** there are **no taxonomies**. `Categories` is an
ordinary collection joined by an ordinary FK. WordPress's taxonomy system —
`wp_terms`, `wp_term_taxonomy`, `wp_term_relationships`, hierarchy, term meta,
free archive routes — has no counterpart. You would build hierarchy with a
self-relationship and archives with an Astro route, and for a site whose
information architecture is taxonomy-shaped WordPress is simply ahead.

**Mistakes:** forgetting `-g` on curl, which makes `[` and `]` a glob range and
fails with `bad range in URL position`; and assuming the richer relationship forms
are configured. Payload supports polymorphic `relationTo: ['posts','pages']` and
`join` fields — 📋 neither is used here.

---

## 3.7 The Media Library exists, is configured, and is empty

**WordPress:** `attachment` rows in `wp_posts`, files under
`wp-content/uploads/2026/10/`, and the sizes `add_image_size()` generates on
upload.

**What it is, and why it exists** — `upload: {...}` turns an ordinary collection
into a file store. Payload adds `filename`, `mimeType`, `filesize`, `width`,
`height`, `url` and a `sizes` object automatically, generating each named size
with `sharp` at upload time. Same idea as `add_image_size()`, same `srcset`
payoff, declared in the same place as everything else.

**Simple** — `upload: { staticDir: 'public/media', imageSizes: [ … ] }`.

**Real** — [`apps/cms/src/collections/Media.ts`](../../apps/cms/src/collections/Media.ts):

```ts
// apps/cms/src/collections/Media.ts
upload: {
  staticDir: 'public/media',
  mimeTypes: ['image/*'],
  imageSizes: [
    { name: 'thumbnail', width: 400, height: 300, position: 'centre' },
    { name: 'card', width: 768, height: 512, position: 'centre' },
  ],
},
fields: [
  { name: 'alt', type: 'text', required: true, admin: { description: 'Describe the image for screen readers. Required on purpose.' } },
],
```

Two things WordPress does not do: alt text is `NOT NULL` at database level, and
the size list is in git rather than a `functions.php` that can be edited on the
live server. The generated columns exist already:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d media' | sed -n '12,19p'
```

```
 filesize                  | numeric                     |           |          |
 width                     | numeric                     |           |          |
 height                    | numeric                     |           |          |
 focal_x                   | numeric                     |           |          |
 focal_y                   | numeric                     |           |          |
 sizes_thumbnail_url       | character varying           |           |          |
 sizes_thumbnail_width     | numeric                     |           |          |
 sizes_thumbnail_height    | numeric                     |           |          |
```

**And now you can watch it run.** ✅ The seed generates a cover image per guide
and uploads it through the Local API, so the pipeline above is exercised rather
than merely described:

```bash
ls -A apps/cms/public/media | wc -l
curl -s -H "Authorization: users API-Key $KEY" 'http://localhost:3000/api/media?limit=5' \
  | python3 -c 'import json,sys; print("media docs:", json.load(sys.stdin)["totalDocs"])'
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c 'select id, slug, cover_image_id from posts order by id limit 4;'
```

```
96
media docs: 32
 id  |                           slug                           | cover_image_id
-----+----------------------------------------------------------+----------------
 135 | what-is-the-wp-configphp-equivalent-in-this-stack         |            129
 136 | the-file-structure-of-a-payload-medusa-and-astro-project  |            130
 137 | the-terminal-commands-worth-memorising                    |            131
 138 | what-is-seeding-and-when-should-you-use-it                |            132
(4 rows)
```

**96 files for 32 documents** — the original plus the two derivatives sharp
generates from `imageSizes`. That ratio is the whole upload pipeline in one
number: you uploaded 32 things and Payload wrote 96.

The generator is [`apps/cms/src/scripts/placeholders.ts`](../../apps/cms/src/scripts/placeholders.ts),
which draws an SVG and rasterises it, and the upload itself is one Local API
call taking a `file` argument rather than a path:

```ts
// apps/cms/src/scripts/seed.ts
const media = await payload.create({
  collection: 'media',
  data: { alt: `Cover image for “${guide.title}”` },
  file: { data: png, mimetype: 'image/png', name: coverFilename(slug), size: png.length },
})
```

⚠️ **Deleting the document deletes the file; dropping the database does not.**
`npm run db:reset` wipes the Docker volume, and `apps/cms/public/media` is on
your disk, so the files survive with nothing pointing at them. Payload refuses to
overwrite a filename and appends `-1`, then `-2` — so a directory that doubles
on every reset, and documents pointing at `…-cover-3.png`, is this and not a bug
in the upload field. The seed clears the directory for exactly this reason.

**Reach for an upload field when** editors supply the asset. **Avoid it when** the
asset is a build artefact — that belongs in the repo, not the CMS.

**Mistakes:** treating `staticDir: 'public/media'` as production storage. It is
local disk, so it does not survive a container rebuild or scale past one process.
WordPress has the same problem and the same answers (S3 plugins, NFS); Payload's
answer is a storage adapter that is not configured here
([09-to-production.md](../learn/09-to-production.md)).

---

## 3.8 Hooks are typed and scoped; `add_action` is global

**WordPress:** `add_action('save_post', …)`, `add_filter('the_title', …)`. Any
file can register a callback on any hook for any post type at any priority, and
you discover what is attached by grepping or by dumping `$wp_filter`.

**What it is, and why it exists** — Payload hooks are arrays on the thing they
affect. A `beforeChange` on Posts is written inside `Posts.ts`, runs only for
Posts, receives a typed `data` object, and cannot be registered from elsewhere.
Reading a collection file tells you everything that happens to that collection.

The cost is symmetrical: there is no "attach to all post types", and no plugin can
extend behaviour without editing the config. WordPress's global registry is what
makes a plugin ecosystem possible at all, so you are trading extensibility for
legibility.

**Simple** — two levels: `hooks: { beforeValidate: [slugFrom('title')] }` on a
field, `hooks: { beforeChange: [fn] }` on a collection.

**Real** — **six hook registrations** exist in the entire CMS, and three of them
share one factory. This is all of them, the factory included:

| Where | Level | Kind | What it does |
|---|---|---|---|
| [`hooks/slugify.ts:25`](../../apps/cms/src/hooks/slugify.ts) | field | `beforeValidate` | the `slugFrom(src)` factory |
| [`Categories.ts:49-51`](../../apps/cms/src/collections/Categories.ts) | field | `beforeValidate` | `slugFrom('name')` |
| [`Posts.ts:72-75`](../../apps/cms/src/collections/Posts.ts) | field | `beforeValidate` | `slugFrom('title')` |
| [`Pages.ts:57`](../../apps/cms/src/collections/Pages.ts) | field | `beforeValidate` | `slugFrom('title')` |
| [`Posts.ts:130-141`](../../apps/cms/src/collections/Posts.ts) | collection | `beforeChange` | stamps `publishedAt`, defaults `_status` |
| [`Posts.ts:149-155`](../../apps/cms/src/collections/Posts.ts) | collection | `afterChange` | **logs only** |
| [`Posts.ts:157-161`](../../apps/cms/src/collections/Posts.ts) | collection | `afterDelete` | **logs only** |

No `afterRead`, no `beforeDelete`, no login hooks anywhere. The slug hook is the
reusable one, shared by three collections:

```ts
// apps/cms/src/hooks/slugify.ts
export const slugFrom =
  (sourceField: string): FieldHook =>
  ({ value, data, originalDoc }) => {
    if (typeof value === 'string' && value.length > 0) {
      return toSlug(value)
    }

    const source = (data?.[sourceField] ?? originalDoc?.[sourceField]) as string | undefined

    return source ? toSlug(source) : value
  }
```

It only fills a slug the editor left blank, never rewriting one someone typed,
because slugs are public URLs. WordPress derives the same way — `wp_insert_post()`
runs `sanitize_title()` over the title when `post_name` is empty, then
`wp_unique_post_slug()` de-duplicates it — but that logic lives in core, not in
your code. Here it is a 35-line file, most of it comment, that you can read in a minute. The collection hook that
derives data:

```ts
// apps/cms/src/collections/Posts.ts
beforeChange: [
  ({ data, operation }) => {
    // Stamp a publish date the first time a post actually goes live.
    if (data._status === 'published' && !data.publishedAt) {
      data.publishedAt = new Date().toISOString()
    }
    if (operation === 'create' && !data._status) {
      data._status = 'draft'
    }
    return data
  },
],
```

`beforeChange` is `wp_insert_post_data` — **its return value is saved**.
`afterChange` is `save_post`, too late to reject anything. Fire both, then read
the log. This creates a post and deletes it again, so it leaves the database as it
found it:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

ID=$(curl -s -X POST http://localhost:3000/api/posts \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"title":"Hook probe","_status":"published"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["doc"]["id"])')

curl -s -o /dev/null -X DELETE "http://localhost:3000/api/posts/$ID" \
  -H "Authorization: users API-Key $KEY"

grep -a 'posts.after' logs/cms.log | sed 's/\x1b\[[0-9;]*m//g' | tail -2
```

```
[23:06:32] INFO: [posts.afterChange] create id=42 slug=hook-probe status=published
[23:06:32] INFO: [posts.afterDelete] id=42 slug=hook-probe
```

Your id and timestamps will differ. Three things in that output are worth a
second look: the slug is `hook-probe` and you never sent one, so the field hook
ran; one line appears per write with no code anywhere else arranging it; and both
lines are `after`, so the post existed before either fired.

**`grep -a`, not plain `grep`.** The dev server writes ANSI colour codes, which
makes `logs/cms.log` read as a binary file — plain `grep` then matches silently
and prints nothing, which looks exactly like "no hook ran". The `sed` strips the
colour codes afterwards so the line is readable. The file is also truncated every
time `npm run dev` restarts, so an empty log means a fresh process, not a broken
hook.

**Reach for a field hook when** the logic concerns one value, **a collection hook
when** it concerns the document. **Avoid `afterChange` for anything that must not
be bypassed** — the write has already committed. Ordering is in
[03 §3.5](../learn/03-payload.md).

⚠️ **`afterChange` and `afterDelete` here only log.** They are the documented seam
where cache invalidation would go, left empty on purpose so the lifecycle stays
observable without adding coupling. There is no working revalidation system in
this repo.

---

## 3.9 Access control returns a query, not a boolean

The most important section in the chapter. If you take one idea from Payload back
to your WordPress work, take this one.

**WordPress:** `current_user_can('edit_post', $id)` returns a boolean. Capability
checks answer *may this user do this to this thing*. Filtering a **list** is a
separate job done later and elsewhere — usually `pre_get_posts`, sometimes a
`posts_where` filter, sometimes a loop that skips rows the query already fetched.
Two mechanisms, two places, and nothing forces them to agree.

**What it is, and why it exists** — Payload gives each operation its own function
and lets it return **either** a boolean **or** a `Where` query. `true` allows,
`false` denies, and a query is merged into the SQL for this request. Authorisation
and filtering become one expression, so they cannot disagree.

**Simple** — `read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } })`.

**Real** — [`Posts.ts`](../../apps/cms/src/collections/Posts.ts) lines 40–54, the
only query-returning access function in the repo:

```ts
// apps/cms/src/collections/Posts.ts
access: {
  read: ({ req }) => {
    if (req.user) return true // editors and admins see drafts too

    // Anonymous callers only ever see published documents. Returning a query
    // (not `false`) means the request succeeds with drafts filtered out.
    return {
      _status: { equals: 'published' },
    }
  },
  create: ({ req }) => Boolean(req.user),
  update: ({ req }) => Boolean(req.user),
  // Deliberately stricter than update, to show operations differ.
  delete: ({ req }) => req.user?.role === 'admin',
},
```

Prove it — same URL, same code path, two callers:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  | python3 -c 'import json,sys; print("anonymous:", json.load(sys.stdin)["totalDocs"])'

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; print("with key: ", json.load(sys.stdin)["totalDocs"])'
```

```
anonymous: 6
with key:  8
```

Both numbers move as you and the labs create posts, so do not read them as
constants — **the gap is what matters, and it is exactly the number of drafts in
the database** (one from the seed, plus whatever earlier chapters left behind).
The anonymous caller was not refused: it got a `200` with a smaller result set,
because the drafts were never in its query. No `has_cap` check to remember, no
`pre_get_posts` to keep in sync.

| WordPress | Payload here |
|---|---|
| `read_post` capability | `access.read` |
| `edit_posts` | `access.create` / `access.update` |
| `delete_posts` | `access.delete` |
| `administrator` / `editor` roles | the `role` select on [`Users.ts`](../../apps/cms/src/collections/Users.ts) |
| `map_meta_cap` for per-object rules | the same function — it receives `req` |
| `pre_get_posts` to hide rows | **the same function, returning a `Where`** |

Role gating is one expression, `req.user?.role === 'admin'` on delete for Posts,
Pages and Categories. There is no `src/access/` directory and no role matrix;
every rule is an inline arrow function in the collection it governs.

**Reach for a query-returning rule when** the answer is "some of them". **Avoid
returning `false` for list reads** — a flat refusal turns a partial view into a
`403` and forces every caller to special-case it.

⚠️ **Payload's access control protects Payload, not the storefront.** The Astro
app in front of it has **no authentication at all** — anyone can delete any post
through the UI, deliberately, as documented in
[09 §9.5](../learn/09-to-production.md). The rules above are not the security
posture of the running system.

**Mistakes:** the header. `Authorization: users API-Key <key>` is the collection
slug, then a literal ` API-Key ` — not `Bearer`. Get it wrong and writes return
`403` with no hint, which is why
[`Users.ts`](../../apps/cms/src/collections/Users.ts) documents it in a comment.

---

## 3.10 Drafts are versions, and `Pages` deliberately has none

**WordPress:** `post_status`, plus revisions stored as `revision` rows in
`wp_posts`, capped by `WP_POST_REVISIONS`, with autosave on top.

**What it is, and why it exists** — one option turns a collection into a
draft/published state machine with a version history table behind it.

**Simple** — `versions: { drafts: true, maxPerDoc: 10 }`, which is exactly
[`Posts.ts:171`](../../apps/cms/src/collections/Posts.ts).

**Real** — the consequences:

| WordPress | Payload |
|---|---|
| `post_status` column | `_status` enum column (`enum_posts_status`) |
| revisions inside `wp_posts` | a separate `_posts_v` table |
| `wp_get_post_revisions()` | `GET /api/posts/versions` |
| preview a draft via a nonce URL | `?draft=true`, authenticated |
| `WP_POST_REVISIONS` | `maxPerDoc` |

Drafts are what make §3.9 visible:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
SLUG='draft-a-performance-budget-for-this-stack'

curl -gs "http://localhost:3000/api/posts?where[slug][equals]=$SLUG&depth=0" \
  | python3 -c 'import json,sys; print("anonymous:", json.load(sys.stdin)["totalDocs"])'

curl -gs "http://localhost:3000/api/posts?where[slug][equals]=$SLUG&depth=0" \
  -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("with key: ", d["totalDocs"], d["docs"][0]["_status"])'
```

```
anonymous: 0
with key:  1 draft
```

Not a `403`. For an anonymous caller that post does not exist.

**Reach for drafts when** content is reviewed before it goes live. **Avoid them
when** it is not — and this repo makes the point by leaving them off, with the
reason in the file:

```ts
// apps/cms/src/collections/Pages.ts
/**
 * Deliberately NO drafts here, unlike Posts.
 * … Drafts would double every one of the block tables, and chapter 10 uses the
 * contrast between Posts (drafts on) and Pages (drafts off) to show the cost.
 */
timestamps: true,
```

**Mistakes:** forgetting that drafts mean two tables and that new fields land in
both. Add `readingTime` to Posts and you get `reading_time` on `posts` *and*
`version_reading_time` on `_posts_v` — which matters when you write raw SQL or
clean up a failed rename ([07-troubleshooting.md](../learn/07-troubleshooting.md)).

---

## 3.11 Types are generated, and imported nowhere

**WordPress:** no equivalent. PHP has no compile step over your field groups, so
`get_field('subheading')` returns `mixed` and you find out at runtime. The ACF
habit of defensive `if ( $x )` checks exists because of this.

**What it is, and why it exists** — Payload writes a TypeScript file from the same
config that writes the SQL, so the editor knows your field names.

**Simple** — `npm --prefix apps/cms run generate:types` after any field change.

**Real** — [`apps/cms/src/payload-types.ts`](../../apps/cms/src/payload-types.ts)
is 668 generated lines, carrying your admin descriptions through as doc comments:

```ts
// apps/cms/src/payload-types.ts — GENERATED, do not edit
export interface Post {
  id: number;
  title: string;
  /**
   * Left blank, this is derived from the title.
   */
  slug?: string | null;
  …
  category?: (number | null) | Category;
  coverImage?: (number | null) | Media;
  tags?: { tag: string; … }[] | null;
```

**Now the honest part.** 📋 That file is imported by nothing:

```bash
grep -rn "payload-types" --include='*.ts' --include='*.tsx' --include='*.astro' --include='*.mjs' apps/ \
  | grep -v node_modules | sort
```

```
apps/cms/eslint.config.mjs:34:    ignores: ['.next/', 'src/payload-types.ts', 'src/payload-generated-schema.ts'],
apps/cms/src/payload.config.ts:84:    outputFile: path.resolve(dirname, 'payload-types.ts'),
apps/storefront/src/lib/types.ts:7: *   • Payload generates `apps/cms/src/payload-types.ts` from its collection
```

An eslint ignore, the config line that writes it, and one mention in a comment.
**No code imports it.** Do not let anyone sell you end-to-end type sharing on the
strength of this repo. The storefront hand-writes its own shapes and argues the
case in the header of
[`apps/storefront/src/lib/types.ts`](../../apps/storefront/src/lib/types.ts):

```ts
/**
 * These are hand-written on purpose … NOT imported from the backends:
 *   • Payload generates `apps/cms/src/payload-types.ts` from its collection
 *     config. Importing it would couple the storefront to the CMS's file layout
 *     and drag Payload's whole type graph in.
 *   • Medusa generates types into `apps/commerce/.medusa/types`, which only
 *     exists after a build.
 *
 * Declaring the contract here … keeps the three apps independently buildable.
 * The trade-off is real: these can drift from the backends, and nothing but
 * `astro check` will tell you.
 */
```

That is a service-boundary decision, not laziness. The storefront talks to Payload
over HTTP; sharing a type across that boundary would create a code dependency
where there is deliberately only a network one. In a monorepo you would extract a
shared package — the comment says so — and the cost is named too. The Astro side
of the contract is [05-astro.md](../learn/05-astro.md).

**Reach for the generated types when** writing code inside `apps/cms`. **Avoid
importing them across apps** — write the contract you consume.

**Mistakes:** editing `payload-types.ts`, or believing a green `tsc` in the
storefront proves the CMS agrees. It proves only that the storefront agrees with
itself.

---

## 3.12 The Local API is `WP_Query`; REST is `wp-json`

**WordPress:** `new WP_Query([...])` runs in-process with full privileges inside
the request that will render the page. `wp-json/wp/v2/posts` is the same data over
HTTP with permission callbacks in front.

**What it is, and why it exists** — Payload makes exactly that split, with one
query language for both.

**Simple** — `await payload.find({ collection: 'posts', where: { … } })`.

**Real** — the comparison that matters:

| | Local API | REST | WordPress analogue |
|---|---|---|---|
| Call | `payload.find({ collection: 'posts' })` | `GET /api/posts` | `WP_Query` vs `wp-json` |
| Transport | in-process | HTTP | same |
| Access control | **bypassed by default** | always enforced | `WP_Query` runs no `current_user_can()` either |
| Available in | hooks, endpoints, scripts | anywhere | same |

That default is the same trap as `WP_Query`: both assume they are trusted server
code, so the WordPress habit of trusting a result and filtering afterwards
transfers directly — and so does the bug.
[`postStats.ts`](../../apps/cms/src/endpoints/postStats.ts) opts back in with
`payload.count({ collection: 'posts', overrideAccess: false, user })`. Pass the
incoming `user`, turn the override off, and the Local API respects the same rules
REST does, including the query-returning `read` from §3.9:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s http://localhost:3000/api/posts/stats \
  | python3 -c 'import json,sys; print("anon :", json.load(sys.stdin)["counts"])'
curl -s http://localhost:3000/api/posts/stats -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; print("keyed:", json.load(sys.stdin)["counts"])'
```

```
anon : {'posts': 6, 'published': 6, 'drafts': 0, 'categories': 3}
keyed: {'posts': 8, 'published': 6, 'drafts': 2, 'categories': 3}
```

One endpoint, one code path, two answers. `published` agrees because publishing
is what both callers are allowed to see; `posts` and `drafts` diverge by exactly
the drafts in the database, so your totals will differ from these the moment you
save anything. A third transport is live too — a
GraphQL API generated from the same config, honouring the same `read` rule, which
is why it agrees with the anonymous REST count:

```bash
curl -s -X POST http://localhost:3000/api/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ Posts(limit:1){ totalDocs } }"}'
```

```
{"data":{"Posts":{"totalDocs":6}}}
```

You will still reach for REST in this repo; nothing here consumes GraphQL. Query parameters (`where`, `depth`, `limit`, `sort`, `select`,
`draft`) are your `WP_Query` args, tabulated in
[03 §3.10](../learn/03-payload.md).

**Reach for the Local API in** hooks, endpoints and scripts. **Avoid it from**
another process — that is what REST is for.

**Mistakes:** passing `overrideAccess: false` without `user`, which makes your own
server code the anonymous caller. That is rarely what you meant inside a hook.

---

## 3.13 Custom endpoints replace `register_rest_route`

**WordPress:** `register_rest_route('myplugin/v1', '/stats', [...])` inside a
`rest_api_init` action, with a `permission_callback` you must not forget.

**What it is, and why it exists** — generated CRUD is excellent at "documents
matching a query" and useless at aggregates. `endpoints` is the escape hatch, and
it hangs off the thing it belongs to rather than a global registry.

**Real** — [`apps/cms/src/endpoints/postStats.ts`](../../apps/cms/src/endpoints/postStats.ts),
mounted by `endpoints: [postStats]` in `Posts.ts`, serving `GET /api/posts/stats`:

```ts
// apps/cms/src/endpoints/postStats.ts
export const postStats: Endpoint = {
  path: '/stats',
  method: 'get',
  handler: async (req) => {
    const { payload, user } = req
    const [total, published, drafts, categories, recent] = await Promise.all([
      payload.count({ collection: 'posts', overrideAccess: false, user }),
      payload.count({ collection: 'posts', where: { _status: { equals: 'published' } }, overrideAccess: false, user }),
      payload.count({ collection: 'posts', where: { _status: { equals: 'draft' } }, overrideAccess: false, user }),
      payload.count({ collection: 'categories', overrideAccess: false, user }),
      payload.find({ collection: 'posts', limit: 5, sort: '-updatedAt', depth: 0, … }),
    ])
    return Response.json({ counts: { … }, recent: recent.docs,
      authenticatedAs: user ? { … } : null, generatedAt: … })
  },
}
```

Five queries in one `Promise.all`, and no `permission_callback` — because
`overrideAccess: false` pushes authorisation down into each query, expressed once
rather than guarded once. Two kinds of endpoint exist here:

| Kind | Declared on | Path | File |
|---|---|---|---|
| collection | `Posts.endpoints` | `/api/posts/stats` | [`postStats.ts`](../../apps/cms/src/endpoints/postStats.ts) |
| root | `payload.config.ts:51` | `/api/schema` | [`schema.ts`](../../apps/cms/src/endpoints/schema.ts) |

The root one requires a user and drops to raw SQL through Drizzle against
`information_schema` — it is how §3.3 counted its own tables:

```bash
curl -s -o /dev/null -w 'anon /api/schema -> %{http_code}\n' http://localhost:3000/api/schema
```

```
anon /api/schema -> 401
```

**Reach for an endpoint when** you need an aggregate, a multi-collection response,
or something that is not CRUD. **Avoid one when** a `where` clause would do —
every hand-written route is a route you now maintain
([03 §3.9](../learn/03-payload.md)).

---

## 3.14 There is no custom admin UI here, and Medusa has one

**WordPress:** `add_meta_box()`, `add_menu_page()`, admin columns, Gutenberg
sidebar plugins. Customising wp-admin is routine work for you.

Payload supports the equivalent through `admin: { components: … }` pointing at
React components resolved via a generated import map. **This repo uses none of
it:**

```bash
grep "^import" "apps/cms/src/app/(payload)/admin/importMap.js" | grep -v "@payloadcms/" | wc -l
grep -rn "components" apps/cms/src/collections apps/cms/src/globals apps/cms/src/payload.config.ts | wc -l
```

```
0
0
```

📋 Every import map entry is Payload's own and no collection or global declares an
admin component, so the panel you see is entirely generated. The capability is
real — `components?:` is on Payload's own collection config type, in
`payload/dist/collections/config/types.d.ts` — it is simply unused here. The contrast is
deliberate, because the other backend here *does* ship one:
[`apps/commerce/src/admin/widgets/product-reviews.tsx`](../../apps/commerce/src/admin/widgets/product-reviews.tsx)
is a real React widget mounted into Medusa's product detail screen with
`defineWidgetConfig({ zone: 'product.details.after' })` — the closest thing in
this codebase to `add_meta_box()`, covered in
[04-medusa.md](../learn/04-medusa.md). Payload can do custom admin screens, this
repo does not show you how, and your WordPress skill transfers from the Medusa
side.

---

## 3.15 Things with no equivalent, in both directions

Forcing an analogy here would cost you more than admitting the gap.

| In WordPress, absent from Payload | Status | What you do instead |
|---|---|---|
| Plugins | 🚫 no concept | write it, or find an npm package |
| Themes, template hierarchy | 🚫 | Astro owns rendering — [04](04-astro-for-theme-developers.md) |
| Taxonomies, term meta, archives | 🚫 | a collection, a relationship, your own routes |
| Comments | 🚫 | a collection you design |
| Shortcodes | 🚫 | a block, or a Lexical node type |
| The Loop, `the_content()` | 🚫 | fetch JSON, render it yourself |
| wp-cron | 🚫 in Payload | Medusa has the scheduler — [12](../learn/12-operating-it.md) |
| Multisite | 🚫 | separate deployments |
| WPML | 📋 `localization` exists, unconfigured | [07-cross-cutting.md](07-cross-cutting.md) |

| In Payload, no WordPress counterpart | The problem it solves that WordPress never had |
|---|---|
| Access functions returning a `Where` | WordPress's data layer was always in-process, so "filter the list" and "may they?" could live apart. An HTTP API answering untrusted callers cannot afford two mechanisms. |
| Generated TypeScript types | PHP renders in the process that queried, so a wrong field name fails visibly in dev. A separate frontend in another language finds out in production. |
| `depth` on every request | `get_field()` could lazily hit the database whenever you touched it. Over HTTP there is no later, so you declare how much graph you want up front. |
| Blocks as a typed contract | WordPress handed the template a database handle. Here the renderer is a different process and needs a shape it can rely on. |
| Config-as-schema in git | `wp-admin` is a production-writable surface, so field groups could change on a live site. Here the schema only changes through a deploy. |

That last row is the summary of the whole chapter. WordPress optimised for a
single process that could do anything at any time. Payload optimises for a service
that hands data to strangers.

Three labs in [06-labs.md](../learn/06-labs.md) are worth doing now — **Lab 1**
(add a field, watch `push` create the column), **Lab 3** (prove access control
filters rather than rejects) and **Lab 7** (a whole new collection from one file).
Then do the one thing this repo cannot show you: upload an image at
http://localhost:3000/admin/collections/media, attach it to a post as
`coverImage`, and run

```bash
docker exec apm-postgres psql -U postgres -d payload_crud \
  -c 'select filename, sizes_thumbnail_url, sizes_card_url from media;'
```

That is `add_image_size()` and the Media Library, finally running.

---

## Check yourself

1. An ACF repeater with four rows and three sub-fields is 26 `postmeta` rows.
   What is a Payload `array` field with four rows, and what is `_order` for?
2. Your client wants one extra text field on a post type at 11pm. Describe what
   happens in WordPress and what happens here.
3. `read` returning `false` versus `read` returning
   `{ _status: { equals: 'published' } }` — what does the caller see in each case,
   and with what HTTP status?
4. Which WordPress mechanism is Payload's `blocks` field closest to, and name two
   things Elementor does that it cannot?
5. `payload-types.ts` is 668 lines and imported by nothing. Give the argument for
   that, and the cost it accepts.
6. You need to purge a CDN when a post is published. Which hook, and why not the
   one after it?
7. Why does `/api/posts/stats` report `drafts: 0` to one caller and a non-zero
   count to another, when it is one handler with no conditional about drafts?
8. The Media collection is configured with two image sizes and has never been
   used. What can you honestly claim about it, and what would you have to do
   before claiming more?

---

**Next:** [04-astro-for-theme-developers.md](04-astro-for-theme-developers.md) —
where the template hierarchy went, and why there is no `functions.php`.
