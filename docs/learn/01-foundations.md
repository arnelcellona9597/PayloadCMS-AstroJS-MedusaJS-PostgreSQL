# 1 · Foundations — the vocabulary

> Reference counterpart: none. This chapter exists so the rest of the docs make
> sense. Read it once, then use [08-glossary.md](08-glossary.md) for lookups.

You do not need to memorise this. You need to have *met* these words once, so
that when `docs/architecture.md` says "module isolation" you are not reverse-
engineering the term while also learning the idea.

Every section ends with something you can run.

---

## 1.1 Headless, and what it replaced

**The old shape (a monolith).** WordPress, Magento, Shopify's Liquid themes. One
program owns the database, the business logic, *and* the HTML. You write PHP
templates that run inside it. Fast to start; the frontend and backend are welded
together. (Coming *from* WordPress? Every term in this course is mapped onto it
in [../from-wordpress/02-concept-map.md](../from-wordpress/02-concept-map.md).)

**The new shape (headless).** The backend owns data and logic and exposes it over
HTTP. It has no opinion about HTML. You build the frontend as a separate program.

"Headless" = **the head (the UI) has been cut off**. What's left is a body that
speaks JSON.

Why anyone bothers:

| | Monolith | Headless |
|---|---|---|
| Frontend tech | whatever the CMS uses | anything that can `fetch` |
| Same data on web + mobile + kiosk | awkward | natural — all are HTTP clients |
| Upgrade frontend without touching backend | no | yes |
| Number of programs to run and deploy | 1 | 3+ |
| Initial setup effort | low | **high** |

That last row is why this repo needs a course. Headless trades a hard problem
(coupling) for a tedious one (integration). You are learning to pay the tedious
cost efficiently.

**Composable / MACH** — marketing words for "several headless services combined".
That is exactly this repo: Payload for content, Medusa for commerce, Astro to
assemble them.

---

## 1.2 The three programs here

| | What it is | The one sentence that matters |
|---|---|---|
| **Payload** | headless CMS | You describe your data in a config file; it generates the database schema, REST + GraphQL APIs, and an admin UI. |
| **Medusa** | headless commerce engine | Pre-built commerce (products, carts, orders) plus a framework for adding your own isolated modules. |
| **Astro** | web framework | Renders HTML on the server, ships almost no JavaScript, and can host your own API routes. |

A useful mental sort: **Payload and Medusa are backends that came with a
database. Astro is a frontend that came with a server.**

---

## 1.3 Where HTML gets built: CSR vs SSR

This decides where your API keys live, so it is not a style question.

**CSR (client-side rendering)** — a React/Vue SPA. The server sends a near-empty
HTML file plus a JavaScript bundle. The browser runs it, fetches JSON, builds the
DOM.

```
browser ──▶ empty HTML + JS bundle
browser ──▶ fetch /api/posts  ──▶ backend
browser ──▶ builds the page
```

The consequence people miss: **the browser talks to your backend directly**, so
any credential it needs must be *shipped to the browser*. Anyone can read it in
DevTools.

**SSR (server-side rendering)** — this repo. The Astro server fetches the data,
builds the complete HTML, and sends finished markup.

```
browser ──▶ Astro server ──▶ Payload / Medusa
browser ◀── finished HTML
```

Now the *server* holds the credentials. The browser never sees them. That single
difference is why `apps/storefront/.env` has no `PUBLIC_` prefixes.

Other SSR benefits: content is in the HTML for search engines, and the first
paint doesn't wait on a JS bundle.

**SSG (static site generation)** — render at *build* time to plain files. Fastest
possible, but the data is frozen until you rebuild. Astro's default (`output:
'static'`); this repo uses `'server'` because every page shows live data.

Prove the difference:

```bash
curl -s http://localhost:4321/posts | grep -oE '<strong>[^<]+</strong>'
```

The post titles are already in the raw HTML — no JavaScript ran. A CSR app would
return nothing here, because its titles only appear after the browser executes a
bundle and fetches JSON.

(Use `grep -o`, not `grep -c`. Astro minifies the response onto very few lines, so
counting *lines* undercounts badly — `grep -c` reports `1` for four titles.)

---

## 1.4 BFF — Backend For Frontend

A **BFF** is a server that sits between your UI and your real backends. Not a
cache, not a gateway — a backend that exists *specifically to serve one
frontend*.

In this repo Astro is the BFF, and it earns its place three ways:

**1. It holds the credentials.** A visitor calling `/api/reviews` sends nothing.
Astro adds Medusa's publishable key server-side.

**2. It hides inconsistency.** Payload updates with `PATCH`; Medusa's admin API
updates with `POST`. Your pages call `updatePost()` / `updateReview()` and never
learn which. That translation lives in `apps/storefront/src/lib/`.

**3. It composes.** `GET /api/reviews?include_pending=true` merges Medusa's public
and admin surfaces into one response. No single Medusa route does that.

See it — no key in this request, real data back:

```bash
curl -s http://localhost:4321/api/reviews?limit=2 | head -c 200
```

And the same data straight from Medusa, refused:

```bash
curl -s http://localhost:9000/store/reviews
```

---

## 1.5 REST, enough of it

**REST** = using HTTP's own verbs and URLs to mean things, with JSON bodies.

| Verb | Means | Safe to repeat? |
|---|---|---|
| `GET` | read | yes — must change nothing |
| `POST` | create (or "do this thing") | **no** — twice = two records |
| `PUT` | replace the whole record | yes |
| `PATCH` | change some fields | yes |
| `DELETE` | remove | yes |

"Safe to repeat" is **idempotency**. It matters because networks retry. `GET`
twice is free; `POST` twice may charge a card twice.

Status codes, grouped by *who is at fault*:

| Code | Meaning | Whose fault |
|---|---|---|
| `200` / `201` | OK / created | — |
| `302` | redirect (you'll see this from Astro Actions) | — |
| `400` | malformed request | **caller** |
| `401` | not authenticated — *who are you?* | caller |
| `403` | authenticated but not allowed — *I know you, no* | caller |
| `404` | not found | caller |
| `422` | well-formed but semantically invalid | caller |
| `500` | the server crashed | **server** |
| `502` | the server's upstream failed | server |

Internalise **401 vs 403**: 401 means "log in", 403 means "logging in won't
help". You will see both in this repo, from different layers.

Try each:

```bash
curl -s -o /dev/null -w '%{http_code}  no publishable key\n' http://localhost:9000/store/reviews
curl -s -o /dev/null -w '%{http_code}  no admin token\n'     http://localhost:9000/admin/reviews
curl -s -o /dev/null -w '%{http_code}  no Payload API key\n' -X POST http://localhost:3000/api/posts -H 'Content-Type: application/json' -d '{"title":"x"}'
```

Expect `400`, `401`, `403` — three layers, three different refusals.

---

## 1.6 Databases: schema, ORM, migration

**Schema** — the shape of your tables: names, columns, types, constraints.

**ORM** (Object-Relational Mapper) — a library that lets you write
`createReviews({ rating: 5 })` instead of SQL. Payload uses **Drizzle**; Medusa
uses **MikroORM**. You will rarely touch either directly.

**Migration** — a versioned, ordered script that changes the schema. Two files
per change, conceptually: `up` (apply) and `down` (undo). They exist so that your
laptop, a colleague's laptop, and production all reach the *same* schema by the
same path.

The two backends disagree here, and it is the sharpest contrast in the repo:

| | Payload (dev) | Medusa (always) |
|---|---|---|
| How schema changes | `push` — diffs your config against the DB and applies it | you generate a migration file, then run it |
| Files created | none | one per change, committed to git |
| Speed | instant | ~3 commands |
| Rollback | none | `down()` |

Look at the one migration Medusa has written so far:

```bash
cat apps/commerce/src/modules/review/migrations/*.ts
```

Payload has no equivalent file, because `push` left no trace. That is convenient
and it is also the trade-off: **no record of how the schema got that way.**

⚠️ **A trap you will hit.** Payload's `push` adds columns but does *not* cleanly
remove them when you delete a field from the config. Worse, for a collection with
drafts enabled it writes to *two* tables (`posts` and the versions table
`_posts_v`), so a leftover column can block the next `npm run dev` on an
interactive "DATA LOSS WARNING — accept?" prompt. Cleanup is in
[07-troubleshooting.md](07-troubleshooting.md).

---

## 1.7 The container / dependency injection

Medusa gives you a **container**: a registry of services you ask for by name
instead of importing.

```ts
const reviewService = req.scope.resolve(REVIEW_MODULE)
const query        = req.scope.resolve(ContainerRegistrationKeys.QUERY)
```

Why not just `import ReviewService from '...'`? Because the container is what
makes a module *replaceable*. Medusa ships a default payment module you can swap
for your own without any calling code changing its imports. That indirection is
the price of that flexibility.

You will see `container.resolve(...)` constantly in `apps/commerce/`. Read it as
"give me the thing registered under this name".

---

## 1.8 Soft delete

A **soft delete** sets `deleted_at = now()` instead of running `DELETE`. The row
stays; queries filter it out automatically.

Every Medusa data model gets `created_at`, `updated_at` and `deleted_at` for
free, and `deleteReviews` is a soft delete.

Why it matters here: **soft deletes are trivially reversible**, which is what
makes a workflow's rollback one call (`restoreReviews`) instead of an attempt to
re-insert a row and reconstruct its id. See [04-medusa.md](04-medusa.md).

There are currently no soft-deleted rows; you will create one in Lab 6. The query
to look:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select id, status, deleted_at from review where deleted_at is not null;'
```

---

## 1.9 Four ways to prove who you are

This repo uses four different auth mechanisms. Beginners conflate them; knowing
which is which turns most 401/403s into five-second fixes.

| Mechanism | Looks like | Identifies | Used here for |
|---|---|---|---|
| **API key** | `Authorization: users API-Key <key>` | a machine acting as a user | Astro → Payload |
| **Publishable key** | `x-publishable-api-key: pk_…` | a *sales channel*, not a person | Astro → Medusa `/store/*` |
| **JWT** (bearer token) | `Authorization: Bearer eyJ…` | a logged-in user, for a while | Astro → Medusa `/admin/*` |
| **Session cookie** | `Cookie: …` sent automatically | a browser session | you in the two admin panels |

Three things worth knowing:

- **A JWT is not encrypted**, only *signed*. Anyone can read its contents; nobody
  can forge one without the secret. Never put secrets in a JWT payload.
- **A publishable key is not a password.** It says "this request belongs to the
  web store", so it is safe in a browser — and useless for reaching `/admin/*`.
- **Cookies are sent by the browser automatically**, which is exactly why CSRF
  protection exists (§1.10).

Get a JWT and look at it:

```bash
curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"supersecret"}'
```

---

## 1.10 CSRF, in one paragraph

Because browsers attach cookies automatically, `evil.com` can submit a form to
`yourbank.com` and the browser helpfully includes your session cookie. That is
**Cross-Site Request Forgery**. The standard defence is to check the `Origin`
header: a request that claims to come from your own site but says otherwise gets
rejected.

Astro does this for you, which is why `DELETE /api/reviews/:id` from curl returns
`403 Cross-site DELETE form submissions are forbidden` until you add
`-H 'Origin: http://localhost:4321'`. Your browser was already sending it.

---

## 1.11 Environment variables

Config that changes between machines — database URLs, secrets — lives in `.env`
files, not in code, so the same code runs anywhere.

Two rules that matter here:

1. **`.env` is never committed.** It holds secrets. `.env.example` is committed as
   a template. Check `.gitignore` — `.env` is listed.
2. **Frontend frameworks split public from private by prefix.** Astro exposes only
   `PUBLIC_*` to the browser; Next uses `NEXT_PUBLIC_*`. Everything else stays
   server-side. That prefix is a security boundary, not a naming convention.

Each app reads its own file — see [02-infrastructure.md](02-infrastructure.md).

---

## 1.12 Check yourself

Answer these before moving on. If one is fuzzy, reread that section.

1. Why can this repo keep API keys out of the browser, when a React SPA cannot?
2. What is the difference between `401` and `403`?
3. Payload needed no migration to add a field. What did you give up?
4. Why does the review module have no `product_id` column? *(Educated guess is
   fine — [04-medusa.md](04-medusa.md) answers it.)*
5. Which is safe in a browser: a publishable key or an admin JWT?
6. What does `req.scope.resolve('review')` do, and why not `import`?

---

**Next:** [02-infrastructure.md](02-infrastructure.md) — the machinery: Docker,
Postgres, ports, env files, logs, and how to recover when it breaks.
