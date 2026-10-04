# 3 · Payload — config as the application

> Reference counterpart: [`../architecture.md`](../architecture.md) §2.
> Endpoint tables: [`../rest-api.md`](../rest-api.md) §Payload.

Start here. Payload gives you the fastest win of the three, and understanding it
makes Medusa's extra machinery legible by contrast.

**The whole idea in one sentence:** you describe your data in a TypeScript object,
and Payload generates the database schema, a REST API, a GraphQL API, an admin
UI, and TypeScript types from it.

---

## 3.1 First, look at it

```bash
npm run dev
```

Open **http://localhost:3000/admin** — log in as `admin@local.test` /
`supersecret`.

You'll see Posts, Pages, Categories, Media and Users in the sidebar, plus a
Site settings entry (a global), each with a working
list view, create form, edit form and delete button. **Nobody wrote any of those
screens.** They were generated from five files in
[`apps/cms/src/collections/`](../../apps/cms/src/collections/).

Now the same data over HTTP:

```bash
curl -s 'http://localhost:3000/api/posts?limit=2&depth=0' | head -c 400
```

Same source, no controller written for either.

---

## 3.2 The config is the app

Open [`apps/cms/src/payload.config.ts`](../../apps/cms/src/payload.config.ts). It
is ~86 lines and it is the entire application:

```ts
export default buildConfig({
  admin: { user: Users.slug },
  collections: [Users, Media, Categories, Posts, Pages],  // ← the whole data model
  globals: [SiteSettings],                               //    one record each
  editor: lexicalEditor(),
  secret: process.env.PAYLOAD_SECRET || '',
  db: postgresAdapter({ pool: { connectionString: process.env.DATABASE_URL } }),
  cors: [...], csrf: [...],
  typescript: { outputFile: … },
  sharp,
})
```

Two beginner traps live in that snippet:

- The key is **`db`**, not `database`. `database` is silently ignored and you get
  a confusing failure later.
- **`secret` is required.** Omit it and Payload refuses to start with
  `missing secret key`. It signs JWTs and hashes API keys; changing it invalidates
  every existing session and key.

Compare with [`apps/commerce/medusa-config.ts`](../../apps/commerce/medusa-config.ts)
— 50 lines that mostly just *list* modules. Payload's config **is** the behaviour;
Medusa's config only points at where behaviour lives.

---

## 3.3 A collection, field by field

[`apps/cms/src/collections/Categories.ts`](../../apps/cms/src/collections/Categories.ts)
is the smallest complete example. Read it now — it's ~58 lines.

Adding it to `collections` bought all of this:

```
GET    /api/categories          list (where/sort/limit/page/depth/select)
POST   /api/categories          create
GET    /api/categories/:id      read
PATCH  /api/categories/:id      update
DELETE /api/categories/:id      delete
GET    /api/categories/count    count
```

…plus a GraphQL schema, an admin CRUD screen, the SQL table, and TS types.

### Field types you'll use

| Type | Produces | Note |
|---|---|---|
| `text` | `varchar` | `unique: true`, `index: true` supported |
| `textarea` | `text` | multi-line input |
| `number` | `numeric` | |
| `checkbox` | `boolean` | |
| `date` | `timestamp` | |
| `select` | `varchar` + enum-ish UI | give it `options` |
| `richText` | `jsonb` | a **node tree**, not HTML — §3.7 |
| `relationship` | FK to another collection | expand with `?depth=` |
| `upload` | FK to an upload collection | for images/files |
| `array` | **its own table** | `posts_tags` with a parent FK + order column |
| `group` / `blocks` | nested structures | `blocks` = flexible page builder |

Two of those surprise people: `richText` is JSON, and `array` becomes a separate
table. See the second for yourself:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep posts
```

---

## 3.4 Access control: functions, not a role matrix

This is Payload's best idea, and the one most tutorials undersell. From
[`Posts.ts`](../../apps/cms/src/collections/Posts.ts):

```ts
access: {
  read: ({ req }) => {
    if (req.user) return true
    return { _status: { equals: 'published' } }   // ← a QUERY, not a boolean
  },
  create: ({ req }) => Boolean(req.user),
  update: ({ req }) => Boolean(req.user),
  delete: ({ req }) => req.user?.role === 'admin',
}
```

Each operation gets its own function, receiving the request. Returning `true` or
`false` allows or denies — but **returning a `Where` object filters the result set
instead**.

So an anonymous reader isn't *forbidden* from seeing drafts. Drafts simply do not
exist for them. Watch it:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  | python3 -c 'import json,sys; print("anonymous:", json.load(sys.stdin)["totalDocs"])'

curl -s 'http://localhost:3000/api/posts?limit=50&depth=0' \
  -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; print("with key: ", json.load(sys.stdin)["totalDocs"])'
```

`3` then `4`. Same URL, same code path — the access rule narrowed the query.

Note `delete` is stricter than `update`: any logged-in user may edit, only an
`admin` may delete. Operations are independent.

---

## 3.5 Hooks: your code in the lifecycle

Two levels, and choosing correctly matters.

**Field hooks** — smallest scope. The slug computes itself from `title`:

```ts
// src/hooks/slugify.ts, used in Posts.ts
hooks: { beforeValidate: [slugFrom('title')] }
```

The collection doesn't know slugs exist. That logic is reusable across
collections — [`Categories.ts`](../../apps/cms/src/collections/Categories.ts)
uses the same helper with `slugFrom('name')`.

**Collection hooks** — whole-document scope:

| Hook | Runs | Typical use |
|---|---|---|
| `beforeValidate` | before validation | normalise input |
| `beforeChange` | before write | derive fields — **its return value is saved** |
| `afterChange` | after commit | cache invalidation, notifications, logging |
| `afterDelete` | after delete | cleanup |

Watch one fire. With `npm run dev` running, create a post at
http://localhost:4321/posts/new and watch the terminal:

```
[cms] [posts.afterChange] create id=8 slug=my-post status=published
```

That is `Posts.ts` executing in response to your HTTP request. In production this
is where you'd tell Astro to revalidate a cached page.

**The order that matters:**
`access` → `beforeValidate` → field validation → `beforeChange` → **DB write** →
`afterChange`. Anything that must not be bypassed goes at or before
`beforeChange`; `afterChange` is too late to reject a write.

---

## 3.6 Drafts

```ts
versions: { drafts: true, maxPerDoc: 10 }
```

This adds a `_status` field (`'draft' | 'published'`) and a version-history table.
Consequences:

- Reads return published documents by default
- `?draft=true` (authenticated) returns the latest draft
- A create/update can publish in one call by setting `_status: 'published'`
- Through the **Local API**, writing a draft needs `draft: true` on the call, or
  the version machinery records it as published

⚠️ **Drafts mean two tables.** `posts` *and* `_posts_v`. When you add a field it
appears in both (`reading_time` and `version_reading_time`). This matters when
cleaning up — see [07-troubleshooting.md](07-troubleshooting.md).

---

## 3.7 Rich text is a tree

A `richText` field stores this, not HTML:

```json
{ "root": { "children": [
  { "type": "paragraph", "children": [ { "type": "text", "text": "hi" } ] } ] } }
```

Structured content renders to HTML, React, plain text, or a native app's own
components. The cost: consumers must walk the tree.

```bash
curl -s 'http://localhost:3000/api/posts?limit=1&depth=0' \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["docs"][0]["content"], indent=2)[:400])'
```

[`apps/storefront/src/lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts)
is a dependency-free renderer. Two details worth stealing: text formatting is a
**bitmask** on each text node (not nested tags), and unknown node types recurse
into their children rather than dropping content silently.

---

## 3.8 Local API vs REST

Payload exposes the same query language two ways:

| | Local API | REST |
|---|---|---|
| Call | `payload.find({ collection: 'posts' })` | `GET /api/posts` |
| Transport | in-process | HTTP |
| Speed | no network, no serialisation | a round trip |
| Access control | **bypassed by default** | always enforced |
| Available in | server code, hooks, scripts, endpoints | anywhere |

That access-control default is the thing to remember: the Local API assumes it is
trusted server code. To make it behave like REST, pass the user and turn the
override off — which
[`postStats.ts`](../../apps/cms/src/endpoints/postStats.ts) does:

```ts
payload.count({ collection: 'posts', overrideAccess: false, user })
```

Which is why the same endpoint reports different numbers:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s http://localhost:3000/api/posts/stats | python3 -m json.tool | head -8
curl -s http://localhost:3000/api/posts/stats -H "Authorization: users API-Key $KEY" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["counts"], d["authenticatedAs"])'
```

Anonymous sees `drafts: 0`. Authenticated sees `drafts: 1`.

---

## 3.9 Custom endpoints

Generated CRUD is excellent at "documents matching a query" and useless at
aggregates. `endpoints` on a collection is the escape hatch:

```ts
// src/endpoints/postStats.ts → GET /api/posts/stats
export const postStats: Endpoint = {
  path: '/stats',
  method: 'get',
  handler: async (req) => { … return Response.json({ … }) },
}
```

Mounted with `endpoints: [postStats]` in `Posts.ts`. Reach for one when you need
an aggregate, a multi-collection response, or an operation that isn't CRUD.

---

## 3.10 Querying: the params worth knowing

| Param | Example | Effect |
|---|---|---|
| `where` | `?where[title][contains]=CRUD` | filter |
| `depth` | `?depth=1` | expand relationships |
| `limit` / `page` | `?limit=10&page=2` | paginate |
| `sort` | `?sort=-updatedAt` | `-` reverses |
| `select` | `?select[title]=true` | restrict fields |
| `draft` | `?draft=true` | latest draft (needs auth) |

`depth` is the one to understand. `depth=0` gives `category: 3`; `depth=1` gives
the whole category document; `depth=2` expands relationships *inside* it. Default
it low — a high depth fetches a tree you probably don't render.

```bash
curl -gs 'http://localhost:3000/api/posts?limit=1&depth=0' | python3 -c 'import json,sys; print("depth=0 →", json.load(sys.stdin)["docs"][0]["category"])'
curl -gs 'http://localhost:3000/api/posts?limit=1&depth=1' | python3 -c 'import json,sys; print("depth=1 →", json.load(sys.stdin)["docs"][0]["category"])'
```

⚠️ **`curl` needs `-g`** whenever the URL has `[` or `]`, or it treats them as a
glob range and refuses with `bad range in URL position`.

---

## 3.11 Auth: the header that trips everyone

```
Authorization: users API-Key <key>
               ^^^^^ the COLLECTION SLUG, then a literal " API-Key "
```

Not `Bearer <key>`. Not `API-Key <key>`. The slug prefix is required because
Payload supports API keys on *any* auth-enabled collection and must know which to
look in. Get it wrong and every write returns `403` with no hint.

The key is generated by the seed script, stored **encrypted**, and printed once:

```bash
npm --prefix apps/cms run seed
```

⚠️ `enableAPIKey: true` does **not** generate a key — it only enables the feature.
You must supply the value yourself. See
[`src/scripts/seed.ts`](../../apps/cms/src/scripts/seed.ts).

---

## 3.12 Schema management

In development the Postgres adapter runs **`push`**: it diffs your config against
the live database and applies the difference. That's why adding a field needs no
command.

For production you set `push: false` and use real migrations:

```bash
npm --prefix apps/cms run payload -- migrate:create
npm --prefix apps/cms run payload -- migrate
```

`push` is a development convenience with two sharp edges:

1. **It doesn't cleanly remove columns** when you delete a field from the config.
2. **It can block startup.** If a leftover column must be dropped, push asks
   interactively — `DATA LOSS WARNING … Accept? (y/N)` — and `npm run dev` hangs
   waiting for input you may not notice.

Both are covered in [07-troubleshooting.md](07-troubleshooting.md).

---

## 3.13 Payload requires Next.js

Payload 3 is **not standalone**. It mounts into a Next.js app's `(payload)` route
group, which holds the admin panel and the REST/GraphQL handlers:

```
apps/cms/src/app/
├── (payload)/     ← Payload's own routes. Don't edit.
└── (frontend)/    ← yours. Here: one orientation page.
```

`withPayload()` in `next.config.ts` wires it together. In this repo the Next app
exists only to host Payload; the public site is Astro on :4321.

---

## 3.14 Globals and blocks

Two field-level features this repo now demonstrates, and the reason people pick
Payload for marketing sites.

### A global: exactly one record

[`src/globals/SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts)

|  | Collection | Global |
|---|---|---|
| Documents | many | **exactly one** |
| REST | `/api/posts`, `/api/posts/:id` | `/api/globals/site-settings` |
| Verbs | GET POST PATCH DELETE | **GET and POST only** |
| Local API | `payload.find` / `findByID` | `payload.findGlobal` / `updateGlobal` |
| Admin | list + edit screens | one edit screen |

Use one whenever there is exactly one of the thing — settings, a footer, a
navigation menu. Modelling those as a collection means defending against "what
if there are two?" forever.

```bash
curl -s http://localhost:3000/api/globals/site-settings | python3 -m json.tool
```

There is no empty state: Payload returns field defaults before anyone has saved.

This repo reads it in `Layout.astro`, so the announcement banner appears on every
page — **which means a Payload request per page render**. That is exactly why
globals are the first thing you cache ([09](09-to-production.md) §9.6).

### Blocks: editor-controlled layout, developer-controlled markup

[`src/collections/Pages.ts`](../../apps/cms/src/collections/Pages.ts) has one
field, `layout`, offering `hero`, `prose` and `stats`. An editor assembles a page
from them in any order; the storefront renders each type as a component in
[`pages/[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro).

The contract is the value:

- editors **cannot** produce markup you did not design
- you **cannot** be surprised by a shape you did not handle — every block type
  has known fields, so `blockType` is a discriminated union and TypeScript will
  fail the build if you add a block and forget to render it

Compare a bare `richText` field, which gives an editor freedom and gives you
unstructured HTML.

⚠️ **Blocks are expensive on disk** — one table per block type, plus one per
nested array. See [10-databases.md](10-databases.md) §10.2. `Pages` deliberately
has drafts *off* so you can see the difference against Posts.

See it: http://localhost:4321/pages/about-this-stack

---

## 3.15 Your turn

Do these now — they're in [06-labs.md](06-labs.md) with full expected output:

- **Lab 1** — add a field and watch `push` create the column with no migration
- **Lab 3** — prove access control filters rather than rejects
- **Lab 7** — add a whole new collection and get CRUD from one file

---

## 3.16 Check yourself

1. What exactly does adding a file to `collections` generate?
2. What's the difference between returning `false` and returning a `Where` object
   from a `read` access function?
3. You need to invalidate a CDN cache when a post is published. Which hook?
4. Why does `/api/posts/stats` report different draft counts for different
   callers?
5. Write the auth header from memory.
6. Two reasons `push` is unsuitable for production?
7. When do you reach for a global instead of a collection?
8. `Pages` has one field and made four tables. What did that buy the editor?

---

**Next:** [04-medusa.md](04-medusa.md) — the hard one. Take a break first; budget
real time for it.
