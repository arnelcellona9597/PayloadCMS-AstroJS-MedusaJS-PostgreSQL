# 9 · To production

> This chapter is **not implemented in the repo**. Everything before it describes
> code you can run; this describes what you would change. Treat it as a checklist
> and a map, not a tutorial to copy.

This repo is a teaching environment. It is deliberately missing things you cannot
skip in production. Knowing exactly *what* is missing — and why each matters — is
part of being expert in a stack.

---

## 9.1 The honest gap

| Area | Here | Production needs |
|---|---|---|
| Payload schema | `push` (auto-sync) | migrations, `push: false` |
| Medusa infra | **Redis** — event bus, locking, cache, sessions, workflow state | same, managed and with failover |
| Secrets | `dev-only-…` in `.env`, examples committed | a secret manager |
| Storefront auth | **none** — anyone can delete anything | real authentication |
| Caching | none; every page hits both backends | HTTP caching + invalidation |
| Transport | HTTP | HTTPS everywhere |
| Deployment | `npm run dev` × 3 | built images, a process manager |
| Observability | [/monitor](http://localhost:4321/monitor) — uptime, requests, workflows, logs | structured logs, metrics, tracing, alerts |
| Backups | `npm run db:export`, run by hand | automated, off-site, **restored on a schedule** |
| Rate limiting | in-memory, per-process | shared store or at the edge |

Redis is done ([§9.3](#93-medusa-you-need-redis)), and backups and monitoring
now exist in a first form ([12 · Operating it](12-operating-it.md)). **The one
that will bite first is now schema management** — Payload's `push` mode leaves
no migration history, which is also why a restored dump can silently disagree
with the running code ([§12.5](12-operating-it.md)).

---

## 9.2 Payload: turn off `push`

`push` is a development convenience. In production it is dangerous: it infers
schema changes and can drop columns.

```ts
db: postgresAdapter({
  pool: { connectionString: process.env.DATABASE_URL },
  push: false,          // ← the important line
})
```

Then adopt the migration workflow:

```bash
npm --prefix apps/cms run payload -- migrate:create   # after changing fields
npm --prefix apps/cms run payload -- migrate          # on deploy
npm --prefix apps/cms run payload -- migrate:status
```

Commit the generated files. Your deploy runs `migrate` before starting the app.

⚠️ **Switching to `push: false` on a database built by `push` needs care.** The
schema exists but no migration history does. Create a baseline migration
representing the current state and mark it applied, or your first `migrate` will
try to create tables that already exist. Do this on a copy first.

---

## 9.3 Medusa: you need Redis

**This chapter used to describe Redis as a thing you would do later. It is now
configured in this repo** — see `apps/commerce/medusa-config.ts`. The section is
kept because the *reasoning* is the transferable part, and because getting it
wrong cost four separate boot failures worth writing down.

### What the in-memory fallbacks actually cost

On a fresh Medusa install these warnings appear on every boot:

```
info: redisUrl not found. A fake redis instance will be used.
warn: Local Event Bus installed. This is not recommended for production.
info: Locking module: Using "in-memory" as default.
```

They mean four subsystems are running in-process:

**Event bus.** Events (`order.placed`, `review.created`) are delivered inside one
Node process. Run two instances and each sees only its own events — subscribers
fire inconsistently or not at all.

**Locking.** Workflows use locks to prevent concurrent runs colliding. In-memory
locks are invisible to other instances, so **two instances can run the same
workflow simultaneously** on the same order. A scheduled job runs once *per
instance*: "email the moderator a digest" becomes two emails.

**Cache.** Per-process, so hit rates collapse and instances disagree.

**Workflow engine.** The one that is easy to miss, because it fails silently:
the in-memory engine **does not persist executions at all**. The
`workflow_execution` table exists and stays permanently empty, even after
workflows have run and failed. Ask it how many workflows failed and it answers
zero — whether none failed or all of them did.

That is worse than having no monitoring, because it is monitoring that is
reliably reassuring. It is also why `/admin/workflows` and the Operations page
could not have existed before this change; see
[12 · Operating it](12-operating-it.md).

### The configuration, and four traps in it

```ts
import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

modules: [
  { key: Modules.CACHE,     resolve: '@medusajs/cache-redis',
    options: { redisUrl: process.env.REDIS_URL } },

  { key: Modules.EVENT_BUS, resolve: '@medusajs/event-bus-redis',
    options: { redisUrl: process.env.REDIS_URL } },

  { key: Modules.WORKFLOWS, resolve: '@medusajs/workflow-engine-redis',
    options: { redis: { url: process.env.REDIS_URL } } },   // NOT redisUrl

  { key: Modules.LOCKING,   resolve: '@medusajs/locking',
    options: { providers: [{ resolve: '@medusajs/locking-redis',
                             id: 'locking-redis', is_default: true,
                             options: { redisUrl: process.env.REDIS_URL } }] } },
]
```

**Trap 1 — they are separate packages, not subpaths.** The resolve string is
`@medusajs/cache-redis`. An earlier version of this chapter said
`@medusajs/medusa/cache-redis`, which does not exist; it was written from memory
rather than checked, and it would fail at boot. They are also present in
`node_modules` only *transitively*, so they must be declared as direct
dependencies in `apps/commerce/package.json` or the next clean install breaks.

**Trap 2 — each needs an explicit `key`.** These modules REPLACE a built-in, so
Medusa must be told which one. Omit it and you get:

```
Module @medusajs/cache-redis doesn't have a serviceName.
Please provide a 'key' for the module
```

…which does not obviously mean "add `key`". Take the keys from the `Modules`
enum rather than typing the strings.

**Trap 3 — locking is a host plus a provider.** `@medusajs/locking-redis` is a
*provider*, not a module. Resolve it directly and Medusa starts, then fails when
something needs a lock:

```
No service found in module Locking
```

The module is `@medusajs/locking`, and the Redis package goes inside its
`providers` array. Same shape as file or notification providers.

**Trap 4 — the deprecation warning is wrong, for the workflow engine.** It says
to use `redisUrl`. Follow it and boot fails:

```
Cannot destructure property 'url' of 'undefined'
```

The workflow engine still requires the nested `redis: { url }` form in 2.19.0.
The other three modules genuinely do take `redisUrl`, so the inconsistency is
real and the warning is premature. **A deprecation notice is a claim about a
future version, not a guarantee about the one you are running.**

### One more thing, or the table stays empty anyway

Redis alone is not enough. Even the Redis engine discards an execution once it
finishes, unless that workflow opted in:

```ts
createWorkflow(
  { name: CREATE_REVIEW_WORKFLOW, store: true, retentionTime: 3600 },
  (input) => { /* … */ }
)
```

Retention is **per workflow**, not global. Miss it and `/admin/workflows`
returns an empty list that looks like good news — the same failure as before,
with more infrastructure behind it.

### What this changed about the rest of this chapter

The claim that used to be here — *"without Redis you cannot run more than one
Medusa instance"* — is now **conditional rather than absolute**. With Redis
configured, Medusa can scale horizontally: events reach every instance, locks
are shared, and the scheduled uptime job runs once rather than once per
instance.

Two things in §9.2 and §9.7 still block it, and they are unrelated to Redis:
local-disk file storage (§9.7) and the absence of migrations in Payload's dev
`push` mode (§9.2). Redis removed one blocker of three.

Note also that Astro's rate limiter (§9.7b) is **still in-memory and
per-process**. It could now share state through Redis, and deliberately does
not: its limitation is the lesson, and a working demonstration of why
per-process counters break under scaling is worth more here than one fewer
caveat. That is a teaching choice, not a recommendation.

For local use, Redis is already in `infra/docker-compose.yml`:

```yaml
  redis:
    image: redis:7-alpine
    container_name: apm-redis
    ports: ["6379:6379"]
    command: ["redis-server", "--save", "", "--appendonly", "no"]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
```

Persistence is switched off on purpose: everything here is a cache, a queue or
resumable workflow state, and a durable Redis would imply the data is safe there
when Postgres is the system of record.

Verify it is actually engaged, rather than assuming:

```bash
docker exec apm-redis redis-cli keys '*' | head
```

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c "select workflow_id, state, count(*) from workflow_execution group by 1,2;"
```

The first shows Medusa's keys; the second is the real proof, because it is the
thing that was impossible before.

---

## 9.4 Secrets

Right now: `postgres`/`postgres`, `dev-only-jwt-secret-change-me`, and
`.env.example` files committed with real-looking values.

**Rules:**

1. **Generate them.** `openssl rand -base64 32` per secret, per environment.
2. **Never commit them.** `.env` is gitignored; keep it that way.
3. **Use a secret manager** — AWS Secrets Manager, Vault, Doppler, or your
   platform's encrypted env vars — injected at deploy time.
4. **Rotate deliberately.** Changing `PAYLOAD_SECRET` invalidates every session
   and API key. Changing Medusa's `JWT_SECRET` logs out every admin.
5. **Separate per environment.** Staging must not be able to read production.

Which secrets exist here:

| Variable | App | Effect of rotating |
|---|---|---|
| `PAYLOAD_SECRET` | cms | invalidates sessions **and API keys** |
| `JWT_SECRET` | commerce | logs out all admins |
| `COOKIE_SECRET` | commerce | invalidates cookies |
| `DATABASE_URL` | both | connection change |
| `PAYLOAD_API_KEY` | storefront | must match a Payload user's key |
| `MEDUSA_PUBLISHABLE_KEY` | storefront | must match a Medusa key |

---

## 9.5 The storefront has no authentication

Worth stating bluntly: **any visitor can create, edit and delete every post and
review.** That is fine for learning and unacceptable otherwise.

The natural place to fix it is Astro **middleware** (`src/middleware.ts`), which
runs before every request:

```ts
export const onRequest = defineMiddleware(async (context, next) => {
  const protectedPath = context.url.pathname.startsWith('/posts/new')
    || context.url.pathname.endsWith('/edit')
    || context.url.pathname.startsWith('/api/')

  if (protectedPath && !(await getSession(context.cookies))) {
    return context.redirect('/login')
  }

  return next()
})
```

Options for the session itself:

- **Reuse Payload's auth.** It already has users, login, and cookies —
  `POST /api/users/login` and validate with `payload.auth()`. Fewest moving parts
  given Payload is already there.
- **A dedicated auth provider** (Auth.js, Clerk, WorkOS) if you need SSO or social
  login.

Whichever you choose, protect **both** the pages *and* `src/pages/api/*`. Guarding
only the UI leaves the endpoints wide open — and they're the ones that take
`DELETE`.

---

## 9.6 Caching

Every page currently re-fetches from both backends on every request. Three layers
to add, cheapest first:

**1 · HTTP caching for public pages.** Blog content changes rarely:

```ts
return new Response(html, {
  headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
})
```

`stale-while-revalidate` is the useful part: serve the stale copy instantly while
refreshing in the background.

**2 · Invalidation on write.** `Posts.afterChange` in
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
currently logs. That log line is a deliberate placeholder — it is exactly where a
purge belongs:

```ts
afterChange: [async ({ doc }) => {
  await fetch(`${process.env.STOREFRONT_URL}/api/revalidate`, {
    method: 'POST',
    headers: { 'x-revalidate-secret': process.env.REVALIDATE_SECRET! },
    body: JSON.stringify({ slug: doc.slug }),
  })
}]
```

Authenticate that endpoint. An unauthenticated purge route is a free
cache-busting DoS.

**3 · Application caching.** Redis for expensive aggregates — the `/products`
ratings N+1 ([05](05-astro.md#59-the-n1-on-products)) is the obvious candidate.
Better still, fix the N+1 with a batched `query.graph` route first; cache what
remains slow.

---

## 9.7 Deployment shape

Three services, three databases-worth of state, one frontend:

```
                    ┌──────────────┐
   internet ───────▶│  CDN / edge  │  TLS, rate limiting, static assets
                    └──────┬───────┘
                           ▼
                    ┌──────────────┐
                    │   Astro      │  N instances, stateless
                    └───┬──────┬───┘
                        ▼      ▼
              ┌─────────┐    ┌──────────┐
              │ Payload │    │  Medusa  │  1 instance without Redis
              └────┬────┘    └────┬─────┘
                   ▼              ▼
              ┌─────────────────────────┐
              │ Postgres  +  Redis      │  managed, backed up
              └─────────────────────────┘
```

Notes that matter:

- **Astro is stateless** — scale it freely.
- **Medusa is not**, until Redis is in place (§9.3).
- **Payload is stateless** apart from uploads. `staticDir: 'public/media'` writes
  to local disk, which breaks with more than one instance **and loses files on
  redeploy**. Move to S3-compatible storage via
  `@payloadcms/storage-s3` before scaling or containerising.
- Run each app's `build`, not `dev`:

  ```bash
  npm --prefix apps/cms        run build && npm --prefix apps/cms run start
  npm --prefix apps/commerce   run build && npm --prefix apps/commerce run start
  npm --prefix apps/storefront run build && node apps/storefront/dist/server/entry.mjs
  ```

- Give each a container with a **healthcheck**. Astro's `/api/health` already
  returns `503` when a backend is down, so it is usable as a readiness probe as-is.
- Migrations run **before** the app starts, as a separate deploy step — not on
  boot, or N instances race each other.

---

## 9.7b Rate limiting — what exists, and why it is not enough

The repo now limits two surfaces:

| Surface | Default | Where |
|---|---|---|
| Astro `/api/*` and Actions | 120 / min per IP | `apps/storefront/src/middleware.ts` |
| Medusa `/store/*` | 240 / min per publishable key | `apps/commerce/src/api/middlewares.ts` |

Both emit `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and
`Retry-After` on rejection. Page views and `/admin/*` are deliberately exempt.

**Three reasons this is not production-grade:**

**1. The counters are in-memory.** Each process keeps its own `Map`. Two
instances behind a load balancer means two independent budgets — a limit of 120
becomes an effective 240, and a client can dodge it by landing on whichever
instance it has not hit yet. A restart wipes every bucket.

**2. It runs too late.** The request has already reached your application, been
parsed, and occupied a Node event-loop slot. A limiter's job is to protect the
expensive thing, and by the time this one says no, most of the cost is spent.
Under an actual flood, in-process limiting fails exactly when you need it.

**3. The client identity is weak.** `context.clientAddress` behind a proxy is the
*proxy's* address, so every visitor shares one bucket. Fixing that means trusting
`X-Forwarded-For`, which is only safe if your proxy overwrites it — otherwise a
client forges a new identity per request and the limiter does nothing.

**What to do instead**, in order of preference:

- **Limit at the edge.** Cloudflare, an ALB, nginx `limit_req`, or an API
  gateway. Rejects before your app is involved, sees the true client IP, and
  works across every instance for free.
- **A shared store.** Redis with a sliding-window or token-bucket script, so all
  instances share one budget. Keep the in-process limiter as a cheap second layer.
- **Per-identity, not just per-IP.** Once you have authentication (§9.5), limit
  per API key or per user for authenticated routes — an IP is a poor proxy for a
  person, and NAT makes it a poor proxy for a household or an office.

Keep the in-process limiter regardless. It is a useful backstop against a runaway
client of your own making, and it costs nothing.

---

## 9.8 Observability

Terminal logs don't survive a restart, let alone an incident.

**Partly built now.** [/monitor](http://localhost:4321/monitor) covers uptime,
request rates and classes, workflow states, log levels and backup age — see
[12 · Operating it](12-operating-it.md) for how each signal is collected and
where each one is blind. What follows is what it still is not:

- **Structured logs.** Both backends use pino-compatible loggers; emit JSON and
  ship it somewhere queryable.
- **Request ids.** Generate one in Astro middleware, forward it to both backends,
  log it everywhere. Without this you cannot reconstruct a single user's request
  across three services — which is the whole difficulty of debugging a
  distributed system.
- **Metrics.** Request rate, error rate, p95 latency per service; workflow
  success/compensation counts; DB connections.
- **Alerts** on error rate and on `/api/health` returning 503. This is the
  biggest remaining gap: every signal on `/monitor` requires a human to open the
  page. Monitoring that nobody is looking at is documentation.
- **Tracing** (OpenTelemetry) once three services stop being enough to reason
  about by hand.
- **Off-box storage.** The request log lives in one Node process and the log
  viewer reads local files — both work only because everything shares a machine
  in development, and neither survives a second instance.

---

## 9.9 Backups

**A first version exists**: `npm run db:export` and `npm run db:import`, covered
in [12 §12.5](12-operating-it.md). It already handles the four things that make
naive dump-and-restore dangerous — version skew, schema drift, active
connections, and verifying the restore against recorded row counts.

Still needed for production:

- **Automated and scheduled.** Ours runs when you remember to run it, which is
  the failure mode every backup strategy starts with.
- **Off the machine.** A backup on the same disk as the database protects
  against `db:reset`, not against losing the disk.
- **Restored on a schedule, not just once.** An untested backup is a hypothesis;
  a backup tested once is a hypothesis about code that has since changed. Ours
  has been restored for real (into a deliberately emptied volume), which is the
  minimum bar, not the goal.
- Back up **both** databases — they are separate, and a partial restore leaves
  Medusa's link tables pointing at reviews that exist while Payload's content is
  from a different day. `db:export` always writes both, for this reason.
- Media files too, if you keep them outside Postgres (you should — §9.7). Ours
  tars `apps/cms/public/media`, which is a workaround for local-disk storage
  rather than a solution to it.

---

## 9.10 What breaks first, in order

From experience with stacks shaped like this:

1. **A second Medusa instance without Redis.** Duplicate or missing events,
   colliding workflows. Silent and confusing.
2. **Media on local disk.** Files vanish on redeploy.
3. **The `/products` N+1.** Sixteen requests for fifteen products; not viable at 400.
4. **Rate limits that do not survive scaling.** The in-memory limiter silently
   doubles when you add an instance, so the protection you tested is not the
   protection you have (§9.7b).
5. **Unbounded queries.** `limit=100` looks harmless until a collection grows.
   Paginate everywhere.
6. **No cache invalidation strategy.** Either everything is stale or nothing is
   cached.
7. **Schema drift** between environments, because someone ran `push` against
   staging.

---

## 9.11 A pre-launch checklist

**Security**
- [ ] All secrets regenerated, none committed, none shared across environments
- [ ] Storefront authentication on pages **and** `/api/*`
- [ ] HTTPS everywhere; CORS lists real origins, not `localhost`
- [ ] Rate limiting **at the edge**, not only the in-process limiter (§9.7b)
- [ ] Payload access rules reviewed — is `read: () => true` correct for each?

**Data**
- [ ] `push: false`, migrations committed, deploy runs them as a separate step
- [ ] Backups automated **and a restore rehearsed**
- [ ] Media on object storage

**Reliability**
- [ ] Redis for cache, event bus and workflow engine
- [ ] Healthchecks wired to the orchestrator
- [ ] Structured logs with request ids; alerts on error rate
- [ ] Load tested at expected peak

**Correctness**
- [ ] `npm run typecheck` clean in CI
- [ ] Workflow compensation paths tested, not just happy paths
- [ ] Every list endpoint paginated

---

## 9.12 Where to go from here

You have finished the course. The most valuable next step is to **build something
of your own** on this stack — the suggestions at the end of
[06-labs.md](06-labs.md) are ordered by difficulty.

Then read the official docs properly. They make far more sense now that you have
a working mental model to hang them on:

- Payload — <https://payloadcms.com/docs>
- Medusa — <https://docs.medusajs.com>
- Astro — <https://docs.astro.build>

And revisit the "what expert means" checklist in
[README.md](README.md#what-expert-in-this-stack-actually-means). If every box is
ticked honestly, you are there.
