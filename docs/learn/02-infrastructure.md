# 2 · Infrastructure — the machinery

> Reference counterpart: [`../../README.md`](../../README.md) §Layout, and
> [`../../infra/docker-compose.yml`](../../infra/docker-compose.yml).

Most "I'm stuck" moments in a headless stack are not code problems. They are
*which process is dead, which port is taken, which `.env` did it read* problems.
This chapter makes the machinery visible so those stop costing you afternoons.

---

## 2.1 What is actually running

Four processes. Three are Node; one is a Docker container.

```
┌─ your machine ────────────────────────────────────────────────┐
│                                                               │
│  node  apps/storefront   Astro         :4321                  │
│  node  apps/cms          Next+Payload  :3000                  │
│  node  apps/commerce     Medusa        :9000                  │
│                                                               │
│  ┌─ docker ──────────────────────────────────────────┐        │
│  │  apm-postgres   postgres:17-alpine   :5433 → 5432 │        │
│  │     ├── payload_crud    (Payload only)            │        │
│  │     └── medusa_crud     (Medusa only)             │        │
│  └───────────────────────────────────────────────────┘        │
└───────────────────────────────────────────────────────────────┘
```

`npm run dev` starts the three Node processes together using **concurrently**,
prefixing each line of output with `[cms]`, `[commerce]` or `[storefront]`. The
container is separate and started by `npm run db:up` (which `setup` does for you).

**The container keeps running when you stop `npm run dev`.** That is deliberate —
restarting Postgres on every code change would be slow and would not help. Check
both layers independently:

```bash
docker ps --filter name=apm-postgres --format '{{.Names}}  {{.Status}}'
ss -ltn | grep -E ':(3000|9000|4321) '
```

---

## 2.2 Why three separate npm projects, not a workspace

Each app has its own `package.json` and its own `node_modules`. The root
`package.json` contains **no shared dependencies** — only scripts that shell into
each app.

This is a deliberate choice, and worth understanding because most tutorials tell
you to use a pnpm/npm workspace:

- **Medusa** builds into its own `.medusa/` directory and resolves plugins from a
  layout it expects. Hoisted workspace `node_modules` breaks it in ways whose
  error messages point nowhere useful.
- **Payload + Next** and **Astro** each want their own resolution too.
- The cost of *not* sharing is duplicated disk. The cost of sharing is hours lost
  to module-resolution bugs.

Practical consequence: **run `npm install` inside the app you're working on**, not
at the root. The root install only fetches `concurrently`.

```bash
npm --prefix apps/cms install     # right
npm install                       # only installs the root's own devDependency
```

---

## 2.3 The Docker Compose file, line by line

[`infra/docker-compose.yml`](../../infra/docker-compose.yml):

```yaml
services:
  postgres:
    image: postgres:17-alpine        # pinned major version; -alpine = small
    container_name: apm-postgres     # fixed name, so docker exec is predictable
    restart: unless-stopped          # survives a reboot; stops when you say stop
    environment:
      POSTGRES_USER: postgres        # superuser created on first boot
      POSTGRES_PASSWORD: postgres    # fine locally; never in production
      POSTGRES_DB: postgres          # the default database
    ports:
      - "5433:5432"                  # HOST:CONTAINER  ← see below
    volumes:
      - apm-pgdata:/var/lib/postgresql/data     # where the data actually lives
      - ./init:/docker-entrypoint-initdb.d:ro   # first-boot SQL
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
```

Three of those lines deserve attention.

**`"5433:5432"` — port mapping.** Inside the container Postgres listens on its
normal 5432. Docker forwards **your machine's 5433** to it. The mapping is
`host:container`, and getting it backwards is a classic beginner error.

Why 5433 and not 5432? Because this machine already runs a system PostgreSQL on
5432. Binding 5433 means this project never collides with it. **A container's
port is yours to choose; pick one that is free.**

**`apm-pgdata:` — a named volume.** Containers are disposable; their filesystems
vanish. A volume is storage Docker keeps *outside* the container, so your data
survives `docker compose down` and restarts. This is the single most important
Docker concept for databases.

- `docker compose down` → container gone, **volume kept**, data safe
- `docker compose down -v` → **volume deleted too**, all data gone

`npm run db:reset` is the second one, on purpose.

**`./init:/docker-entrypoint-initdb.d`** — the Postgres image runs any `.sql` in
that directory **only when initialising an empty volume**. That is where the two
databases get created:

```sql
CREATE DATABASE payload_crud;
CREATE DATABASE medusa_crud;
```

⚠️ **The gotcha:** editing `init/01-databases.sql` does nothing on an existing
volume. Those scripts never run again. You must `npm run db:reset` for changes to
take effect.

---

## 2.4 Why two databases

Not two schemas, not two table prefixes — two separate databases.

```bash
docker exec apm-postgres psql -U postgres -c '\l' | grep _crud
```

Each backend owns its own migration history and cannot see the other's tables.
This is the architectural spine of the repo:

- Payload can run its schema `push` without any chance of touching Medusa's tables
- Medusa can run migrations without Payload noticing
- **You cannot write a SQL `JOIN` across them** — so integration is forced up into
  the Astro layer, where it is one file you can read, rather than scattered
  through queries

If you merged them, the first `push` that hit a Medusa table would be a very bad
day.

---

## 2.5 Connection strings, dissected

```
postgres://postgres:postgres@localhost:5433/medusa_crud
└──┬───┘   └──┬───┘ └──┬───┘ └───┬───┘ └┬─┘ └────┬────┘
 scheme      user   password    host   port   database
```

Both backends read one from their `.env`; both happen to call it `DATABASE_URL`.
They point at **different databases on the same server**.

Read them:

```bash
grep '^DATABASE_URL' apps/cms/.env apps/commerce/.env
```

If you ever see a connection refused, test the string directly before touching
any code:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c 'select 1;'
```

---

## 2.6 Ports: who owns what, and how to take one back

| Port | Process | Serves |
|---|---|---|
| 3000 | `apps/cms` | Payload admin `/admin`, REST `/api/*`, GraphQL |
| 9000 | `apps/commerce` | Medusa admin `/app`, `/store/*`, `/admin/*` |
| 4321 | `apps/storefront` | the site, plus its own `/api/*` |
| 5433 | Docker | Postgres |

**`EADDRINUSE` means a previous process never died.** Find and kill the listener:

```bash
ss -ltnp | grep ':4321 '                       # who has it
kill $(ss -ltnp | grep ':4321 ' | grep -oP 'pid=\K[0-9]+' | head -1)
```

⚠️ **Do not use `pkill -f "medusa develop"`.** The pattern can match your *own*
shell command line and kill your terminal session. (This is not hypothetical — it
happened twice while building this repo.) Always target the port's PID.

---

## 2.7 Which app reads which `.env`

There is no shared runtime config. Each app reads the `.env` in **its own
directory**:

| App | File | Key variables |
|---|---|---|
| `apps/cms` | `apps/cms/.env` | `DATABASE_URL`, `PAYLOAD_SECRET` |
| `apps/commerce` | `apps/commerce/.env` | `DATABASE_URL`, `JWT_SECRET`, `*_CORS`, `DEMO_FAIL_LINK_STEP` |
| `apps/storefront` | `apps/storefront/.env` | `PAYLOAD_API_KEY`, `MEDUSA_PUBLISHABLE_KEY` |

The root `.env.example` is documentation only — **nothing reads it**. It exists so
you can see how the three line up in one place.

Two loading behaviours worth knowing:

- **`next dev` and `medusa develop` load `.env` automatically.**
- **Standalone scripts do not.** `payload run` evaluates the Payload config
  *before* your script body runs, so calling `dotenv` inside the script is already
  too late — you get `missing secret key`. That is why the seed script is wrapped:

  ```json
  "seed": "dotenv -e .env -- cross-env NODE_OPTIONS=--no-deprecation payload run src/scripts/seed.ts"
  ```

**Changing a `.env` requires restarting that app.** Env vars are read at startup;
hot reload will not pick them up.

---

## 2.8 The two keys, and where they come from

The storefront needs two credentials it cannot invent. Both are printed by seed
scripts:

```bash
npm --prefix apps/cms run seed            # → PAYLOAD_API_KEY
npm --prefix apps/commerce run bootstrap  # → MEDUSA_PUBLISHABLE_KEY
```

`npm run setup` runs both and writes the values into `apps/storefront/.env` for
you. Both scripts are **idempotent** — safe to re-run; they reuse an existing key
rather than making a second one.

If the storefront shows "unreachable", check these match reality before anything
else:

```bash
grep -E '^(PAYLOAD_API_KEY|MEDUSA_PUBLISHABLE_KEY)' apps/storefront/.env
```

A key from a previous `db:reset` is the most common cause of a mysterious 401/400.

---

## 2.9 Reading the logs

With `npm run dev`, all three interleave in one terminal with a colour-coded
prefix. What each is telling you:

```
[cms]        GET /api/posts 200 in 39ms          ← Next request log
[cms]        [posts.afterChange] create id=5 …   ← YOUR hook firing
[commerce]   http: GET /store/reviews ← - (200) - 24ms
[commerce]   warn: Local Event Bus installed…    ← expected in dev, see §2.12
[storefront] …
```

Two habits worth forming:

**Watch a hook fire.** Create a post in the UI and watch `[posts.afterChange]`
appear in the terminal. Seeing your own code execute in response to an HTTP
request is the fastest way to internalise a lifecycle.

**A backend error appears in the backend's prefix, not the storefront's.** A
storefront page showing "unreachable" tells you nothing; the `[commerce]` stack
trace three lines up tells you everything.

To follow one service alone, run it alone:

```bash
npm run dev:commerce
```

---

## 2.10 What hot-reloads and what does not

Guessing wrong here means editing a file, seeing no change, and doubting your
code.

| Change | Reloads automatically? |
|---|---|
| `.astro` page or component | ✅ instantly |
| Astro `src/lib/*.ts`, `src/actions`, `src/pages/api` | ✅ |
| `astro.config.mjs` | ❌ restart |
| Payload field or hook, inside an existing collection | ✅ — and pushes the schema |
| `payload.config.ts` — **registering a new collection** | ❌ **restart** |
| Medusa route, workflow, service | ✅ |
| Medusa **data model** | ✅ code, ❌ **schema** — needs `db:generate` + `db:migrate` |
| Medusa `medusa-config.ts` (e.g. registering a module) | ❌ restart |
| Medusa `src/links/*.ts` | ❌ restart **and** `db:migrate` |
| Medusa admin widget (`src/admin/`) | ✅ |
| **Any `.env`** | ❌ restart that app |

Two that catch everyone:

**Editing a Medusa model changes TypeScript but not Postgres.** Your code
compiles, then the query fails on a column that does not exist. Two commands fix
it — see [04-medusa.md](04-medusa.md).

**A new Payload collection needs a restart.** Adding it to `collections` and
saving looks like it worked — the file compiles, no error appears — but every
request to `/api/<new-slug>` returns **404** until you restart. Adding a *field*
to a collection that already exists hot-reloads fine; registering a *new*
collection does not.

---

## 2.11 psql: the five commands worth memorising

Looking at the database beats guessing about it, every time.

```bash
docker exec -it apm-postgres psql -U postgres -d medusa_crud
```

Inside:

| Command | Does |
|---|---|
| `\dt` | list tables |
| `\d review` | describe one table — columns, types, indexes |
| `\l` | list databases |
| `\q` | quit |
| `select * from review limit 5;` | look at actual rows (semicolon required!) |

One-liners without entering the shell — how most checks in these docs are written:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review'
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select status, count(*) from review group by status;'
```

Useful flags: `-t` strips headers, `-A` removes column padding — good for scripts.

Look at the link table now; it is the physical proof of module isolation:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select * from product_product_review_review limit 3;'
```

The two columns that matter are `product_id` and `review_id` — the association
itself. (There is also the row's own `id` and the usual `created_at` /
`updated_at` / `deleted_at`, because Medusa treats a link like any other record,
which is what lets a link be soft-deleted and restored.)

The point: **no foreign key from `review` to `product` exists anywhere.** Confirm
it — this returns nothing:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review' | grep -i foreign
```

---

## 2.12 Warnings, and which ones still appear

Boot output changes as a project is configured, so a list of "warnings to
ignore" goes stale. This section says what you see **now**, and what it used to
say, because the difference is instructive.

### What you see today

```
[commerce] warn: [Workflow-engine-redis] The `url` option is deprecated.
                 Please use `redisUrl` instead for consistency with other modules.
[commerce] info: No link to load from …/@medusajs/draft-order/… skipped.
[cms]      WARN: No email adapter provided. Email will be written to console.
```

**The deprecation warning is wrong — do not follow it.** Passing `redisUrl` to
the workflow engine crashes the server with `Cannot destructure property 'url'
of 'undefined'`. The nested `redis: { url }` form is still required in 2.19.0.
A deprecation notice describes an intended future, not the version you are
running; see [09 §9.3](09-to-production.md) for the whole trap.

The other two are genuinely benign: `draft-order` is an optional module this
project does not use, and Payload prints to the console because no SMTP
credentials are configured.

### What used to be here, and why it is gone

These three appeared on every boot until Redis was configured:

```
info: redisUrl not found. A fake redis instance will be used.
warn: Local Event Bus installed. This is not recommended for production.
info: Locking module: Using "in-memory" as default.
```

They are all silent now, but they went away for **two different reasons**, and
the distinction cost some confusion to work out.

The last two came from the modules in `medusa-config.ts` — configuring
`@medusajs/event-bus-redis` and `@medusajs/locking` retired them directly.

The first one did not. `redisUrl not found` **persisted after all four Redis
modules were connected and logging `Connection to Redis … established`**, which
reads exactly like "Redis is broken" and is not. It comes from a different
setting entirely:

```js
// @medusajs/framework/dist/config/config.js
if (!outputConfig?.redisUrl) {
  customLogger.log(`redisUrl not found. A fake redis instance will be used.`)
}
```

That is `projectConfig.redisUrl` — the **session store** — not the `redisUrl`
inside each module's `options`. Two settings, the same name, different scopes.
It appeared four times per boot because the config is normalised once per
context (server, worker, CLI).

Setting `projectConfig.redisUrl` silences it, and is worth doing on its own
merits: in-memory sessions are a fourth reason two instances cannot be run, as
an admin logged in on one is anonymous on the other.

**The transferable lesson:** a warning that names a setting is telling you about
*that* setting, not about the subsystem you think it refers to. When a message
survives a change that should have fixed it, find the line that prints it —
`grep -rn "fake redis" node_modules/@medusajs/` answered this in one command,
after some time spent assuming the message was stale.

To confirm Redis is actually carrying load rather than trusting boot text:

```bash
docker exec apm-redis redis-cli dbsize
```

---

## 2.13 Recovery: escalating from cheap to nuclear

Work down this list; stop at the first that works.

**1 · Restart one service.** Fixes: stale env, wedged process.

```bash
kill $(ss -ltnp | grep ':9000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
npm run dev:commerce
```

**2 · Clear a build cache.** Fixes: phantom type errors, stale bundles.

```bash
rm -rf apps/cms/.next apps/storefront/.astro apps/commerce/.medusa
```

**3 · Reinstall one app.** Fixes: half-finished installs, resolution errors.

```bash
rm -rf apps/commerce/node_modules && npm --prefix apps/commerce install
```

**4 · Rebuild the database. Destroys all data.** Fixes: schema drift, bad
migration, "I have no idea what state this is in".

```bash
npm run db:reset && npm run setup
```

`db:reset` deletes the volume; `setup` recreates databases, migrates, seeds, and
rewrites the storefront's keys. **This is the reason you can experiment freely** —
there is nothing here you cannot rebuild in about a minute.

---

## 2.14 What is missing for production

This repo is a teaching environment. Do not deploy it as-is:

- Passwords and secrets are `postgres` / `dev-only-…` in committed example files
- Payload uses `push` instead of migrations, so there is no migration history
- The storefront has **no authentication** — anyone can edit or delete anything
- Files are stored on local disk, so they are lost on a container rebuild
- No HTTPS
- Astro's rate limiter is in-memory and per-process, so it does not survive scaling

Three items that used to be on this list have been dealt with, and are worth
knowing about as *examples* rather than as remaining gaps:

- **Redis** is configured, so the event bus, locking, caching, sessions and
  workflow persistence are all shared rather than per-process
  ([09 §9.3](09-to-production.md))
- **Backups** exist as `npm run db:export` / `db:import`, with a manifest that
  refuses a restore against a drifted schema
  ([12 §12.5](12-operating-it.md))
- **Monitoring** exists at [/monitor](http://localhost:4321/monitor) — uptime,
  requests, workflow states, logs and backup age
  ([12](12-operating-it.md))

[09-to-production.md](09-to-production.md) covers each of these properly.

---

## 2.15 Check yourself

1. You edit `infra/init/01-databases.sql` and restart the container. Why does
   nothing change?
2. `EADDRINUSE` on 3000. What do you run — and what must you *not* run?
3. You add a field to a Medusa model, the code compiles, the query fails. Why?
4. Which `.env` does the storefront read, and why do its variables lack a
   `PUBLIC_` prefix?
5. What is the difference between `docker compose down` and `down -v`?

---

**Next:** [03-payload.md](03-payload.md) — Payload from zero. The friendliest of
the three, and the fastest path to a working REST API.
