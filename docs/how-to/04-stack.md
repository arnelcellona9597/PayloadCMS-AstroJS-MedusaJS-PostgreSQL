# 4 · The stack itself — structure, env, TypeScript and commands

> Counterpart in the main course:
> [02 · Infrastructure](../learn/02-infrastructure.md). That chapter explains why
> the stack is shaped this way; this one tells you where to put your hands.

Five questions, five answers, all checkable in a terminal:

| You asked | Short answer | Section |
|---|---|---|
| What is the file structure? | three apps under `apps/`, each a complete npm project | §4.1 |
| Is it one `.env` or several? | **three** — one per app, no root `.env` | §4.5 |
| Is TypeScript only for Payload? | **no** — all three apps are TypeScript | §4.8 |
| What terminal commands do I need? | 24 root scripts, five of which you will live in | §4.11 |
| What is seeding? | a script that puts known data in an empty database | §4.13 |

In WordPress the answers are simpler and you already know them: one install, one
`wp-config.php`, no build step, no type-check step, `wp` for everything. For a single site
that is genuinely better. What you buy instead is three services that deploy,
scale and fail independently, and the price is three of everything below.

Confirm what is running:

```bash
docker ps --filter name=apm- --format '{{.Names}}  {{.Image}}  {{.Ports}}  {{.Status}}'
```

```
apm-postgres  postgres:17-alpine  0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp  Up 2 hours (healthy)
apm-redis  redis:7-alpine  0.0.0.0:6379->6379/tcp, [::]:6379->6379/tcp  Up 2 hours (healthy)
```

---

## 4.1 Three apps, three npm projects, one repository

**In WordPress:** one directory tree. `wp-content/themes/<your-theme>` holds
presentation, `wp-content/plugins/*` holds behaviour, core holds everything else,
and one PHP process reads all of it.

**Here:** three directories under `apps/`, each with its own `package.json`, its
own `node_modules`, its own lockfile, its own `.env` and its own port. They talk
over HTTP and share nothing but a Postgres *server*.

```bash
ls -1 /home/infoa/Projects/Freelance/astro-payload-medusa
```

```
README.md
apps
backups
docs
infra
logs
node_modules
package-lock.json
package.json
pnpm-lock.yaml
postman
scripts
```

Annotated:

| Path | What lives there | WordPress analogue |
|---|---|---|
| `apps/cms/` | Payload 3.88.0 on Next 16.3.0 → `:3000` | the content side of WordPress |
| `apps/commerce/` | Medusa 2.19.0 → `:9000` | WooCommerce |
| `apps/storefront/` | Astro 7.2.4 → `:4321` *by default* (see §4.12) | your theme |
| [`infra/`](../../infra/) | `docker-compose.yml` + `init/01-databases.sql` | the LAMP stack your host ran |
| [`scripts/`](../../scripts/) | `setup.sh`, `db-export.sh`, `db-import.sh`, `gen-postman-env.sh` | WP-CLI, but hand-written |
| [`postman/`](../../postman/) | a 49-request collection, ~104 assertions | nothing standard |
| `docs/` | this cookbook, plus `../learn/` and `../from-wordpress/` | nothing standard |
| `logs/` | tee'd dev output, gitignored | `wp-content/debug.log` |
| `backups/` | output of `npm run db:export`, gitignored | UpdraftPlus's folder |
| [`package.json`](../../package.json) | orchestration scripts, one devDependency (`concurrently`) | `wp-cli.yml` |

Two things explain most of the friction. **There is no shared `node_modules`** —
this is not a workspace, so `npm install` in `apps/cms` has no effect on
`apps/storefront`, and installing a Payload plugin is
`npm --prefix apps/cms install …`. And **there is no plugin directory**: nowhere
to drop a folder and have the system notice it. Every capability is an npm
dependency plus a config edit plus a restart.

**Going deeper:**
[02 §2.2 — why three separate npm projects, not a workspace](../learn/02-infrastructure.md).

---

## 4.2 `apps/cms` — Payload's tree, and the part Next owns

Payload 3 is a set of routes *inside* a Next application, so the tree has two
halves: Next's `src/app/`, which you will rarely touch, and everything else,
which is yours.

```bash
find apps/cms/src -maxdepth 1 -mindepth 1 -type d | sort | tr '\n' ' '
```

```
apps/cms/src/app apps/cms/src/collections apps/cms/src/endpoints apps/cms/src/globals apps/cms/src/hooks apps/cms/src/lib apps/cms/src/scripts 
```

| Directory | What goes in it | WordPress analogue |
|---|---|---|
| [`src/collections/`](../../apps/cms/src/collections/) | one file per content type | `register_post_type()` + an ACF field group |
| [`src/globals/`](../../apps/cms/src/globals/) | single-record settings | an ACF options page |
| [`src/hooks/`](../../apps/cms/src/hooks/) | reusable field/collection hooks | `add_action` / `add_filter` callbacks |
| [`src/endpoints/`](../../apps/cms/src/endpoints/) | hand-written API routes | `register_rest_route()` |
| [`src/scripts/`](../../apps/cms/src/scripts/) | things you run with `payload run` | `wp eval-file` |
| `src/app/(payload)/` | Next route handlers Payload generated | `wp-admin` + `wp-json`, as files |
| `src/lib/` | shared helpers — **empty in this repo** | an `inc/` folder you have not needed yet |
| `src/payload.config.ts` | the one config that assembles all of it | `functions.php`, but declarative |
| `public/media/` | uploads (gitignored, **and empty here**) | `wp-content/uploads/` |

⚠️ **Do not edit `src/app/(payload)/`.** It is generated scaffolding that mounts
Payload into Next. Your work is `collections/`, `globals/`, `hooks/` and
`endpoints/` plus the config — four directories and ten files in total: five
collections, one global, one hook, two endpoints, and `payload.config.ts`.

---

## 4.3 `apps/commerce` — Medusa's tree is convention-routed

Medusa derives routes, jobs and subscribers from **where a file is**, which is
the closest thing in this stack to WordPress's template hierarchy.

| Directory | What goes in it | Becomes |
|---|---|---|
| [`src/api/store/`](../../apps/commerce/src/api/store/) | `route.ts` files | public `/store/*` endpoints |
| [`src/api/admin/`](../../apps/commerce/src/api/admin/) | `route.ts` files | authenticated `/admin/*` endpoints |
| [`src/modules/`](../../apps/commerce/src/modules/) | `models/`, `service.ts`, `index.ts`, `migrations/` | a data module with generated CRUD |
| [`src/workflows/`](../../apps/commerce/src/workflows/) | orchestration + `steps/` | multi-step operations that roll back |
| [`src/links/`](../../apps/commerce/src/links/) | `defineLink(...)` | a join table between two modules |
| [`src/subscribers/`](../../apps/commerce/src/subscribers/) | event handlers | `add_action('woocommerce_…')` |
| [`src/jobs/`](../../apps/commerce/src/jobs/) | cron-shaped files | wp-cron events |
| [`src/admin/widgets/`](../../apps/commerce/src/admin/widgets/) | React widgets injected into the dashboard | `add_meta_box()` |
| [`src/scripts/`](../../apps/commerce/src/scripts/) | things you run with `medusa exec` | `wp eval-file` |
| [`medusa-config.ts`](../../apps/commerce/medusa-config.ts) | module registration, 170 lines | the plugin activation list |

⚠️ **`src/api/` paths are the URL.** `src/api/store/reviews/[id]/route.ts` is
`GET /store/reviews/:id`. Rename the folder and you have renamed the endpoint —
there is no route table to update, and equally no route table to grep.

---

## 4.4 `apps/storefront` — Astro's tree is the template hierarchy, explicitly

This is the one that will feel most like home. `src/pages/` is a filesystem
router: a file is a URL.

| Directory | What goes in it | WordPress analogue |
|---|---|---|
| [`src/pages/`](../../apps/storefront/src/pages/) | `.astro` files → routes | `page.php`, `single.php`, `archive.php` |
| `src/pages/api/` | `.ts` files exporting `GET`/`POST`/… | `admin-ajax.php`, `register_rest_route()` |
| [`src/layouts/`](../../apps/storefront/src/layouts/) | `Layout.astro` | `header.php` + `footer.php` |
| [`src/components/`](../../apps/storefront/src/components/) | 7 `.astro` + 1 `.tsx` island | `get_template_part()` |
| [`src/lib/`](../../apps/storefront/src/lib/) | every HTTP call to Payload and Medusa | `functions.php` helpers |
| [`src/actions/`](../../apps/storefront/src/actions/) | typed form handlers | `admin_post_*` handlers |
| [`src/middleware.ts`](../../apps/storefront/src/middleware.ts) | runs before every request | `template_redirect` |
| `public/` | copied verbatim to the site root | the theme's `assets/` |

| WordPress theme file | Here |
|---|---|
| `index.php` | [`src/pages/index.astro`](../../apps/storefront/src/pages/index.astro) |
| `archive.php` | [`src/pages/posts/index.astro`](../../apps/storefront/src/pages/posts/index.astro) |
| `single.php` | [`src/pages/posts/[slug].astro`](../../apps/storefront/src/pages/posts/%5Bslug%5D.astro) |
| `page.php` | [`src/pages/pages/[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro) |
| `style.css` theme header | *nothing* — there are no themes to switch |

**Going deeper:**
[04 · Astro for theme developers](../from-wordpress/04-astro-for-theme-developers.md).

---

## 4.5 There are three `.env` files, and no root `.env`

**In WordPress:** one `wp-config.php` at the document root. Database
credentials, salts, `WP_DEBUG`, memory limits — one file, loaded by the one
process, readable by every plugin.

**Here:** each app loads only its own `.env`, because each is a separate process
with a separate deploy. The CMS has no idea the storefront exists.

**Steps**

1. Count them for yourself:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
for f in .env apps/*/.env; do
  printf '%-26s %s keys\n' "$f" "$(grep -cE '^[A-Z]' "$f" 2>/dev/null || echo 'MISSING')"
done
```

```
.env                       MISSING keys
apps/cms/.env              4 keys
apps/commerce/.env         15 keys
apps/storefront/.env       8 keys
```

2. Learn which key lives where — this is the whole table:

| [`apps/cms/.env`](../../apps/cms/.env.example) | [`apps/commerce/.env`](../../apps/commerce/.env.example) | [`apps/storefront/.env`](../../apps/storefront/.env.example) |
|---|---|---|
| `DATABASE_URL` → `payload_crud` | `DATABASE_URL` → `medusa_crud` | `PAYLOAD_URL` |
| `PAYLOAD_SECRET` | `JWT_SECRET` | `MEDUSA_URL` |
| `NEXT_PUBLIC_SERVER_URL` | `COOKIE_SECRET` | `PAYLOAD_API_KEY` |
| `PAYLOAD_CORS_ORIGINS` | `STORE_CORS` / `ADMIN_CORS` / `AUTH_CORS` | `MEDUSA_PUBLISHABLE_KEY` |
| | `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` | `MEDUSA_ADMIN_EMAIL` / `MEDUSA_ADMIN_PASSWORD` |
| | `DEMO_FAIL_LINK_STEP` | `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` |
| | `RATE_LIMIT_STORE_MAX` / `RATE_LIMIT_WINDOW_MS` | |
| | `REDIS_URL` | |
| | `PAYLOAD_URL` / `MEDUSA_URL` / `STOREFRONT_URL` | |

3. Note `DATABASE_URL` appears **twice, meaning two different databases**. Both
   point at `localhost:5433`; one ends `/payload_crud`, the other `/medusa_crud`.
   Declared once, in
   [`infra/init/01-databases.sql`](../../infra/init/01-databases.sql):

```sql
-- infra/init/01-databases.sql
CREATE DATABASE payload_crud;
CREATE DATABASE medusa_crud;
```

**Verify** — the server has both, and they are genuinely separate:

```bash
docker exec apm-postgres psql -U postgres -lqt | cut -d'|' -f1 | grep -E 'payload_crud|medusa_crud'
```

```
 medusa_crud  
 payload_crud
```

⚠️ **There *is* a root [`.env.example`](../../.env.example), and nothing reads
it.** It exists so you can see all three line up on one screen — its own header
says so. Treat it as documentation, never as a file to copy to `.env`. Its header
also claims `npm run setup` writes all three files from these values; it does
not — see §4.6.

⚠️ **One line in that root reference is wrong, and it will cost you an hour.**
It says Payload reads `DATABASE_URI`. It does not —
[`payload.config.ts`](../../apps/cms/src/payload.config.ts) reads
`process.env.DATABASE_URL`, and `DATABASE_URI` appears nowhere else in the
repository. Copy the CMS block from
[`apps/cms/.env.example`](../../apps/cms/.env.example) instead, which is correct.

**Going deeper:**
[02 §2.7 — which app reads which `.env`](../learn/02-infrastructure.md).

---

## 4.6 How to create your `.env` files on a fresh clone

**In WordPress:** rename `wp-config-sample.php` and paste four database values
and the salts — or let the browser installer write the file for you. A couple of
minutes, and honestly a nicer first run than this one.

**Here:** every app ships a committed `.env.example` and `.env` is gitignored.
You copy two files; a script writes the third and fills in the two values you
cannot type by hand.

**Steps**

1. Copy the two that `setup` does not create:

```bash
cd /home/infoa/Projects/Freelance/astro-payload-medusa
cp apps/cms/.env.example apps/cms/.env
cp apps/commerce/.env.example apps/commerce/.env
```

2. Run setup. It starts Postgres, installs dependencies, seeds both backends,
   creates `apps/storefront/.env` from its example, and writes the two generated
   keys into it:

```bash
npm run setup
```

3. Read step 6/6 of [`scripts/setup.sh`](../../scripts/setup.sh) to see what it
   wrote — one `cp` and two `sed -i` substitutions, not magic.

**Verify** — all three files exist and carry keys:

```bash
for f in apps/*/.env; do printf '%-26s %s keys\n' "$f" "$(grep -cE '^[A-Z]' "$f")"; done
```

```
apps/cms/.env              4 keys
apps/commerce/.env         15 keys
apps/storefront/.env       8 keys
```

⚠️ **`npm run setup` writes only `apps/storefront/.env`.** The CMS and commerce
`.env` files are yours to copy. Skip step 1 and Payload fails at startup with
`missing secret key. A secret key is needed to secure Payload.` — a message that
never mentions `.env`.

⚠️ **Astro hides variables from the browser unless they start with `PUBLIC_`.**
None of the storefront's keys do, deliberately: every page renders on the
server, so the browser never needs them. WordPress needs no equivalent rule
because PHP never ships `wp-config.php` to the client in the first place; the
risk there is a misconfigured server serving it as plain text, which is a
different problem with a different fix.

**Going deeper:**
[02 §2.5 — connection strings, dissected](../learn/02-infrastructure.md).

---

## 4.7 How to recover the two keys after `db:reset`

**In WordPress:** the closest thing is losing an Application Password or a
plugin's API key, both of which do live in the database. Your *database*
credentials, though, are in `wp-config.php`, so a database reset cannot
invalidate the connection itself.

**Here:** two of the storefront's eight variables are **rows in Postgres**,
mirrored into `.env`. `npm run db:reset` deletes the volume, so both go stale
and every storefront page starts failing.

| Key | Lives in | Regenerated by | Sent as |
|---|---|---|---|
| `PAYLOAD_API_KEY` | `payload_crud.users` | `npm run seed:cms` | `Authorization: users API-Key <key>` |
| `MEDUSA_PUBLISHABLE_KEY` | `medusa_crud.api_key` | `npm run bootstrap:commerce` | `x-publishable-api-key: <key>` |

**Steps**

1. Re-seed the CMS. It is idempotent — content is left alone, the key reused:

```bash
npm run seed:cms
```

```
[16:59:35] INFO: Admin already exists: admin@local.test
[16:59:35] INFO: Reusing the existing API key.
[16:59:35] INFO: Post already exists: What are Payload CMS collections?
…
[16:59:35] INFO: Updated global: site-settings

────────────────────────────────────────────────────────────────────────
  CMS seeded.
────────────────────────────────────────────────────────────────────────
  Admin panel   http://localhost:3000/admin
  Login         admin@local.test / supersecret

  Put this in apps/storefront/.env :

  PAYLOAD_API_KEY=ddd927c5-…redacted…

  Used as:  Authorization: users API-Key <key>
────────────────────────────────────────────────────────────────────────
```

2. Re-print the Medusa publishable key:

```bash
npm run bootstrap:commerce
```

```
info:    Reusing publishable API key: Default Publishable API Key
info:    Linked key to sales channel: Default Sales Channel

  Put this in apps/storefront/.env :

  MEDUSA_PUBLISHABLE_KEY=pk_07f8df…redacted…
```

3. Paste both into `apps/storefront/.env` — or skip steps 1–2 and run
   `npm run reset:all`, which does reset, setup and Postman env together.

**Verify** — the storefront's own health route exercises both keys at once. Set
`SF` to whatever `npx astro dev status` reports (`http://localhost:4321` on a
machine — §4.12 explains why it is not 4321):

```bash
curl -s "$SF/api/health" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ok"]); print(d["services"]["payload"]["detail"]); print(d["services"]["medusa"]["detail"])'
```

```
True
88 posts (3 draft), authenticated as admin@local.test
33 approved reviews, products reachable
```

Your counts differ; `authenticated as` is the part that proves the key is valid.

⚠️ **A stale publishable key is a 400, not a 401.** Medusa rejects the request
as malformed rather than unauthorised, which sends people looking at their
request body instead of their `.env`. Prove it to yourself:

```bash
curl -s -o /dev/null -w 'HTTP %{http_code}\n' \
  -H 'x-publishable-api-key: pk_bogus' \
  'http://localhost:9000/store/products?limit=1'
```

```
HTTP 400
```

The body reads `{"type":"not_allowed","message":"A valid publishable key is
required to proceed with the request"}` — a 400 carrying a `not_allowed`.

**Going deeper:**
[02 §2.8 — the two keys, and where they come from](../learn/02-infrastructure.md).

---

## 4.8 TypeScript is all three apps, not just Payload

One correction to the premise: TypeScript is not a Payload feature. It is the
language all three apps are written in. Payload is simply the only one that
*generates* types for you.

| App | What is typed | Where the types come from | Regenerate with | Check with |
|---|---|---|---|---|
| `apps/cms` | collections, globals, hooks, endpoints | `payload` packages + generated [`payload-types.ts`](../../apps/cms/src/payload-types.ts) | `npm --prefix apps/cms run generate:types` | `tsc --noEmit` |
| `apps/commerce` | models, services, routes, workflows | `@medusajs/framework/types` + `.medusa/types/` | `npx medusa build` (writes `.medusa/types/`) | `tsc --noEmit` |
| `apps/storefront` | `.astro` frontmatter, `src/lib/`, Actions | hand-written [`src/lib/types.ts`](../../apps/storefront/src/lib/types.ts) + `.astro/types.d.ts` | written automatically by `astro check` / `astro dev` | `astro check` |

Each app has its own `tsconfig.json`, and they disagree: `apps/cms` sets no
`target` at all and uses `lib: ["DOM", "DOM.Iterable", "ES2022"]` with
`moduleResolution: bundler`; `apps/commerce` sets `target: ES2021` with
`module`/`moduleResolution: Node16`; the storefront extends a preset and sets
almost nothing itself:

```json
// apps/storefront/tsconfig.json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```

Three compilers, three settings — the honest cost. A classic WordPress theme has
no build step to configure at all; block themes and plugins that use
`@wordpress/scripts` do have one, but it is a single preset you rarely open.

### Payload generates types, and nothing imports them

[`payload.config.ts`](../../apps/cms/src/payload.config.ts) asks for the file:

```ts
// apps/cms/src/payload.config.ts
  typescript: {
    // Regenerate with `npm run generate:types` after changing any field.
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
```

📋 The resulting 668-line file is imported by **no code in this repository**.
The storefront hand-writes the subset it consumes and argues the case in its own
header:

```ts
// apps/storefront/src/lib/types.ts
 *   • Payload generates `apps/cms/src/payload-types.ts` from its collection
 *     config. Importing it would couple the storefront to the CMS's file layout
 *     and drag Payload's whole type graph in.
 *   • Medusa generates types into `apps/commerce/.medusa/types`, which only
 *     exists after a build.
```

That is a boundary decision, not laziness. The storefront reaches Payload over
HTTP; importing a type across that boundary would create a **compile-time**
dependency where the architecture deliberately has only a **network** one — the
CMS could be rewritten in Go and the storefront would not care. The cost is
named in the same comment and is real: these shapes can drift, and only
`astro check` against your own code will notice.

**Going deeper:**
[03 §3.11 — types are generated, and imported nowhere](../from-wordpress/03-payload-for-acf-and-cpt.md).

---

## 4.9 How to regenerate Payload's types after a field change

**In WordPress:** no equivalent — adding an ACF field compiles nothing.

**Here:** the generated file comes from the same config that writes the SQL, so
it matches reality only after you ask for it.

**Steps**

1. Edit a field in `apps/cms/src/collections/`.
2. Regenerate:

```bash
npm --prefix apps/cms run generate:types
```

```
> cms@1.0.0 generate:types
> cross-env NODE_OPTIONS=--no-deprecation payload generate:types

[16:59:12] INFO: Compiling TS types for Collections and Globals...
```

**Verify** — `wc -l apps/cms/src/payload-types.ts` prints `668` here.

⚠️ **Never edit `payload-types.ts`.** It is overwritten in full on every run, and
`apps/cms/eslint.config.mjs` ignores it for exactly that reason.

⚠️ **Regenerating does not change the storefront.** Because nothing imports the
file, a new Payload field is invisible to Astro until you widen
[`src/lib/types.ts`](../../apps/storefront/src/lib/types.ts) by hand.

**Going deeper:** [03 · Payload](../learn/03-payload.md).

---

## 4.10 How to type-check the whole stack

**In WordPress:** `php -l` plus PHPCS, often wired into a pre-commit hook. It is
also easy to skip, because mistakes still surface in the browser.

**Here:** one root script runs three checkers in series, stopping at the first
failure.

**Steps**

1. From the repo root:

```bash
npm run typecheck
```

**Verify** — all three in about ten seconds:

```
> cms@1.0.0 typecheck
> tsc --noEmit

> commerce@0.0.1 typecheck
> tsc --noEmit

> storefront@0.0.1 typecheck
> astro check

17:02:31 [@astrojs/node] Enabling sessions with filesystem storage
17:02:31 [types] Generated 188ms
17:02:31 [check] Getting diagnostics for Astro files in …/apps/storefront...
Result (44 files): 
- 0 errors
- 0 warnings
- 0 hints
```

`tsc --noEmit` (the CMS and commerce) cannot read `.astro` files at all;
`astro check` can, and reports hints and warnings as well as errors.

⚠️ **`astro check` syncs types, it does not start a dev server.** The
`[types] Generated` line above is `astro sync` writing `.astro/types.d.ts`,
`.astro/actions.d.ts` and `.astro/content.d.ts` so that `Astro.props`,
`getEntry` and `actions.*` have shapes. Run `npx astro dev status` straight
after a `typecheck` and it still reports *No dev server is running* — the
server in §4.12 got there some other way.

⚠️ **A green `typecheck` does not prove the three apps agree with each other.**
It proves each app agrees with itself. Nothing in this repo validates the
storefront's hand-written shapes against live Payload or Medusa responses — the
Postman collection (`npm run postman:test`) is the closest thing, and it checks
responses, not types.

**Going deeper:**
[07 · Troubleshooting](../learn/07-troubleshooting.md).

---

## 4.11 The terminal commands, grouped by what you are doing

Every `npm run` script below lives in a `package.json` you can open; the two
`npx medusa` lines are Medusa's own CLI (`npx medusa --help` lists the rest). The
WP-CLI column is the honest mapping, including where there is none.

### Daily

| Command | Does | WP-CLI |
|---|---|---|
| `npm run db:up` | starts Postgres + Redis, waits for healthy | — (your host ran MySQL) |
| `npm run dev` | all three apps, colour-coded, via `concurrently` | — |
| `npm run dev:cms` | just Payload, tee'd to `logs/cms.log` | — |
| `npm run dev:commerce` | just Medusa, tee'd to `logs/commerce.log` | — |
| `npm run dev:storefront` | just Astro (see §4.12) | — |
| `npm run setup` | idempotent full setup | `wp core install` |
| `npm run install:all` | `npm install` in all three apps | — |
| `npm run db:down` | stops the containers, keeps the data | — |

### Database

| Command | Does | WP-CLI |
|---|---|---|
| `npm run db:psql` | interactive psql in the container | `wp db cli` |
| `npm run db:export` | dumps both databases + media to `backups/` | `wp db export` |
| `npm run db:import` | restores a backup, with four safety checks | `wp db import` |
| `npm run db:reset` | **deletes the volume**, then restarts | `wp db reset` |
| `npm run reset:all` | `db:reset` + `setup` + `postman:env` | `wp db reset` then `wp import` |
| `npm run seed:cms` | content, admin user, API key | — |
| `npm run seed:commerce` | products, region, sales channel | Woo sample products |
| `npm run bootstrap:commerce` | prints the publishable key | — |
| `npm --prefix apps/commerce run db:generate` | writes a migration for the `review` module | plugin-specific |
| `npm --prefix apps/commerce run db:migrate` | applies pending Medusa migrations | plugin-specific |
| `npx medusa db:rollback <module>` | reverses the last migration for one module | — |

⚠️ **Payload has no migrate command here.** It uses `push` in dev and diffs the
config against the live database on boot. Only Medusa has migration files.

⚠️ **`db:psql` drops you into the `postgres` database, not yours.** Add `-d`:
`docker exec -it apm-postgres psql -U postgres -d payload_crud`.

### Testing

| Command | Does | WP-CLI |
|---|---|---|
| `npm run test` | the 20 unit tests plus the compensation test | — |
| `npm run test:unit` | vitest only | — |
| `npm run test:compensation` | runs a workflow that fails on purpose and rolls back | — |
| `npm run typecheck` | all three apps (§4.10) | — |
| `npm run postman:env` | regenerates the Postman environment from `.env` | — |
| `npm run postman:test` | newman: 49 requests, ~104 assertions — **28 fail today**, see below | — |

```bash
npm run test:unit
```

```
 Test Files  2 passed (2)
      Tests  20 passed (20)
   Duration  107ms (transform 62%, import 20%, tests 12%, worker 6%)
```

⚠️ **`postman:test` assumes the storefront is on the port in
`postman/local.postman_environment.json`.** That file is generated from
`apps/storefront/.env`, which says `4321`. If Astro moved (§4.12), every
`04 Astro BFF` request 404s and you get a wall of assertion failures that have
nothing to do with your code. Regenerate with `npm run postman:env` after you
know the real port, or put the storefront back on 4321.
[07 §7.7](07-tools.md#77-the-rest-of-the-toolkit-and-what-each-one-replaces) shows
the failing run, and [07 §7.8](07-tools.md#78-worked-example-the-tools-catching-a-port-collision)
tracks the collision down.

### Debugging

| Command | Does | WP-CLI |
|---|---|---|
| `npm run logs` | tails `logs/cms.log`, `logs/commerce.log` and `apps/storefront/.astro/dev.log` | — (`tail -f wp-content/debug.log`) |
| `npm run logs:errors` | greps them for error/fatal/warn | — |
| `npx astro dev status` (in `apps/storefront`) | where the storefront is listening — §4.12 | — |
| `npx astro dev stop` (in `apps/storefront`) | kills the backgrounded dev server | — |
| `docker ps --filter name=apm-` | are the containers healthy | — |

⚠️ **`logs:errors` matches `warn` as well as `error` and `fatal`.** The uptime
job in `apps/commerce/src/jobs/uptime-check.ts` runs every minute and logs
`warn: [uptime] 1/3 DOWN: storefront (HTTP 404)` whenever the storefront is not
on the port it expects, so the output can be almost entirely that one line. Read
the tail, not the count.

⚠️ **The dev logs carry ANSI colour codes and stray NUL bytes.** `file` calls
`logs/cms.log` "UTF-8 text, with escape sequences", and plain `grep` does still
match it here — but a pattern that straddles a colour escape will silently fail
to match, and some tools refuse a file with NUL bytes outright. Match on a word
rather than a whole line, and add `grep -a`: it costs nothing and removes the
question.

**Going deeper:**
[08 §8.3 — command to command](../from-wordpress/08-cheat-sheet.md) has the
WP-CLI mapping from the other direction, and a dump of every script in all four
`package.json` files.

---

## 4.12 How to find the storefront when it is not on 4321

**In WordPress:** your site is wherever Apache says it is, and it does not move.

**Here:** Astro 7 **backgrounds its dev server**, and if the configured port is
taken it quietly uses another. Both happened on this machine while writing this
page.

**Steps**

All three commands below run from `apps/storefront`.

1. Ask Astro, rather than guessing:

```bash
npx astro dev status
```

```
{"message":"Dev server running at http://localhost:4321 (pid 143892, uptime 32s, background)","label":"SKIP_FORMAT","level":"info"}
```

When nothing is running it says so, which is just as useful:

```
{"message":"No dev server is running.","label":"SKIP_FORMAT","level":"info"}
```

2. Stop it when you want the port back:

```bash
npx astro dev stop
```

```
{"message":"Stopped dev server (pid 107544).","label":"SKIP_FORMAT","level":"info"}
```

3. Start it again with `npx astro dev`. It prints one banner and **exits
   immediately** — it does not hold the terminal the way the other two apps do:

```
{"message":"Dev server running at http://localhost:4321 (pid 143892)\n  Stop:   astro dev stop\n  Status: astro dev status\n  Logs:   astro dev logs","label":"SKIP_FORMAT","level":"info"}
```

**Verify** — confirm the page you reach is this repo's storefront and not
something else on a neighbouring port:

```bash
SF=http://localhost:4321
curl -s --max-time 5 "$SF/" | grep -oE '<title>[^<]*</title>'
```

```
<title>Stack dashboard · Astro + Payload + Medusa</title>
```

**Keep `SF` exported.** Every storefront command in
[02](02-frontend.md) and [03](03-data.md) is written against it rather than a
hard-coded port, for exactly this reason.

⚠️ **`astro.config.mjs` says `port: 4321`, and that is a request, not a
promise.** If anything already holds 4321 — another project, or a wedged copy of
this one — Astro silently takes the next free port and you end up on 4322. This
has happened on this machine: curling 4321 returned a `302` to `/login`, a route
this repo does not serve, which is a useful tell that you are looking at somebody
else's app rather than a broken storefront. The live port is recorded in
`apps/storefront/.astro/dev.json`, which is gitignored and is deleted on stop —
so "the file is missing" and "the server is not running" are the same fact.

⚠️ **`logs/storefront-launch.log` is empty, and that is correct.** The process
detaches, so only the launch banner is ever tee'd there. The real storefront log
is `apps/storefront/.astro/dev.log`, in JSON lines — which is why `npm run logs`
tails that file and not the one in `logs/`.

**Going deeper:**
[12 · Operating it](../learn/12-operating-it.md) covers the log formats and the
`astro dev stop` trap.

---

## 4.13 Seeding is sample content as code

**In WordPress:** a WXR import through Tools → Import, or WooCommerce's CSV
importer at Products → Import. Both work well; what they are not is *a file in
your repository*, so what landed in the database is not described anywhere a
reviewer can read it.

**Here:** a seed is a TypeScript file in the repository, run from the terminal.
Same purpose; the differences that matter:

| | WXR import / Woo CSV import | A seed here |
|---|---|---|
| Lives | in a `.xml` or `.csv` you downloaded | in `src/scripts/`, in git |
| Run by | clicking in wp-admin | `npm run seed:cms` |
| Re-running | depends on the importer (see §4.14) | idempotent — checks first |
| Versioned with the schema | no | yes, same commit |

Three seeds exist:

| Script | Creates | Technique |
|---|---|---|
| [`apps/cms/src/scripts/seed.ts`](../../apps/cms/src/scripts/seed.ts) | admin + API key, 10 categories, 88 guides with generated cover images, 1 page, site settings | Payload **Local API** |
| [`apps/commerce/src/scripts/seed.ts`](../../apps/commerce/src/scripts/seed.ts) (922 lines) | products, variants, prices, region, sales channel, stock | Medusa **workflows** |
| [`apps/commerce/src/scripts/seed-reviews.ts`](../../apps/commerce/src/scripts/seed-reviews.ts) (117 lines) | 2–4 reviews per product from five templates, statuses mixed on purpose | the `create-review` **workflow** |

The second and third go through workflows rather than inserting rows — the one
thing to copy if you write your own. The reviews seed says why in its header:
calling the service directly would create valid review rows belonging to no
product, because the **link table row** is written by a workflow step.

### When to seed

| Use it for | Do not use it for |
|---|---|
| a fresh clone, so the app is not empty | production content |
| after `npm run db:reset` | anything with real customer data |
| CI, so tests have known fixtures | **schema changes** — that is `db:migrate` |
| demos and screenshots | — |
| onboarding a new developer | — |

⚠️ **Seeding is not migrating.** A seed inserts rows. A migration changes the
shape of the table — and in this repo only Medusa has migration files, because
Payload uses `push` in dev (§4.11, Database). Confusing the two is how teams end up with a "seed" that
nobody can run twice.

---

## 4.14 How to re-seed without duplicating everything

**In WordPress:** it depends on the importer, which is the problem. The WXR
importer skips posts whose GUID it has already seen, so a second run is mostly a
no-op. The WooCommerce CSV importer only updates in place if the row carries an
`id` or a matching SKU — without one you get a second product. You find out
which case you are in afterwards.

**Here:** every seed checks before it writes — a convention you maintain
yourself, not something the framework enforces.

**Steps**

1. Run the reviews seed — the shortest example of the pattern:

```bash
npm --prefix apps/commerce run seed:reviews
```

```
info:    Executing script at ./src/scripts/seed-reviews.ts...
warn:    [Workflow-engine-redis] The `url` option is deprecated. Please use `redisUrl` instead…
info:    Connection to Redis in module 'event-bus-redis' established
…
info:    Reviews already seeded — nothing to do.
info:    Finished executing script.
```

Everything between the first and last line is `medusa exec` booting the
application — see the gotcha at the end of this section.

2. Read the lines that produced that message, and copy the shape into your own
   seeds — query for one row, bail if it exists:

```ts
// apps/commerce/src/scripts/seed-reviews.ts
  const existing = await reviewService.listReviews({}, { take: 1 })

  if (existing.length > 0) {
    logger.info("Reviews already seeded — nothing to do.")
    return
  }
```

**Verify** — count, re-seed, count again. The absolute number is whatever your
database holds; what matters is that it does not move:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -tAc 'select count(*) from review;' | sed 's/^/before: /'
npm --prefix apps/commerce run seed:reviews > /dev/null 2>&1
docker exec apm-postgres psql -U postgres -d medusa_crud -tAc 'select count(*) from review;' | sed 's/^/after:  /'
```

```
before: 45
after:  45
```

That `count(*)` includes soft-deleted rows, which is why it is larger than the
number any API reports —
[03 §3.13](03-data.md#313-how-to-delete-a-review--and-why-the-row-is-still-there-afterwards).

⚠️ **`medusa exec` and `payload run` are not `node`.** Both boot the whole
application first, which is why `container.resolve(...)` and `payload.find(...)`
work inside a seed exactly as in a route handler. There is no "connect to the
database directly" step, and you should not add one.

⚠️ **The commerce seed imports a build artefact** — a type from
`../../.medusa/types/query-entry-points`, which exists only after `medusa build`
or a `medusa develop` run. On a cold clone, start the dev server once first.

⚠️ **The CMS seed must be run through its npm script, not directly.** The script
wraps it in `dotenv -e .env --` because `payload run` evaluates
`payload.config.ts` *before* the seed body executes — so loading the environment
from inside the script is already too late.

**Going deeper:**
[11 · Capstone](../learn/11-capstone.md) builds a feature end to end, seed
included.

---

## 4.15 The five you will actually type

Everything above is reference. This is the working set:

```bash
npm run db:up        # 1. containers first, always
npm run dev          # 2. all three apps
npm run logs:errors  # 3. when something is wrong
npm run typecheck    # 4. before you commit
npm run setup        # 5. when you have no idea what state you are in
```

`npm run setup` is the one to remember. It is idempotent by design, so running
it when you are confused is cheap and almost always helpful — the closest thing
this stack has to deactivating all plugins and switching to a default theme.

---

## Check yourself

1. You add `REDIS_URL` to `apps/commerce/.env`. Which of the other two apps can
   read it, and why?
2. `wp-config.php` is one file for an entire WordPress site. Name two concrete
   things that become possible here *because* there are three `.env` files, and
   one thing that becomes harder.
3. `npm run db:reset` has just finished. Two values in
   `apps/storefront/.env` are now wrong. Which two, and what regenerates each?
4. `payload-types.ts` is 668 generated lines that nothing imports. Give the
   argument for that decision in one sentence, and name the cost it accepts.
5. `npm run typecheck` passes. Someone renames a Payload field and redeploys the
   CMS. Does `typecheck` still pass? Should it?
6. `astro dev` returned you to the shell immediately. Is the storefront running?
   Which command answers that without guessing a port?
7. You re-run `npm run seed:cms` on a database with content in it. What happens,
   and which lines in the script make it so?
8. A colleague describes a seed as "our migration for the review table".
   What are they confusing, and which command did they actually want?

---

**Next:** [05-plugins.md](05-plugins.md) — what exists instead of
wp-admin → Plugins → Add New, and which of your sixty-thousand options survive
the crossing. For the command tables from the WP-CLI side, see
[08 · Cheat sheet](../from-wordpress/08-cheat-sheet.md).
