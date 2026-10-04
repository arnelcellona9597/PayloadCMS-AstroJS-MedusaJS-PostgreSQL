# 7 · Troubleshooting

> Reference counterpart: [`../../README.md`](../../README.md) §Gotchas.

Keep this open while you work. Every entry here was hit while building or
documenting this repo — none are hypothetical.

---

## 7.1 First: which layer is talking?

A request crosses four layers. Identifying the layer usually identifies the file.

```
browser
   │
   ├─▶ Astro          :4321   ← CSRF, your endpoints/actions, zod
   │
   ├─▶ Payload        :3000   ← access control, hooks, Drizzle
   └─▶ Medusa         :9000   ← publishable key, zod, workflows
           │
           └─▶ Postgres :5433 ← constraints, missing columns
```

Read the status code first:

| Code | Almost always means | Look at |
|---|---|---|
| `400` | Medusa: missing publishable key. Astro: unparseable body | the request headers |
| `401` | not authenticated — no/expired admin JWT | your login call |
| `403` | authenticated but not permitted, **or** Astro CSRF | access rules / `Origin` |
| `404` | wrong path, or filtered out by access control | the route file, then access rules |
| `422` | validation failed | the zod schema |
| `500` | the backend threw | **the backend's terminal log** |
| `502` | Astro reached a backend and it failed | the backend's log, not Astro's |

**The single most useful habit:** when the storefront shows an error, read the
`[commerce]` or `[cms]` lines in the `npm run dev` terminal. The storefront rarely
knows *why* — the backend always does.

---

## 7.2 Startup and process problems

### `npm run dev` hangs, nothing serves on :3000

**Cause:** Payload's schema `push` found a column it wants to drop and is waiting
on an interactive prompt — which scrolls past under the other two services' logs:

```
? Warnings detected during schema push:
· You're about to delete version_reading_time column in _posts_v table with 5 items
DATA LOSS WARNING: Possible data loss detected if schema is pushed.
Accept warnings and push schema to database? › (y/N)
```

**Why:** you removed a field from a collection. `push` adds columns happily but
will not drop them without confirmation — and for a collection with drafts it
wrote to **two** tables (`posts` and `_posts_v`).

**Fix** — find every orphan and drop it:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c \
  "select table_name, column_name from information_schema.columns where column_name like '%<your_field>%';"

docker exec apm-postgres psql -U postgres -d payload_crud \
  -c 'alter table posts drop column if exists <your_field>;' \
  -c 'alter table _posts_v drop column if exists version_<your_field>;'
```

Then restart. Note the `version_` prefix on the versions table.

### `EADDRINUSE`

A previous process survived.

```bash
ss -ltnp | grep ':3000 '
kill $(ss -ltnp | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
```

⚠️ **Never `pkill -f "medusa develop"`.** The pattern can match your own shell's
command line and kill your terminal. Always target the port's PID.

### `swc compiler requires @swc/core`

Medusa's CLI transpiles TypeScript through ts-node + swc. It is **not** an
optional dev dependency:

```bash
npm --prefix apps/commerce install --save-dev @swc/core
```

### `missing secret key. A secret key is needed to secure Payload`

Two different causes:

1. **`secret` is absent from `buildConfig`.** Required — check
   `apps/cms/src/payload.config.ts`.
2. **A script didn't load `.env`.** `payload run` evaluates the Payload config
   *before* your script body executes, so calling `dotenv` inside the script is
   already too late. Wrap it instead:

   ```bash
   dotenv -e .env -- payload run src/scripts/whatever.ts
   ```

### Payload's config silently ignores the database

The key is **`db`**, not `database`.

---

## 7.3 Auth problems

### `400 Publishable API key required in the request header`

Every `/store/*` route needs it — **custom routes included**.

```bash
npm --prefix apps/commerce run bootstrap     # prints it
curl -s http://localhost:9000/store/reviews -H "x-publishable-api-key: pk_..."
```

### Medusa returns 200 but products/reviews are empty

Nastier version of the above: the key **exists but isn't linked to a sales
channel**. It authenticates, then scopes you to nothing. Reads like a query bug.

```bash
npm --prefix apps/commerce run bootstrap     # links it and prints it
```

### Payload writes return 403 with a valid key

The header format is exact:

```
Authorization: users API-Key <key>
               ^^^^^ collection slug, then a literal " API-Key "
```

`Bearer <key>` doesn't work. `API-Key <key>` without the slug doesn't work.

### `401` from `/admin/*` on Medusa

The publishable key is not enough. Get a JWT:

```bash
curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"supersecret"}'
```

No such user? Create one:

```bash
npm --prefix apps/commerce run user -- -e admin@local.test -p supersecret
```

### Everything 401/400 right after `npm run db:reset`

**The keys changed.** A reset destroys the database, so both keys are regenerated.
Any value in your notes or REST client is dead.

```bash
grep -E '^(PAYLOAD_API_KEY|MEDUSA_PUBLISHABLE_KEY)' apps/storefront/.env
```

`npm run setup` rewrites the storefront's `.env` automatically — but not your
scratch files.

### `429 Too Many Requests` — unexpectedly

You hit a rate limit. Which one depends on the URL:

| Surface | Limit | Set in | Keyed by |
|---|---|---|---|
| Astro `/api/*` and Actions | `RATE_LIMIT_MAX` (120/min) | `apps/storefront/.env` | client IP |
| Medusa `/store/*` | `RATE_LIMIT_STORE_MAX` (240/min) | `apps/commerce/.env` | publishable key, else IP |

The response tells you how long to wait:

```
Retry-After: 27
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1788096465
```

**Common innocent causes**, none of them a bug:

- A load test, or a `for` loop in a shell you forgot about
- Re-running the Postman collection several times in quick succession
- Refreshing the dashboard hard — it calls Medusa on every render

**To raise it**, edit the relevant `.env` and **restart that app** — env vars are
read at startup, so a reload will not pick up the change.

**To clear it immediately**, restart the app. Counters are in-memory, so a
restart resets every bucket to zero. That is also why the limit is useless across
multiple instances — see [09-to-production.md](09-to-production.md).

**Page views are never limited.** If plain browsing 429s, something is wrong:
check that the path really is under `/api/`.

### `403 Cross-site POST/DELETE form submissions are forbidden`

Astro's CSRF check. Browsers send `Origin` automatically; curl doesn't:

```bash
curl -X DELETE http://localhost:4321/api/reviews/<id> -H 'Origin: http://localhost:4321'
```

Requests with `Content-Type: application/json` **and a body** are exempt. A
bodyless `POST` is not — it looks form-like.

---

## 7.4 Schema and data problems

### Medusa: "column does not exist" after editing a model

Editing the model changed TypeScript, not Postgres.

```bash
npm --prefix apps/commerce run db:generate
npm --prefix apps/commerce run db:migrate
```

### A Medusa link isn't working

Two separate requirements, both easy to miss:

```bash
npm --prefix apps/commerce run db:migrate    # link tables come from migrate
                                             # (NOT db:generate)
```

…and **restart** — `src/links/` is not hot-reloaded.

### Related data silently returns empty, no error

A missing or mistyped link. `query.graph` doesn't fail when it can't resolve a
field — it returns an empty array and the route reports "no reviews". Check
`src/links/` first, then that the module is registered in `medusa-config.ts`.

### `Cannot read properties of undefined (reading 'status')`

`query.graph` returned a **hole**. A soft-deleted review keeps its link row
(deliberately, so a restore reattaches it), so a link can resolve to a record
generated queries no longer return.

```ts
const all = (product.reviews ?? []).filter(Boolean)
```

Note this only appears *after* somebody deletes a review — it survives happy-path
testing.

### Payload: new collection returns 404

Registering a new collection needs a **restart**. Adding a field to an existing
one hot-reloads; a new collection does not, and nothing in the log says so.

### Payload: a removed field's column is still there

`push` doesn't drop columns. See §7.2 — and remember the `_posts_v` twin.

### Unpublishing a post doesn't unpublish it

```bash
curl -X PATCH http://localhost:3000/api/posts/4 \
  -H "Authorization: users API-Key $KEY" -H 'Content-Type: application/json' \
  -d '{"_status":"draft"}'
```

⚠️ **Do not add `?draft=true`.** That saves a *draft version* while leaving the
published version live — so the post stays public and the API keeps returning it.

---

## 7.5 Validation and type problems

### Two incompatible `ZodType` errors

You mixed zod copies. Each project pins its own:

| Project | Import from |
|---|---|
| Medusa | `@medusajs/framework/zod` |
| Astro | `astro/zod` |

Never install a separate `zod` and use it across them.

### Astro Action: `expected string, received null`

An omitted form field arrives as `null`. `z.string().optional()` accepts
`undefined` and **rejects `null`**. Use `.nullish()`. `.default()` has the same
problem — it only fires for `undefined`.

A browser form usually submits every field, so this often only shows up from curl
or `fetch`.

### An empty form field overwrites a stored value with `""`

Empty inputs arrive as `''`, not null. Normalise:

```ts
.transform((v) => (v && v.trim() ? v.trim() : null))
```

### A partial update blanked other fields

`updatePost` in `src/lib/payload.ts` sends the **whole** document. Passing it a
partial clears everything you omitted. Write a targeted helper that PATCHes only
the field you mean — see Lab 9.

---

## 7.6 Tooling problems

### `curl: (3) bad range in URL position`

curl treats `[` and `]` as a glob range. Add `-g`:

```bash
curl -gs 'http://localhost:3000/api/posts?where[title][contains]=CRUD'
```

Affects every Payload `where[...]` and `select[...]` query.

### `grep -c` gives a suspiciously low count on HTML

`grep -c` counts **matching lines**, and Astro minifies responses onto very few
lines. Count occurrences instead:

```bash
curl -s http://localhost:4321/posts | grep -o '<strong>' | wc -l
```

### An island does nothing in dev — `_jsxDEV is not a function`

Typing into a React island has no effect, and the browser console shows
`_jsxDEV is not a function`.

**Cause:** a stale Vite pre-bundle. Vite caches optimised dependencies in
`node_modules/.vite`, and adding a UI framework *after* that cache was built
leaves it without React's dev JSX runtime.

```bash
rm -rf apps/storefront/node_modules/.vite apps/storefront/.astro
npm run dev:storefront
```

**It is dev-only.** The production build never hits it, which is a useful
diagnostic: if `npm run build` works and `npm run dev` does not, suspect a cache
before you suspect your code.

### An island renders but does not respond to input

Not a bug — a race. `client:visible` hydrates when the component scrolls into
view, and in dev Astro compiles it on demand, so there is a window where the
server-rendered HTML is visible but React has not attached yet. Clicks and
keystrokes in that window go nowhere.

When scripting against an island, wait for hydration rather than for the markup.
Astro marks an un-hydrated island with an `ssr` attribute and removes it once
hydrated:

```js
await page.waitForFunction(() => {
  const el = document.querySelector('astro-island')
  return el && !el.hasAttribute('ssr')
})
```

Waiting for `.rf-list li` instead finds the SSR'd HTML immediately and proves
nothing.

### `astro check` hangs forever

It's waiting on an install prompt for `@astrojs/check`:

```bash
npm --prefix apps/storefront install --save-dev @astrojs/check typescript
```

### Counting `<script>` tags gives 2 in dev

The dev server injects Vite's HMR client. Measure the production build:

```bash
npm --prefix apps/storefront run build
PORT=4399 node apps/storefront/dist/server/entry.mjs &
curl -s http://localhost:4399/posts | grep -c '<script'    # 0
```

---

## 7.7 Diagnostic cookbook

Run these in order when something is wrong and you don't know where to start.

```bash
# 1. Is everything up?
docker ps --filter name=apm-postgres --format '{{.Names}} {{.Status}}'
ss -ltn | grep -E ':(3000|9000|4321) '

# 2. What does the app itself think?
curl -s http://localhost:4321/api/health | python3 -m json.tool

# 3. Each backend directly
curl -s -o /dev/null -w 'payload %{http_code}\n' http://localhost:3000/api/posts
curl -s -o /dev/null -w 'medusa  %{http_code}\n' http://localhost:9000/health

# 4. Are the keys current?
grep -E '^(PAYLOAD_API_KEY|MEDUSA_PUBLISHABLE_KEY)' apps/storefront/.env

# 5. Is the data there?
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A \
  -c 'select count(*) from review;' \
  -c 'select count(*) from product_product_review_review;'
docker exec apm-postgres psql -U postgres -d payload_crud -t -A \
  -c 'select count(*) from posts;'

# 6. Do the types still hold?
npm run typecheck
```

---

## 7.8 The escalation ladder

Stop at the first step that works.

| # | Action | Fixes |
|---|---|---|
| 1 | Restart one service | stale env, wedged process, new collection/link |
| 2 | `rm -rf apps/*/.next apps/*/.astro apps/*/.medusa` | phantom type errors, stale bundles |
| 3 | `rm -rf apps/X/node_modules && npm --prefix apps/X install` | resolution errors |
| 4 | `npm run db:reset && npm run setup` | **any** data or schema confusion |

Step 4 destroys all data and takes about a minute. **Use it early rather than
late** — the whole point of this repo is that nothing in it is precious.

---

## 7.9 When you're properly stuck

1. **Read the backend's log**, not the frontend's error.
2. **Reproduce with curl.** One request, one status code, no rendering in the way.
3. **Look in the database.** `psql` settles arguments that guessing cannot.
4. **Bisect.** Comment out half the change. Which half broke it?
5. **Check the obvious last-changed thing** — a `.env` edit without a restart
   causes a surprising share of "impossible" bugs.

---

**Next:** [08-glossary.md](08-glossary.md), or
[09-to-production.md](09-to-production.md) when you're ready to deploy something.
