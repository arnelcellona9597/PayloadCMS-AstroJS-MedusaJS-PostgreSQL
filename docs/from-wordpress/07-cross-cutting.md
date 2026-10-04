# 7 · The plugins you will miss — and what replaces them

> Counterpart in the main course: [09 · To production](../learn/09-to-production.md)
> and [12 · Operating it](../learn/12-operating-it.md).

Every chapter so far has mapped a *concept*. This one maps a *shopping list* —
the plugins you install on almost every build. Read it as a gap analysis: several
entries end with *you would have to write this*, and that is the most useful
thing the chapter can tell you.

| Mark | Meaning |
|---|---|
| ✅ | Running in this repo now. Every command shown was executed. |
| 📋 | The framework supports it; this repo does not configure it. No command. |
| 🚫 | Does not exist here at all. Conceptual, or a sketch you would build. |

One thing before the list: **WordPress wins several of these outright.** A plugin
someone else maintains and security-patches is a real engineering asset, not a
crutch. Where that is the case below, it says so.

---

## 7.1 UpdraftPlus becomes two shell scripts, and gains a drift check ✅

**WordPress:** UpdraftPlus — scheduled, pushes to S3, restores from a button in
wp-admin (incremental backups are a Premium add-on).

**Here:** [`scripts/db-export.sh`](../../scripts/db-export.sh) and
[`scripts/db-import.sh`](../../scripts/db-import.sh), run by hand. This repo
loses the first three rows:

| | UpdraftPlus | This repo |
|---|---|---|
| Scheduling | built in, via WP-Cron | **none** — you run it |
| Remote destination | a dozen providers | **none** — local `backups/` only |
| Restore from the UI | a button | **deliberately absent** (§7.1.2) |
| Schema-version safety | none | **a hard stop on migration drift** |
| Integrity check | none | sha256 per dump, before anything is touched |
| Verification | none | exact row counts, compared **per table** |

```bash
npm run db:export
```

```
── Exporting to backups/2026-10-04T10-29-34Z
   payload_crud   148K
   medusa_crud    460K
   media          4.3M (96 files)

── Done
   payload_crud   16 non-empty tables, 305 rows
                  migrations: dev:-1
   medusa_crud    58 non-empty tables, 1273 rows
                  migrations: mikro_orm:180 links:21 scripts:5
   
   Restore with:  npm run db:import -- backups/2026-10-04T10-29-34Z
```

⚠️ **`media.tar.gz` is the line to internalise.** Payload stores upload
*metadata* in Postgres and the *files* on disk — two different places, and a
dump only covers one of them. A database-only restore leaves rows pointing at
files that are not there and every image 404s. That is why the export tars
`apps/cms/public/media` alongside the dumps, and it is the same reason
UpdraftPlus bundles `wp-content/uploads`.

Note the asymmetry in the numbers: 4.3 MB of images against 600 kB of database.
On a real site that ratio is far more lopsided, which is the argument for moving
uploads to object storage and letting the provider own their backup
([09 §9.7](../learn/09-to-production.md)).

### 7.1.1 The manifest, and the drift check it buys

A dump is a snapshot of data *in a schema shape*. The manifest records the shape.

```bash
python3 -c "import json; m=json.load(open('backups/2026-10-01T14-39-30Z/manifest.json'));
[print(k, '->', v['migrationState'], '|', len(v['rowCounts']), 'tables |', sum(v['rowCounts'].values()), 'rows') for k, v in m['databases'].items()]"
```

```
payload_crud -> dev:-1 | 17 tables | 54 rows
medusa_crud -> mikro_orm:185 links:21 scripts:5 | 58 tables | 992 rows
```

Each database gets four fields, and each has a job. `sha256` catches an export
killed by a full disk *before* the restore starts — `db-import.sh` compares it at
`:85` and refuses. `bytes` is the cheap sanity check beside it. `rowCounts`
allows per-table verification afterwards, not a single total that two tables off
by +3 and −3 would net to zero. And `migrationState` buys the check below. The
manifest's top level adds `serverVersion` and `pgDumpVersion`, which nothing
compares automatically — they are there so you can see what the dump came from
before pointing it at a different server.

`dev:-1` is not a bug: Payload runs in `push` mode, so `payload_migrations` holds
one bookkeeping row rather than a ledger. Recorded anyway, so that the day this
project switches to real migrations the number starts meaning something.

The drift check is what UpdraftPlus has no equivalent for. From
[`scripts/db-import.sh`](../../scripts/db-import.sh):

```bash
  else
    warn "$(printf '%-14s DRIFT' "$db")"
    warn "    dump:    $DUMPED"
    warn "    current: $CURRENT"
    DRIFT=1
  fi
```

Restoring a dump taken *before* a migration gives you old data in a shape the
running code no longer expects — neither the old state nor the new one, with
errors surfacing far from the cause. WordPress has the same exposure whenever a
plugin ships a `dbDelta` upgrade; what the usual backup tooling does not record
is a schema version to compare against on the way back in.

### 7.1.2 Why there is no restore button

[`apps/storefront/src/lib/backups.ts`](../../apps/storefront/src/lib/backups.ts)
lists backups and nothing else:

```ts
 * This storefront has **no authentication** (docs/learn/09-to-production.md
 * §9.5 — anyone who can reach it can already delete any review). Adding an
 * endpoint that runs pg_dump would put a complete copy of both databases one
 * unauthenticated GET away: a data-exfiltration route dressed as a convenience.
 * A restore button would be worse — an unauthenticated endpoint that destroys
 * the current database.
```

UpdraftPlus can have its button because wp-admin has a login and a capability
check behind it. This app has neither (§7.8). **The blast radius of a button is
the blast radius of whoever can press it.**

⚠️ **A backup nobody has restored is a hypothesis.** Do the round trip once —
export, `db:reset`, import. The walkthrough, and the three things a restore
quietly breaks, is [12 §12.5](../learn/12-operating-it.md).

---

## 7.2 Wordfence has no single replacement — the pieces live in three places

**WordPress:** Wordfence. One plugin, one settings screen: firewall, login
lockout, 2FA, malware scanning, live traffic, rate limiting — plus country
blocking and real-time rule updates on the paid tier.

**Here:** no equivalent, and saying otherwise would be dishonest.

| Wordfence feature | In this stack | Label |
|---|---|---|
| Rate limiting | two in-process sliding-window limiters | ✅ |
| Per-operation authorisation | Payload `access` functions | ✅ |
| Admin login | Payload users; Medusa admin JWT | ✅ |
| Login lockout / brute force | Payload's own: 5 attempts, 10-minute lock | ✅ Payload / 🚫 Medusa |
| Two-factor auth | nothing configured | 🚫 |
| Web application firewall | belongs at the edge, not in the app | 🚫 |
| Malware scan of source files | **no analogue, and no need** | — |
| **Front-end authentication** | **does not exist** | 🚫 |

The lockout row is Payload's default, not something this repo configured:
`maxLoginAttempts: 5` and `lockTime: 600000` apply to any collection with
`auth`, and the `users` table carries the `login_attempts` and `lock_until`
columns to prove it. Six bad passwords in a row:

```bash
for i in 1 2 3 4 5 6; do
  curl -s -X POST http://localhost:3000/api/users/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@local.test","password":"wrong"}' \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["errors"][0]["message"])'
done
```

```
The email or password provided is incorrect.
The email or password provided is incorrect.
The email or password provided is incorrect.
The email or password provided is incorrect.
The email or password provided is incorrect.
This user is locked due to having too many failed login attempts.
```

Medusa's admin has no equivalent, so that row is only half green — but half is
more than the usual "nothing configured", and it is worth knowing before you go
looking for a plugin.

⚠️ **That lock is real and it will lock you out of your own admin.** Clear it
with `docker exec apm-postgres psql -U postgres -d payload_crud -c "update users
set login_attempts = 0, lock_until = null;"`, or wait ten minutes.

The "no need" row is credit to WordPress, not a dig: Wordfence scans PHP because
WordPress *can* write executable code at runtime — plugin installs, theme edits,
uploads into a web-served directory. Nothing here writes a `.ts` file and then
runs it, so an entire category of attack is structurally absent.

### 7.2.1 Access control: a query, not a capability check

`current_user_can()` returns a boolean and you filter the results yourself.
Payload lets the rule *be* the filter: the `read` function on
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
returns a `Where` query for anonymous callers, so drafts are filtered out in SQL
rather than refused. That mechanism is the subject of
[03 §3.9](03-payload-for-acf-and-cpt.md), with the source and both halves of the
proof; this section is only about what it means for the security posture.

The write side is a plain boolean, and it is enforced:

```bash
curl -s -X POST http://localhost:3000/api/posts -H 'Content-Type: application/json' \
  -d '{"title":"unauthenticated attempt"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["errors"][0]["message"])'
```

```
You are not allowed to perform this action.
```

Four lines of TypeScript rather than a capability map plus a `pre_get_posts`
filter. Payload's own treatment of the rule is
[03 · Payload §3.4](../learn/03-payload.md).

### 7.2.2 Rate limiting is real, and you can trip it

Two limiters, same algorithm, different registration. The Astro one wraps every
request from [`apps/storefront/src/middleware.ts`](../../apps/storefront/src/middleware.ts);
page views are deliberately exempt, because reading the site is cheap and the
abusable surface is the one that writes.

```bash
for i in $(seq 1 130); do
  curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/api/reviews
done | sort | uniq -c
```

```
    119 200
     11 429
```

119, not 120 — one slot in that sixty-second window had already gone to the
uptime job's health probe. Run it again and the split moves, because everything
else that touched `/api/*` in the preceding minute shares the same budget. The
refusal states the budget it enforced:

```bash
curl -s -i http://localhost:4321/api/reviews | sed -n '1,8p;$p'
```

```
HTTP/1.1 429 Too Many Requests
Vary: Origin
content-type: application/json
retry-after: 58
x-ratelimit-limit: 120
x-ratelimit-remaining: 0
x-ratelimit-reset: 1790866919
Date: Thu, 01 Oct 2026 15:01:01 GMT
{"error":{"message":"Too many requests.","detail":"Limit is 120 requests per 60s. Retry in 58s."}}
```

Medusa's limiter is wired by path matcher in
[`middlewares.ts`](../../apps/commerce/src/api/middlewares.ts) and covers
`/store/*` only — not `/admin/*`, because locking your own moderators out during
a busy moment is a self-inflicted outage. That is the opposite of Wordfence's
default, and both are defensible: Wordfence guards a login page facing the
internet; Medusa's admin routes already require a JWT.

⚠️ **The burst above knocked the storefront "down".** The uptime job probes
`/api/health`, which is under `/api/*` and therefore limited:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c "select target, ok, status_code, error, created_at from uptime_check where ok = false order by created_at desc limit 5;"
```

```
   target   | ok | status_code |  error   |         created_at         
------------+----+-------------+----------+----------------------------
 storefront | f  |         429 | HTTP 429 | 2026-10-01 14:40:00.031+00
(1 row)
```

Nothing was broken. The limiter did its job and the monitor recorded an outage,
because a health endpoint sharing a budget with ordinary traffic reports *load*
as *downtime*. The middleware already exempts `/api/monitor` and `/api/logs` for
exactly this reason; `/api/health` is not on that list.

**The gap, plainly:** both limiters hold counters in one process's memory, so
neither survives a second instance, and neither is a firewall. The real answers
are in [09 §9.5 and §9.7b](../learn/09-to-production.md).

---

## 7.3 WP-Cron is not a scheduler; Medusa's is ✅

**WordPress:** WP-Cron — and you already know the catch. WP-Cron is a **queue
checked during an incoming page request**. On a quiet site nothing runs; on a
busy site it runs inside some unlucky visitor's request. The production fix is
`DISABLE_WP_CRON` plus a real system cron hitting `wp-cron.php` — which is to say,
replacing WP-Cron with a scheduler.

Medusa ships the scheduler.

| | WP-Cron | Medusa jobs |
|---|---|---|
| Trigger | an incoming HTTP request | the process's own scheduler |
| Quiet site | **does not run** | runs |
| Busy site | runs inside a visitor's request | runs on its own |
| Schedule stored in | the database (`cron` option) | **code**, `export const config` |
| Changing a schedule | a function call, effective at once | edit the file, restart |
| Missed run | runs late | **skipped** |
| Several instances | one DB, one lock | **once per instance** unless locking is configured |

The last two rows are where WordPress is genuinely better. WP-Cron's lateness is
also its resilience — a missed job eventually runs, while a missed Medusa job is
simply gone — and because the schedule lives in the database, a plugin can
register one at runtime without a deploy.

Two jobs exist.
[`jobs/uptime-check.ts`](../../apps/commerce/src/jobs/uptime-check.ts) runs every
minute:

```ts
export const config = {
  name: "uptime-check",
  /**
   * Every minute. That is aggressive for production (it is 43k rows per target
   * per month) and right for learning, because a one-minute loop means you see
   * an outage appear while you are still looking at the screen.
   */
  schedule: "* * * * *",
}
```

[`jobs/review-digest.ts`](../../apps/commerce/src/jobs/review-digest.ts) runs at
`"0 8 * * *"` and **logs only** — the shape of a notification job without the
notification, because no mail transport is configured anywhere in this repo.

No page view triggered any of this, and no request from this terminal did
either. The rows accumulate on the scheduler's own clock — one sweep a minute,
three rows a sweep, one per target:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c "select date_trunc('minute', created_at) as minute, count(*) from uptime_check group by 1 order by 1 desc limit 5;"
```

```
         minute         | count 
------------------------+-------
 2026-10-01 14:58:00+00 |     3
 2026-10-01 14:57:00+00 |     3
 2026-10-01 14:56:00+00 |     3
 2026-10-01 14:55:00+00 |     3
 2026-10-01 14:54:00+00 |     3
(5 rows)
```

Three rows in every sweep, and across the whole history exactly one failure —
the 429 from §7.2.2, which is the single row the query in that section returns.
The data is honest about its own measurement error, which is why `status_code`
and `error` are stored separately from `ok`.

⚠️ **Six rows a minute would mean your job ran twice.** Medusa jobs fire once per
*instance* unless the locking module is configured — it is, here, via
`@medusajs/locking` with the Redis provider in
[`medusa-config.ts`](../../apps/commerce/medusa-config.ts). Same problem WordPress
solves with a database lock, from the other direction: WP-Cron is *accidentally*
singular because there is one database; Medusa is singular because you configured
a lock. The other ways to run code in Medusa are
[04 §4.12](../learn/04-medusa.md).

---

## 7.4 Gravity Forms: the mechanism exists, the product does not

**WordPress:** Gravity Forms. Drag fields into a form and you get a rendered
form, server-side validation, an entries table, email notifications, conditional
logic, uploads, CSV export and payment add-ons.

**Here:** Astro Actions plus zod give you *one* of those — validated submission
with per-field errors. **Everything else you build.** There is no contact form in
this repo; what exists is three actions for posts in
[`actions/index.ts`](../../apps/storefront/src/actions/index.ts).

### 7.4.1 The real validator ✅

```ts
const optionalText = (max: number, message: string) =>
  z
    .string()
    .max(max, message)
    .nullish()
    .transform((value) => (value && value.trim() ? value.trim() : null))

const PostFields = {
  title: z.string().min(3, 'Give the post a title of at least 3 characters.').max(200),
  excerpt: optionalText(300, 'Keep the excerpt under 300 characters.'),
  body: optionalText(20000, 'That body is too long.'),
  …
}
```

`PostFields` is handed straight to an Action as `input: z.object(PostFields)`
with `accept: 'form'` — the Action itself is eleven lines, quoted in
[04 §4.8](04-astro-for-theme-developers.md) along with Pattern A versus
Pattern B. Submit something invalid and field-level errors come back with no
plumbing:

```bash
curl -s -X POST 'http://localhost:4321/_actions/post.create' \
  -H 'Origin: http://localhost:4321' -F 'title=ab' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["type"]); print(d["fields"])'
```

```
AstroActionInputError
{'title': ['Give the post a title of at least 3 characters.']}
```

`fields` is what [`FieldError.astro`](../../apps/storefront/src/components/FieldError.astro)
renders — and because `accept: 'form'` makes the form a plain HTML POST, all of
it works with JavaScript disabled. Gravity Forms cannot say that about its
conditional logic.

⚠️ **With `accept: 'form'` every value arrives as a string, an absent field
arrives as `null`, and an empty one as `''`.** `z.string().optional()` accepts
`undefined` and *rejects* `null`, so an omitted optional field fails with
"expected string, received null". That is why `optionalText` uses `.nullish()`.
A browser submits every field, so you will not hit this in the UI — you will hit
it the first time something calls the action with `curl`. Pattern A versus
Pattern B is [05 §5.6](../learn/05-astro.md).

### 7.4.2 The contact form you would actually build 🚫

**Not built. Nothing below is runnable.** The good news: the hardest part of
Gravity Forms — the entries table — is the part Payload hands you free.

| Gravity Forms gives you | You would build it as |
|---|---|
| The entries table in wp-admin | a Payload collection `submissions`; the admin UI is generated |
| CSV export | the admin list view, or a custom endpoint |
| Server-side validation | the Action's zod schema (the pattern above) |
| Spam protection | a honeypot field plus the existing rate limiter |
| Email notification | a Payload `afterChange` hook — **no mail transport exists here** |
| Conditional logic | your own markup, or an island |
| File uploads | the existing `media` upload collection, related from the submission |
| The drag-and-drop builder | **nothing. You write the fields in TypeScript.** |

Three notes on the sketch:

1. **Model it as a collection.** `access: { create: () => true, read: ({ req }) =>
   Boolean(req.user) }` gives you a public write surface and a private read
   surface in two lines, plus a list view, filters and a detail screen you did not
   write. That is the entries table, and it is a genuinely good trade.
2. **Put the notification in `afterChange`, not in the Action**, so a mail failure
   cannot lose the submission. The seam already exists and already logs — see
   `Posts.ts` `afterChange` in §7.7.
3. **Rate limiting is already there** — an Action POST carries `?_action=`, which
   the middleware counts. There is no CAPTCHA and no mail provider; both are
   dependencies you add.

**Reach for an Action when** the form belongs to this app and you want
progressive enhancement. **Reach for an endpoint when** something outside this
app must post to it — Actions are callable only from within the app.

---

## 7.5 WPML translates documents; Payload translates fields 📋

**Both sides are built in and neither is configured.** Proof the features exist,
and proof they are off:

```bash
grep -n "localization?: false" apps/cms/node_modules/payload/dist/config/types.d.ts
grep -rn "i18n?: {" apps/storefront/node_modules/astro/dist/types/public/config.d.ts
grep -c "localization" apps/cms/src/payload.config.ts
grep -c "i18n" apps/storefront/astro.config.mjs
```

```
1092:    localization?: false | LocalizationConfig;
apps/storefront/node_modules/astro/dist/types/public/config.d.ts:2562:    i18n?: {
0
0
```

Field-level localization is `localized?: boolean` at
`payload/dist/fields/config/types.d.ts:327`. So the capability is one config key
and one flag per field away — but **the data model it produces is not the one
WPML produces**, and that difference is the whole section.

### 7.5.1 The modelling difference

WPML makes a translation a **separate post**. The German version of post 42 is
post 57: its own row in `wp_posts`, its own ID, slug, revision history, publish
status and meta, linked through `icl_translations`. Every query must be
language-aware.

Payload localizes **fields inside one document**. Post 42 stays post 42. Marking
`title` as `localized: true` stores a value per locale *for that field*, and a
request carries `?locale=de`. One row, one ID, one version history.

| | WPML | Payload localization |
|---|---|---|
| Unit of translation | the whole post | **a field** |
| IDs | one per language | **one, shared** |
| Relationships | per-language, re-linked | shared by default |
| Draft / publish state | **independent per language** | **one state for the document** |
| Slug | always per-language | per-language only if you localize that field |
| Structure can diverge | yes — different blocks per language | no, unless you localize the layout field |
| Missing translation | a missing post; you choose a fallback | field-level fallback to `defaultLocale` |
| "German site has extra articles" | natural | awkward — needs a locale-aware filter |
| "Same article in four languages" | awkward — four posts to keep in step | natural |
| UI string translation | WPML String Translation | **Astro's job, not Payload's** |
| Translator workflow, memory, XLIFF | built in | **nothing** |

Neither model is correct in the abstract. Ask one question: **do the language
versions stay in step, or diverge?** A catalogue or documentation site stays in
step, and Payload's model makes "the English one was updated and the German one
was not" structurally impossible. National marketing sites sharing a brand and
nothing else diverge, and there WPML is the right shape.

⚠️ **Independent publish state is the row people underestimate.** WPML lets you
publish English and hold German in draft. A Payload document has one `_status`,
so "publish English now, German when the translation lands" needs a different
design — usually a per-locale flag you model yourself. Check this against the
editorial workflow before choosing.

Even with both flags on you would still write four things: the **routing glue**
(Astro's `i18n` gives `/de/…` prefixes and knows nothing about Payload's locales),
the **`hreflang` tags** (nothing emits them — §7.6), the **UI string dictionary**,
and updated **hand-written types** in
[`lib/types.ts`](../../apps/storefront/src/lib/types.ts), where only `astro check`
will tell you they drifted. WPML does all four, which is most of why people pay
for it — the costs on that side are a licence, a join against `icl_translations`
on language-aware queries, and a migration away that has to rebuild the
relationships by hand. The field machinery you would be flagging is
[03 §3.3](../learn/03-payload.md).

---

## 7.6 Yoast becomes code you own — and nobody has written it yet

**WordPress:** Yoast — meta title and description with preview, canonicals, Open
Graph, XML sitemaps, article and breadcrumb schema, `robots.txt` editing,
readability analysis; the redirect manager is Premium.

**Here, today:** ✅ a `<title>` and one `<meta name="description">`. That is the
complete SEO surface, from
[`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro):

```astro
    <title>{title} · Astro + Payload + Medusa</title>
    <meta name="description" content={subtitle ?? 'A teaching stack for Astro, Payload and Medusa.'} />
```

```bash
grep -rn "canonical\|og:\|sitemap\|robots" apps/storefront/src | wc -l
ls apps/storefront/public/
```

```
0
favicon.ico  favicon.svg
```

No canonical, no Open Graph, no sitemap, no `robots.txt`, no structured data.
Per-page titles and descriptions *are* real — `posts/[slug].astro` passes the
post's title and excerpt into the layout — they are just the only thing that is.

**Say this out loud: Yoast is better than what you will hand-roll, for a long
time.** You are trading a maintained product for code you own. What you gain is
that the fields are yours — "fall back to the excerpt, truncated at 155
characters" is three lines in a component rather than a filter hook to discover.

### 7.6.1 The shape to build 🚫

**Not built. No commands in this subsection.**

**1 · The fields, in Payload.** Pure ACF muscle memory: a `group` named `seo` on
Posts and Pages holding `metaTitle` (text), `metaDescription` (textarea, max 160),
`ogImage` (upload → media) and `noIndex` (checkbox). Payload generates the admin
UI, the columns and the types. The `announcement` group in
[`SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts) is the working
example of the shape.

**2 · Render it.** Give `Layout.astro` an optional `seo` prop and emit the tags
there, so the fallback policy lives in one place rather than in every page.

**3 · Canonicals.** ⚠️ **`site` is not set in
[`astro.config.mjs`](../../apps/storefront/astro.config.mjs)**, so `Astro.site` is
`undefined` and there is no absolute origin to build a canonical URL from today.
That is one line, and it blocks everything else in this list.

**4 · The sitemap**, where the obvious option is wrong:

`@astrojs/sitemap` is the wrong tool: it enumerates routes at *build* time, and
every content route here is dynamic (`output: 'server'`). Write an SSR endpoint,
`src/pages/sitemap.xml.ts`, that queries Payload for published posts and pages,
emits XML and sets `Cache-Control`. That is also closer to what Yoast does — read
the database at request time rather than trust a build to have seen everything.
The routes in `src/pages/api/` are the template; `robots.txt` goes in `public/`.

**5 · What you still will not have.** No content analysis, no redirect manager, no
breadcrumb schema, no sitemap index pagination. If a client expects the Yoast
traffic-light, say so during scoping, not after.

---

## 7.7 WP Super Cache has no in-app equivalent, and nothing here caches 📋

**WordPress:** tick a box and PHP writes rendered HTML to disk. In the default
"simple" mode a small amount of PHP still runs to serve it; in the mod_rewrite
mode Apache serves the `.html` directly, without starting PHP or touching MySQL.

**Here:** nothing. Not "a different approach" — nothing.

```bash
grep -rn "Cache-Control\|s-maxage\|revalidate" apps/storefront/src apps/cms/src | wc -l
```

```
0
```

Every page render re-fetches from both backends, including the announcement
banner. [`Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) names the
cost it is choosing to pay:

```ts
 * 1. **This adds a Payload request to every single page render**, including the
 *    dashboard. That is exactly why globals are the first thing you cache in
 *    production (docs/learn/09-to-production.md §9.6) — the data changes
 *    monthly and is fetched thousands of times.
```

**Why the plugin model does not port.** WP Super Cache works because the cache is
a *file* and, in its fastest mode, the bypass is *the web server* — Apache serves
a `.html` without starting PHP. Astro with `output: 'server'` and the standalone
Node adapter has no
web server in front of it, so the equivalent is a reverse proxy or CDN,
instructed by headers you set in your own code.

| Layer | WordPress | Here | State |
|---|---|---|---|
| Full-page HTML | WP Super Cache writes `.html` | `Cache-Control: s-maxage` + a CDN | 🚫 |
| Object cache | `wp_cache_*` + a Redis drop-in | Redis **is** running; Medusa's cache module uses it | ✅ internals / 🚫 app data |
| Query / fragment cache | transients | nothing built in for SSR fragments | 🚫 |
| Purge on edit | hooks `save_post` | `Posts.afterChange` — **the seam exists and logs** | 🚫 |

```ts
    afterChange: [
      ({ doc, operation, req }) => {
        req.payload.logger.info(
          `[posts.afterChange] ${operation} id=${doc.id} slug=${doc.slug} status=${doc._status}`,
        )
      },
    ],
```

That log line is where a `POST /api/revalidate` belongs. ⚠️ **Authenticate that
endpoint when you add it** — an unauthenticated purge route hands an attacker a
button that makes every request a cache miss. The three layers in order of cost
are [09 §9.6](../learn/09-to-production.md).

Credit where due: **WordPress is simpler here, by a lot.** Install, tick, done.
This stack asks you to pick a layer, write the headers, build the purge path, and
authenticate it.

---

## 7.8 Security: what is actually true in this repo today

| Surface | Authentication | Rate limited | Note |
|---|---|---|---|
| Payload admin `:3000/admin` | ✅ users, cookies | 🚫 | real login, real roles, 5-attempt lockout |
| Payload REST `:3000/api/*` | ✅ API key or cookie | 🚫 | per-operation `access` functions |
| Medusa admin API `:9000/admin/*` | ✅ JWT | 🚫 **by design** | would lock out moderators |
| Medusa store API `:9000/store/*` | publishable key only | ✅ 240/60s | the key is not a secret |
| Astro pages `:4321/*` | 🚫 **none** | 🚫 exempt by design | |
| Astro `:4321/api/*` | 🚫 **none** | ✅ 120/60s | these take `DELETE` |
| Astro Actions | 🚫 **none** | ✅ | origin check on by default |

Astro's `security.checkOrigin` is on by default for SSR and is easy to mistake
for authentication. It is not:

```bash
curl -s -o /dev/null -w 'status=%{http_code}\n' \
  -X DELETE http://localhost:4321/api/reviews/rev_does_not_exist
curl -s -w '\nstatus=%{http_code}\n' -X DELETE -H 'Origin: http://localhost:4321' \
  http://localhost:4321/api/reviews/rev_does_not_exist
```

```
status=403
{"error":{"message":"Review not found."}}
status=502
```

No cookie, no token, no key — and the second request travelled through the
middleware, the endpoint and the admin client into Medusa, which rejected it
**only because the id does not exist**. Supply a real id and the review is gone.
The 403 asked *where did you come from*; nothing asked *who are you*.

⚠️ **Any visitor can create, edit and delete every post and review in this
application.** Deliberate in a teaching repo, disqualifying anywhere else. The fix
and two realistic session strategies are [09 §9.5](../learn/09-to-production.md).

Two things are genuinely better here. Credentials cannot reach the browser —
`output: 'server'` plus Astro's rule that non-`PUBLIC_` variables are stripped
from the client bundle makes `PAYLOAD_API_KEY` *structurally* unable to leak into
HTML — and [`lib/env.ts`](../../apps/storefront/src/lib/env.ts) throws at startup
on a missing key rather than producing a confusing 401 three files away.

Three things are worse. There are no security headers at all:

```bash
curl -s -D - -o /dev/null http://localhost:4321/posts \
  | grep -iE '^(HTTP|content-security|strict-transport|x-frame|x-content|referrer)'
```

```
HTTP/1.1 200 OK
```

⚠️ **`jwtSecret` and `cookieSecret` fall back to `'supersecret'`** in
[`medusa-config.ts`](../../apps/commerce/medusa-config.ts) when the environment
does not set them — a known JWT secret means anyone can mint an admin token. And
nobody patches your application code: WordPress means somebody else fixes bugs in
the plugins you installed, while here the shared surface is your dependency tree,
the tool is `npm audit`, and the application code is entirely yours.

---

## 7.9 Performance: fast pages, and one deliberate N+1

```bash
for p in / /posts /products /reviews; do
  printf '%-12s ' "$p"
  curl -s -o /dev/null -w 'ttfb=%{time_starttransfer}s bytes=%{size_download}\n' "http://localhost:4321$p"
done
```

```
/            ttfb=0.056442s bytes=37247
/posts       ttfb=0.031997s bytes=22672
/products    ttfb=0.042783s bytes=18673
/reviews     ttfb=0.027738s bytes=45444
```

⚠️ **Dev-server numbers on localhost, no network, no concurrency.** Useful as a
relative comparison between pages, useless as a production estimate.

What is fast is fast for structural reasons: exactly **one** `client:` directive
exists in the whole storefront (`ReviewFilter.tsx`, `client:visible`), seven of
the eight components are `.astro` and compile away, the dashboard runs five
backend calls in one `Promise.all`, and Payload's draft rule filters in SQL rather
than in a post-fetch loop.

The slow part is labelled on the page. `products/index.astro` lists products, then
fetches one rating per product — and you can count those requests without
instrumenting anything, because Medusa's limiter already counts them:

```bash
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
r() { curl -s -D - -o /dev/null -H "x-publishable-api-key: $PK" \
        'http://localhost:9000/store/reviews?limit=1' | grep -i 'x-ratelimit-remaining'; }
echo "before:"; r
for i in 1 2 3; do curl -s -o /dev/null http://localhost:4321/products; done
echo "after:"; r
```

```
before:
X-RateLimit-Remaining: 118
after:
X-RateLimit-Remaining: 102
```

Sixteen slots gone — 118 down to 102 — one of which is the "after" probe. The
absolute numbers depend on what else hit `/store/*` in the same minute; the
delta is the measurement. **Three renders cost
fifteen Medusa requests — five each**, against four products in the database:
one `listProducts` plus one `getProductReviews` per product. 1 + N, measured from
outside the application.

WordPress has the identical problem and fix — `WP_Query` in a loop calling
`get_post_meta()`, solved by priming the meta cache. What differs is the *cause*:
here it is a deliberate module boundary, because reviews and products live in
separate Medusa modules and cannot be joined in SQL. The fix is a route resolving
many products' reviews in one `query.graph` call;
[06 §6.8](06-the-worked-example.md) walks the request count and the batching
route, and [05 §5.9](../learn/05-astro.md) has the Astro side. Two further costs: every render fetches the site global (§7.7),
and prices are never fetched at all —
[`lib/medusa.ts`](../../apps/storefront/src/lib/medusa.ts) asks only for
`id,title,handle,description,thumbnail`.

---

## 7.10 Scalability: name the thing that breaks at instance #2

A WordPress site scales by adding PHP workers in front of one MySQL server, since
state lives in the database. This stack keeps more state in more processes, and is
deliberately explicit about which.

| Component | State lives in | At two instances |
|---|---|---|
| Astro rate limiter | a `Map` in the Astro process | **limit doubles, and is bypassable** |
| Astro request log | a 500-entry ring buffer in memory | each instance sees only its own traffic |
| Medusa rate limiter | a `Map` in the Medusa process | same |
| Medusa sessions | Redis (`projectConfig.redisUrl`) | ✅ |
| Medusa event bus / locking / workflows | Redis | ✅ jobs stay singular, executions persist |
| Payload media files | local disk, `apps/cms/public/media` | **instance-local; half your images 404** |
| Log viewer / backup panel | the local filesystem | each sees only its own machine |
| Payload schema | `push` mode, **no migration files on disk** | **a deployment blocker** |

The Redis rows are the good news and were not free —
[09 §9.3](../learn/09-to-production.md) documents four traps in configuring them,
including a deprecation warning you must ignore.

One row deserves its own paragraph. Medusa's limiter identifies a caller by
publishable key, from
[`api/rate-limit.ts`](../../apps/commerce/src/api/rate-limit.ts):

```ts
  const pk = req.headers["x-publishable-api-key"]
  if (typeof pk === "string" && pk.length > 0) {
    // Only the tail — enough to distinguish callers, never the whole secret in
    // a Map that might end up in a heap dump.
    return `pk:${pk.slice(-12)}`
  }
```

The storefront calls Medusa **server side**, with one key. So every visitor shares
a single bucket of 240 a minute — at five requests per `/products` render, roughly
**48 product-page views a minute, site-wide**, before real traffic starts getting
429s. A publishable key beats an IP for a *browser* client and is the wrong
identity for a BFF, where it names the application rather than the caller. §7.2.2
is what that failure looks like from the monitoring side.

⚠️ **Payload runs in `push` mode with no migration files on disk.** `push` diffs
config against the live database and applies the difference: wonderful in
development, unacceptable in production, because it does not cleanly drop columns
and can block startup waiting for an interactive `DATA LOSS WARNING … Accept?
(y/N)` nobody is watching. `push: false` and real migrations before anything
ships — [09 §9.2](../learn/09-to-production.md).

---

## 7.11 Maintainability: more tooling, less ecosystem

```bash
npm run typecheck
npm --prefix apps/storefront run test
```

```
> cms@1.0.0 typecheck
> tsc --noEmit
…
> storefront@0.0.1 typecheck
> astro check
[check] Getting diagnostics for Astro files in …/apps/storefront...
Result (44 files): 
- 0 errors
- 0 warnings
- 0 hints

 Test Files  2 passed (2)
      Tests  20 passed (20)
   Duration  125ms
```

Twenty unit tests cover the Lexical renderer (including XSS escaping) and the rate
limiter, plus `npm run test:compensation`, which deliberately fails a workflow step
and asserts no orphaned review survives the rollback.

Payload generates `apps/cms/src/payload-types.ts` — 668 lines of interfaces — and
**the storefront imports none of it**, hand-writing its own shapes in
[`lib/types.ts`](../../apps/storefront/src/lib/types.ts). That file's header
argues the case and names the cost; [03 §3.11](03-payload-for-acf-and-cpt.md)
quotes it in full and shows the grep that proves nothing imports the generated
file.

**Do not read that as "TypeScript gives you end-to-end type safety across
services".** It does not, here or anywhere, across a network boundary. You get a
written-down contract that a compiler checks on *one* side. The WordPress habit it
replaces is reading `$post->post_title` with nothing checking the shape; the habit
it demands is remembering that the same unchecked assumption has merely moved into
`types.ts`.

| | WordPress | Here |
|---|---|---|
| Updating dependencies | one Updates screen | three `package.json` files, no auto-update |
| Somebody else fixing your bugs | the plugin author | **you** |
| Adding a feature that exists as a plugin | install it | build it |
| Catching a typo before runtime | PHPStan or Psalm, if you add them | `tsc --noEmit`, already wired |
| Knowing the data shape | `get_post_meta` returns `mixed` | declared and checked |
| Testing business logic | PHPUnit and the WP test suite, once stood up | 20 tests in 125ms |
| Rolling back a half-written multi-step write | MySQL transactions, if you drive them yourself | workflow compensation, with a test |

**The comment density in this repo is a teaching decision, not a template.**
Normal projects do not look like this and should not. The symptom-to-fix table is
[07 · Troubleshooting](../learn/07-troubleshooting.md); the two schemas, and which
tables Payload injects for you, are [10 · Databases](../learn/10-databases.md).

---

## Check yourself

1. UpdraftPlus restores from a button and this repo does not. Name two things the
   button would have to check first, and say which one `db-import.sh` refuses on.
2. Your `/api/health` probe was recorded as a 429 during a load test. Who is
   wrong — the limiter, the health check, or the monitor — and what do you change?
3. WP-Cron fires on visitor requests. Describe a bug that behaviour *causes*, and
   a different bug Medusa's scheduler causes instead.
4. A client wants a contact form with an entries screen, an email notification and
   a CSV export. Which does this stack give you almost free, and where does the
   notification belong — the Action or the hook?
5. A site has English, German and Maltese versions, and Maltese publishes three
   weeks later. Does Payload's field-level localization fit? If not, what would
   you add?
6. The repo sets `<title>` and one `<meta name="description">`. List the first
   three things you would add, and say which is blocked until `astro.config.mjs`
   sets `site`.
7. Three `/products` renders consumed fifteen Medusa requests. Where does the 1+N
   come from, why can a SQL join not fix it, and what would you build instead?
8. You are asked to run two Astro instances behind a load balancer tomorrow. Name
   three things that break, and which of them is a correctness bug rather than a
   performance one.

---

**Next:** [08-cheat-sheet.md](08-cheat-sheet.md) — every mapping in this track as
lookup tables, with links back to the chapter that explains it.
