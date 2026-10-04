# Every endpoint in the stack

Three services, three auth models, two update-verb conventions.

Runnable versions of all of it: [`requests.http`](requests.http) for VS Code's
REST Client, or an importable **Postman collection** with assertions in
[`../postman/`](../postman/README.md) — 49 requests, `npm run postman:test`.

**Rate limiting.** `/api/*` and Astro Actions are limited to 120 req/min per IP;
Medusa's `/store/*` to 240 req/min per publishable key. Every response carries
`X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a `429`
adds `Retry-After`. Page views and `/admin/*` are not limited. Tune via
`RATE_LIMIT_MAX` / `RATE_LIMIT_STORE_MAX`.

**Auth headers at a glance**

| Target | Header |
|---|---|
| Payload, authenticated | `Authorization: users API-Key <key>` |
| Medusa `/store/*` | `x-publishable-api-key: pk_...` |
| Medusa `/admin/*` | `Authorization: Bearer <jwt>` |
| Astro `/api/*` | **none** — it holds the credentials for you |

Get the keys from `npm run seed` (`apps/cms`) and `npm run bootstrap`
(`apps/commerce`).

---

## Payload — http://localhost:3000

Everything here except `/stats` is **generated** from
`apps/cms/src/collections/*.ts`. No handler was written for it.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/posts` | optional | Anonymous → published only. With key → drafts too. |
| `POST` | `/api/posts` | **required** | 403 without a user. |
| `GET` | `/api/posts/:id` | optional | |
| `PATCH` | `/api/posts/:id` | **required** | Payload's update verb. |
| `DELETE` | `/api/posts/:id` | **admin role** | Stricter than update, on purpose. |
| `GET` | `/api/posts/count` | optional | |
| `GET` | `/api/posts/stats` | optional | **Hand-written.** Local API aggregate. |
| `GET` | `/api/categories` | optional | Same generated set as posts. |
| `GET` | `/api/media` | optional | `+ /api/media/file/:filename` for binaries. |
| `POST` | `/api/users/login` | — | Returns a JWT and sets a cookie. |
| `GET` | `/api/users/me` | optional | |
| `POST` | `/api/graphql` | optional | `/api/graphql-playground` for the UI. |

### Query parameters

| Param | Example | Effect |
|---|---|---|
| `where` | `?where[title][contains]=CRUD` | Filter. Operators: `equals`, `not_equals`, `greater_than`, `less_than`, `like`, `contains`, `in`, `exists`. |
| `depth` | `?depth=1` | Relationship expansion. `0` → ids, `1` → documents, `2` → their relationships too. |
| `limit` / `page` | `?limit=10&page=2` | Pagination. |
| `sort` | `?sort=-updatedAt` | `-` prefix reverses. |
| `select` | `?select[title]=true` | Restrict returned fields. |
| `draft` | `?draft=true` | Latest draft instead of published (needs auth). |

> **curl:** pass `-g`. Otherwise curl reads `[` as a glob range and refuses:
> `bad range in URL position`.

### Response shapes

```jsonc
// list
{ "docs": [...], "totalDocs": 4, "limit": 10, "page": 1,
  "totalPages": 1, "hasNextPage": false, "hasPrevPage": false }

// create / update  ← note the envelope; a read returns the document bare
{ "message": "Post successfully created.", "doc": { "id": 5, ... } }

// error
{ "errors": [ { "message": "The following field is invalid: title" } ] }
```

---

## Medusa store surface — http://localhost:9000/store

`x-publishable-api-key` is **required on every route here**, custom ones
included. Omit it and you get `400 not_allowed`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/store/products` | Built in. `?fields=id,title,handle`, `?handle=managed-postgresql`. |
| `GET` | `/store/products/:id` | Built in. |
| `GET` | `/store/reviews` | **Custom.** Approved only. `?limit`, `?offset`, `?order`, `?product_id`. |
| `POST` | `/store/reviews` | **Custom.** Runs `createReviewWorkflow`. Always lands `pending`. |
| `GET` | `/store/reviews/:id` | **Custom.** Approved only — a pending review is a 404, not a 403. |
| `GET` | `/store/products/:id/reviews` | **Custom.** Reads across the module link, with aggregate stats. |

Custom routes live in `apps/commerce/src/api/store/`.

### `POST /store/reviews`

```jsonc
{
  "product_id": "prod_...",   // must exist — checked in workflow step 1
  "title": "…",               // 3–200
  "content": "…",             // 10–4000
  "rating": 5,                 // integer 1–5
  "author_name": "…",         // 1–120
  "author_email": "…"         // optional
}
```

`status` is **not accepted**. The schema is `.strict()`, so sending it returns
`Invalid request: Unrecognized fields: 'status'` — a public caller cannot
self-publish.

### `GET /store/products/:id/reviews`

```jsonc
{
  "product": { "id": "prod_...", "title": "Managed PostgreSQL", "handle": "managed-postgresql" },
  "reviews": [ { "id": "…", "title": "…", "rating": 5, "author_name": "…" } ],
  "stats": { "count": 2, "average": 4.5,
             "distribution": { "1": 0, "2": 0, "3": 0, "4": 1, "5": 1 } }
}
```

`author_email` and `status` are stripped. The route enumerates its `query.graph`
fields rather than using `reviews.*`, so a column added to the model later cannot
silently start leaking.

---

## Medusa admin surface — http://localhost:9000/admin

Requires an authenticated admin. The publishable key is not enough → `401`.

```bash
curl -s -X POST http://localhost:9000/auth/user/emailpass \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@local.test","password":"supersecret"}'
```

| Method | Path | Notes |
|---|---|---|
| `GET` | `/admin/reviews` | All statuses. `?status`, `?product_id`, `?q`, `?limit`, `?offset`, `?order`. |
| `POST` | `/admin/reviews` | Create. May set `status` (defaults `approved`). |
| `GET` | `/admin/reviews/:id` | Every column, including `author_email`. |
| `POST` | `/admin/reviews/:id` | **Update.** POST, not PATCH — Medusa's convention. |
| `DELETE` | `/admin/reviews/:id` | **Soft** delete. Row stays with `deleted_at` set. |
| `GET` | `/admin/uptime` | Uptime history. `?hours=1..168`. |
| `GET` | `/admin/workflows` | Workflow executions by state. `?state`, `?limit`. |
| `GET` | `/admin/schema` | Introspects Medusa's own database. |

`?q=` searches `title`, `content` and `author_name` with `ILIKE`.

An empty update body is rejected by `.refine()`:
`Invalid request: Provide at least one field to update.` — a silent no-op reads as
a bug at the call site.

Approving is all it takes for a review to appear publicly; the store routes filter
on status at read time.

```bash
# the row survives a delete
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select id, status, deleted_at from review where deleted_at is not null;'
```

---

## Astro — http://localhost:4321/api

**No credentials on any of these.** Astro adds them server-side.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/health` | Both backends. `200` if both up, `503` otherwise. |
| `GET` | `/api/reviews` | Store surface. `?include_pending=true` switches to admin. |
| `POST` | `/api/reviews` | Accepts **JSON or form** encoding. |
| `GET` | `/api/reviews/:id` | `?admin=true` for any status. |
| `PATCH` | `/api/reviews/:id` | Translated to Medusa's `POST`. |
| `DELETE` | `/api/reviews/:id` | Needs an `Origin` header — see below. |
| `POST` | `/api/reviews/:id/moderate` | `{ "status": "approved" }`. Same effect as PATCH, named as an intent. |
| `GET` | `/api/monitor` | Recent requests + summary. `?klass=2xx\|4xx\|5xx\|errors`, `?path`, `?limit`. |
| `GET` | `/api/logs` | Log lines from all three services. `?level`, `?service`, `?search`, `?limit`. |

The last two are **exempt from the rate limiter and from the request log**, from
one shared list in `src/middleware.ts` — a tool that measures the system must not
become part of what it measures, and must not be throttled by the limiter it
reports on. See [12 · Operating it](learn/12-operating-it.md).

Consistent error envelope, unlike the two upstreams:

```jsonc
{ "error": { "message": "Validation failed.",
             "detail": { "rating": ["Too big: expected number to be <=5"] } } }
```

Status codes: `400` unparseable · `404` not found · `422` validation ·
`502` upstream failure.

> **`403 Cross-site DELETE form submissions are forbidden`** — Astro's CSRF check
> needs `Origin` on `DELETE`:
> ```bash
> curl -X DELETE http://localhost:4321/api/reviews/<id> \
>   -H 'Origin: http://localhost:4321'
> ```
> Browsers send it automatically. `POST`/`PATCH` with
> `Content-Type: application/json` are exempt.

### Astro Actions

Not conventional REST — reached at `?_action=<name>` on the page rendering the
form. This is what a browser submits with JavaScript disabled.

| Action | Form target | Result |
|---|---|---|
| `post.create` | `POST /posts/new?_action=post.create` | `302 → /posts?created=<id>` |
| `post.update` | `POST /posts/:id/edit?_action=post.update` | `302 → /posts?updated=<id>` |
| `post.delete` | `POST /posts?_action=post.delete` | `200`, page re-renders with a notice |

An `Origin` header is required. On validation failure you get `200` and the page
re-renders with per-field errors inline — not a `4xx`.

---

## The same operation, three ways

Updating a record, to make the conventions concrete:

```bash
# Payload — PATCH, API key
curl -X PATCH http://localhost:3000/api/posts/1 \
  -H 'Authorization: users API-Key <key>' \
  -H 'Content-Type: application/json' \
  -d '{"title":"New title"}'

# Medusa — POST, admin JWT
curl -X POST http://localhost:9000/admin/reviews/<id> \
  -H "Authorization: Bearer <jwt>" \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved"}'

# Astro BFF — PATCH, no credentials
curl -X PATCH http://localhost:4321/api/reviews/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved"}'
```

Three verbs, three auth schemes, one operation. Normalising that is exactly what
`apps/storefront/src/lib/` is for.
