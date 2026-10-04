# 5 · Astro — the frontend and the BFF

> Reference counterpart: [`../architecture.md`](../architecture.md) §3.
> Endpoint tables: [`../rest-api.md`](../rest-api.md) §Astro.

Astro owns no data. It renders HTML on the server, calls both backends over HTTP,
and holds the credentials so the browser never sees them.

It also does the same CRUD **twice, two different ways** — Actions for posts,
hand-written REST endpoints for reviews — so you can compare them in one codebase.
That comparison is the point of this chapter.

---

## 5.1 The config

[`apps/storefront/astro.config.mjs`](../../apps/storefront/astro.config.mjs):

```js
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
})
```

**`output`** accepts exactly two values in Astro 7:

| Value | Renders | Use when |
|---|---|---|
| `'static'` (default) | at build time → HTML files | content changes rarely |
| `'server'` | per request | live data, or you need secrets server-side |

⚠️ **`'hybrid'` was removed in Astro 5.** If you find it in a tutorial, that
tutorial is old. Its behaviour is now `'static'` plus an adapter.

An **adapter** teaches Astro to run on a specific host. `mode: 'standalone'`
builds a self-contained server:

```bash
npm --prefix apps/storefront run build
node apps/storefront/dist/server/entry.mjs
```

Individual pages can opt out with `export const prerender = true`.

---

## 5.2 Why SSR keeps your keys safe

Astro exposes **only `PUBLIC_`-prefixed variables to the browser**. Everything
else is stripped from the client bundle. Because every page renders on the server,
the browser never needs the keys — so none of them carry the prefix:

```bash
grep -E '^[A-Z]' apps/storefront/.env | cut -d= -f1
```

`PAYLOAD_API_KEY`, `MEDUSA_PUBLISHABLE_KEY`, `MEDUSA_ADMIN_PASSWORD` — all
server-only. Prove none reach the browser:

```bash
curl -s http://localhost:4321/reviews | grep -cE 'pk_|API-Key|supersecret'
```

`0`. A CSR app calling Medusa directly would have to ship that key to every
visitor.

[`src/lib/env.ts`](../../apps/storefront/src/lib/env.ts) validates them once at
startup so a missing key fails loudly rather than as a confusing 401 three files
away.

---

## 5.3 Pages, and the frontmatter

An `.astro` file is HTML with a **frontmatter** block that runs **on the server,
once per request**:

```astro
---
const posts = await listPosts({ limit: 50 })   // server: DB creds, secrets, fs
---
<ul>{posts.map(p => <li>{p.title}</li>)}</ul>
```

Everything above `---` never reaches the browser. That's why
[`src/pages/posts/index.astro`](../../apps/storefront/src/pages/posts/index.astro)
can call Payload with an API key inline.

**File-based routing:**

| File | URL |
|---|---|
| `src/pages/index.astro` | `/` |
| `src/pages/posts/index.astro` | `/posts` |
| `src/pages/posts/new.astro` | `/posts/new` |
| `src/pages/posts/[slug].astro` | `/posts/anything` |
| `src/pages/posts/[id]/edit.astro` | `/posts/5/edit` |

Before any of this runs, `src/middleware.ts` sees the request first — see
§5.10.

⚠️ **Static routes win over dynamic ones.** `/posts/new` hits `new.astro`, never
`[slug].astro`. Worth knowing before you let someone create a post with the slug
`new`.

---

## 5.4 Pattern A — Astro Actions (posts)

An **Action** is a typed server function you can call from a form or from
JavaScript. [`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts):

```ts
export const server = {
  post: {
    create: defineAction({
      accept: 'form',
      input: z.object({ title: z.string().min(3), … }),
      handler: async (input) => createPost(input),
    }),
  },
}
```

Used in a page with no client JavaScript at all:

```astro
<form method="POST" action={actions.post.create}>
  <input name="title" />
  <button>Create</button>
</form>
```

Astro renders that `action` as `?_action=post.create`. On submit it validates,
runs the handler, and re-renders the page with the result available via
`Astro.getActionResult(actions.post.create)`.

**What you get free:**

- End-to-end types — no string URLs
- Per-field errors via `isInputError(error)` → `error.fields`
- **It works with JavaScript disabled**

That last claim is testable. In the production build, `/posts` ships **zero**
`<script>` tags — full CRUD, no client JS:

```bash
npm --prefix apps/storefront run build
PORT=4399 node apps/storefront/dist/server/entry.mjs &
sleep 3
curl -s http://localhost:4399/posts | grep -c '<script'      # 0
curl -s http://localhost:4399/posts | grep -c astro-island   # 0
kill %1
```

Zero script tags and zero islands, for a page that creates, edits and deletes.

Note `PORT=4399` — the dev server already owns 4321, and a second server on the
same port fails with `EADDRINUSE`.

(The dev server also injects Vite's HMR client, so counting there gives 2. Always
measure the production build.)

`/reviews` is the deliberate contrast: it needs a client script for `PATCH` and
`DELETE`, *and* it carries this repo's one React island — 188 kB, measured in
[§5.11](#511-islands--the-feature-astro-is-named-for).

### The three form-parsing traps

With `accept: 'form'`, every value arrives as a string — plus two subtler ones:

**1. An absent field arrives as `null`, not `undefined`.** So
`z.string().optional()` — which accepts `undefined` and *rejects* `null` — fails
with `expected string, received null`. Use **`.nullish()`**. `.default()` has the
same problem; it only fires for `undefined`.

A browser form usually submits every field, so you may only discover this from a
`fetch` or curl call that omits one.

**2. An empty field arrives as `''`, not null.** Passing it through stores an
empty string where the caller meant "no value". Normalise `''` → `null`.

**3. Numbers are strings.** `z.coerce.number()`.

All three are handled in `optionalText()` in
[`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts).

⚠️ Import zod from **`astro/zod`**, not a separately installed `zod` — same
two-copies trap as Medusa.

---

## 5.5 Pattern B — your own REST endpoints (reviews)

A file in `src/pages/api/` exporting HTTP-verb functions becomes a real endpoint
returning a standard `Response`:

```ts
// src/pages/api/reviews/index.ts
export const GET: APIRoute = async ({ url }) => {
  …
  return Response.json({ reviews, count })
}
```

Same file-based routing: `[id].ts` gives you `params.id`.

**What this buys that Actions can't:**

- **A real HTTP surface.** curl, a mobile app, another service can all call it.
- **Any verb**, including `PATCH` and `DELETE` — impossible from an HTML form.
- **Composition.** `?include_pending=true` merges Medusa's store and admin
  surfaces into one response no single Medusa route offers:

```bash
curl -s 'http://localhost:4321/api/reviews?limit=2' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("source:", d["source"], "count:", d["count"])'

curl -s 'http://localhost:4321/api/reviews?include_pending=true&limit=2' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("source:", d["source"], "count:", d["count"])'
```

**What it costs:** you write the parsing, the status codes and the error envelope
yourself, and there's no progressive enhancement — `/reviews` needs a client
script for PATCH and DELETE.

### Naming an intent

[`api/reviews/[id]/moderate.ts`](../../apps/storefront/src/pages/api/reviews/%5Bid%5D/moderate.ts)
is technically redundant — `PATCH /api/reviews/:id` with the same body does the
same thing. It exists to make a design point:

> "Approve this review" is an **intent**. "Set the status column" is an
> implementation detail.

Naming the intent means the audit log reads as decisions, extra behaviour has an
obvious home, and callers can't accidentally moderate while editing a title. It's
the same reasoning that puts Medusa's mutations in named workflows.

---

## 5.6 Choosing between them

| | Actions | Endpoints |
|---|---|---|
| Callable by | this app only | anything over HTTP |
| Validation | `input:` schema, field errors free | you call `safeParse` |
| Works without JS | **yes** | no |
| Verbs | form POST only | any |
| Client JS needed | 0 script tags | 1, for PATCH/DELETE |
| Composition | one handler | merge several upstream calls |

**The rule:** if only your own pages call it, use an Action. If anything else
might, write the endpoint.

---

## 5.7 CSRF

Astro checks the `Origin` header on requests that a cross-site HTML form could
forge. From curl:

```bash
curl -s -o /dev/null -w '%{http_code}  DELETE without Origin\n' \
  -X DELETE http://localhost:4321/api/reviews/whatever
curl -s -o /dev/null -w '%{http_code}  DELETE with Origin\n' \
  -X DELETE http://localhost:4321/api/reviews/whatever -H 'Origin: http://localhost:4321'
```

You get `403` then `502`. Both are informative:

- **`403`** — Astro refused before your code ran.
- **`502`** — the request *passed* CSRF, reached your endpoint, which called
  Medusa, which said "no such review". A different failure means you cleared the
  first hurdle.

**The exemption depends on the content type, not the verb.** A cross-site HTML
form can only send `application/x-www-form-urlencoded`, `multipart/form-data` or
`text/plain` — so anything that *could* have come from such a form is checked, and
`application/json` is trusted:

| Request | Result |
|---|---|
| `POST` + `Content-Type: application/json` | ✅ allowed |
| `POST` with **no** body or content type | ❌ `403` — looks form-like |
| `DELETE` (no body) | ❌ `403` |
| any of the above + `Origin` header | ✅ allowed |

That second row surprises people: `curl -X POST /api/posts/4/publish` with no body
is rejected, because from Astro's side it is indistinguishable from a forged form
submission.

Browsers send `Origin` automatically, so the UI never notices. Only your curl
does.

---

## 5.8 The client layer

[`src/lib/`](../../apps/storefront/src/lib/) exists to keep two inconsistencies
out of the pages:

| File | Job |
|---|---|
| `env.ts` | validate config once, fail loudly |
| `payload.ts` | Payload REST + the `users API-Key` header |
| `medusa.ts` | Medusa store surface via the SDK |
| `medusa-admin.ts` | Medusa admin surface, JWT login + cache |
| `lexical.ts` | render Payload's rich-text tree to HTML |
| `types.ts` | the shapes the storefront consumes |

**The inconsistencies being hidden:**

- Payload updates with `PATCH`; Medusa's admin API updates with `POST`
- Payload wants `Authorization: users API-Key`; Medusa wants
  `x-publishable-api-key` *or* a bearer JWT

Pages call `updatePost()` / `updateAdminReview()` and never learn the difference.

### The SDK and its escape hatch

`@medusajs/js-sdk` has typed methods for Medusa's **built-in** routes:

```ts
sdk.store.product.list()          // ✓ built in
sdk.store.review.list()           // ✗ does not exist — we invented that route
```

For custom routes, `sdk.client.fetch()` — same base URL, same headers, arbitrary
path:

```ts
sdk.client.fetch('/store/reviews', { query: { limit } })
```

**Use generated methods where they exist; drop to `client.fetch` where they don't;
never hand-roll the headers.**

### Why types are hand-written

[`types.ts`](../../apps/storefront/src/lib/types.ts) declares shapes rather than
importing Payload's generated `payload-types.ts` or Medusa's `.medusa/types`. That
keeps the three apps independently buildable — at the cost of possible drift, with
`astro check` as the only guard. In a bigger monorepo you'd extract a shared
package.

---

## 5.9 The N+1 on /products

[`products/index.astro`](../../apps/storefront/src/pages/products/index.astro)
makes one request for the product list, then one per product for its rating.
That's an **N+1**: 1 + N requests where 1 would do.

It's left in place and labelled on the page, because the *cause* is the lesson:
reviews live in their own module, so "products with ratings" is not a single
query. The fix is a purpose-built route resolving many products' reviews in one
`query.graph` call — the trade-off you accept at any service boundary.

---

## 5.10 Middleware — the code that runs first

`src/middleware.ts` wraps **every** request, page and endpoint alike, before any
page frontmatter or route handler executes:

```
browser → [ src/middleware.ts ] → page frontmatter / src/pages/api/* / Actions
```

```ts
export const onRequest = defineMiddleware(async (context, next) => {
  // …inspect the request…
  const response = await next()   // run the rest of the app
  // …or return a Response here to short-circuit it entirely
  return response
})
```

Two powers, and both matter:

- **`return next()`** continues to the page, and you can still modify the
  response it produced (this repo attaches `X-RateLimit-*` headers that way).
- **Returning a `Response` instead** short-circuits — the page never runs.

This is the natural home for anything cross-cutting: rate limiting (below),
authentication (`09-to-production.md` §9.5), request IDs, locale detection.

### Rate limiting

This repo limits `/api/*` and Action submissions:

```bash
for i in $(seq 1 140); do curl -s -o /dev/null -w '%{http_code} ' http://localhost:4321/api/health; done
```

You'll see `200`s until the budget runs out, then `429`s. Successful responses
carry the budget too, so a client can pace itself instead of discovering the
limit by hitting it:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 1788096465
```

…and a rejection adds `Retry-After: 27`.

**Page views are deliberately exempt.** Reading the site is cheap, and a reader
clicking through the docs must never see a 429. The abusable surface is the one
that writes. Prove it — 150 page loads, no throttling:

```bash
for i in $(seq 1 150); do curl -s -o /dev/null -w '%{http_code} ' http://localhost:4321/posts; done
```

Tune it in `apps/storefront/.env`. Set `RATE_LIMIT_MAX=5`, restart, and trip it
in five requests to see the behaviour end to end.

### Identifying the caller

The limiter keys on `context.clientAddress`, which the Node adapter supplies.

⚠️ **Behind a reverse proxy this is the proxy's address, not the client's** —
every visitor would share one bucket and one busy user would lock out everyone.
The fix is to read `X-Forwarded-For`, but only if you are certain your proxy
*overwrites* it: a client can otherwise forge the header and mint a fresh
identity per request, defeating the limiter entirely. This repo keeps the direct
address, because getting forwarded headers subtly wrong is worse than not doing
it at all.

### The limitation is the lesson

The counters live in a `Map` in **this process's memory**. So:

- they reset every time you restart
- a second instance keeps its own, making a limit of 120 an effective 240 — and
  a client can dodge it by being routed to the instance it hasn't hit yet

That is the same failure mode as Medusa's in-memory event bus and workflow
locking, which it warns about on every boot. Real answers: a shared store
(Redis), or limiting at the edge before the request reaches your app at all.
See [09-to-production.md](09-to-production.md).

Watch the counters on the dashboard at `/` — "requests checked", "blocked",
"tracked clients" — and see them reset when you restart the dev server.

---

## 5.11 Islands — the feature Astro is named for

Everything so far has shipped no client JavaScript. That is the default, and it
is the point. But Astro's headline feature is **islands**: static HTML with small
interactive regions hydrated individually.

This repo has exactly one, so you can measure it.

### Mounting one

```astro
---
import ReviewFilter from '../../components/ReviewFilter.tsx'
---
<ReviewFilter client:visible reviews={reviews} />
```

The `client:*` directive is what turns a component into an island. Without it, a
React component is **server-rendered to HTML and ships no JS at all** — which is
a legitimate and underused option.

| Directive | Hydrates | Use when |
|---|---|---|
| *(none)* | never — HTML only | you just want the component model |
| `client:idle` | when the main thread is free | nice-to-have interactivity |
| `client:visible` | when it scrolls into view | below-the-fold widgets ← used here |
| `client:load` | immediately | needed before first interaction |
| `client:only="react"` | client-side only, no SSR | depends on `window`/browser APIs |

### What it costs — measured, not estimated

From this repo's production build:

```
/_astro/client.*.js        179 kB   the React renderer
/_astro/react.*.js           7 kB   shared chunk
/_astro/ReviewFilter.*.js    2 kB   the component itself
─────────────────────────────────
                           188 kB   uncompressed, for one filter box
```

`/posts` — which does full create, edit and delete — ships **0 bytes**.

Reproduce it:

```bash
npm --prefix apps/storefront run build
PORT=4399 node apps/storefront/dist/server/entry.mjs &
curl -s localhost:4399/reviews | grep -oE 'component-url="[^"]+"|renderer-url="[^"]+"'
curl -s localhost:4399/posts   | grep -c astro-island      # 0
kill %1
```

⚠️ **Counting `<script>` tags undercounts an island.** Astro references the JS
through `astro-island` *attributes*, so `/reviews` reports a single script tag
while pulling 188 kB. Measure `component-url` and `renderer-url` instead.

### When an island is the right answer

The test: **does the interaction need client state the server cannot
pre-compute?**

- ✅ Filtering an already-loaded list — instant, local, no round trip
- ✅ A map, a chart with hover, a drag-and-drop reorder
- ❌ Submitting a form — that must reach the server anyway, so use an Action
  ([§5.4](#54-pattern-a--astro-actions-posts)) and ship nothing
- ❌ Showing or hiding a panel — CSS and `<details>` do that for free

The filter here is honest about being a marginal case: 188 kB to filter eleven
rows is a bad trade, made deliberately so the bill is visible. On a list of ten
thousand rows it would be obviously right.

**The lesson is not that islands are bad.** It is that `client:*` is an invoice,
and you should know the amount before you sign it.

---

## 5.12 Rendering rich text safely

```astro
<div class="prose" set:html={html} />
```

`set:html` is Astro's explicit opt-in to unescaped HTML — the equivalent of
React's `dangerouslySetInnerHTML`. It's safe **only** because
[`lexical.ts`](../../apps/storefront/src/lib/lexical.ts) escapes every text node
itself.

**Never pass raw CMS output into `set:html`.** If your renderer doesn't escape,
you've built a stored-XSS hole.

---

## 5.13 Your turn

- **Lab 9** — implement the same operation as both an Action and an endpoint
- Open [`reviews/index.astro`](../../apps/storefront/src/pages/reviews/index.astro)
  and read the `<script>` at the bottom — the only client JS in the app, and the
  concrete cost of Pattern B

---

## 5.14 Check yourself

1. Two valid values of `output`. Which is this repo and why?
2. Why does no env var here start with `PUBLIC_`?
3. A form omits an optional field. Why does `z.string().optional()` fail?
4. `/posts` ships 0 script tags but `/reviews` ships 1. Why?
5. Why does `DELETE` from curl need `Origin` when `PATCH` doesn't?
6. When do you use `sdk.client.fetch` instead of a typed SDK method?
7. Why are page views exempt from the rate limiter but `/api/*` is not?
8. Why does an in-memory limiter stop working at two instances?
9. A React component with no `client:*` directive — how much JS does it ship?
10. Why does counting `<script>` tags undercount an island?

---

**Next:** [06-labs.md](06-labs.md) — stop reading, start breaking things.
