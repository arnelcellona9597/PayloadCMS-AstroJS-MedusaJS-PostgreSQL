# 12 · Operating it

Chapters 1–11 are about making the app work. This one is about the different
question you face once it does: **is it working right now, and how would you
know?**

Four features were added to answer that, and they are deliberately built in four
different places:

| Feature | Lives in | Because |
|---|---|---|
| Uptime history | a Medusa module with its own table | history questions need durable storage |
| Request log | memory, in the Astro process | a log write must cost less than the request it logs |
| Workflow states | Medusa's `workflow_execution`, via Redis | the orchestrator already owns this data |
| Log viewer | files on disk | three services, three loggers, one filesystem |
| Backups | shell scripts, plus a read-only panel | the dangerous half must not be a web button |

If you read nothing else here, read [§12.1](#121-the-decision-that-shapes-all-of-this)
and [§12.8](#128-where-every-signal-here-is-blind).

Open [http://localhost:4321/monitor](http://localhost:4321/monitor) while you
read.

---

## 12.1 The decision that shapes all of this

The repo's rule so far has been: **Astro owns no data and reaches backends over
HTTP only** ([01 §1.4](01-foundations.md)). Monitoring is the first thing that
appears to break it, and working out why it does not is most of the design.

The resolution is a question, asked per signal:

> **Does answering this require knowing about the past?**

- **Uptime** is a history question. "Was it down at 3am?" cannot be answered by
  anything that forgot. It needs a table → Medusa module, own migration.
- **Request rate** is a right-now question. "What is happening in the last
  minute?" A ring buffer in memory answers it, and persisting one row per
  request would cost an HTTP round trip *per request* — often slower than the
  request being recorded, and it would make serving a static page depend on a
  backend being up.

So the rule holds, with one clarification: Astro owns no **domain** data. It does
own its own **process state**, and a buffer of what this process just served is
process state, not domain data.

That is why `/monitor` reads three of its panels by direct import and two over
HTTP. It looks inconsistent and is not:

```
requests, logs, backups   →  import   (this process, this machine)
uptime, workflows         →  fetch    (Medusa owns the tables)
```

Fetching `/api/monitor` from the page would mean the server making an HTTP
request to itself for data already in its own memory.

---

## 12.2 Uptime: measuring from outside

`apps/commerce/src/jobs/uptime-check.ts` runs every minute and requests all three
services, including Medusa itself.

**Why in Medusa and not Astro?** Astro has no scheduler. Medusa has one, and it
already has the module system for the table. Writing a second module was also the
point: the first one was the hardest part of [chapter 4](04-medusa.md), and doing
it again is the best consolidation available.

**Why measure from outside at all?** A service cannot credibly report that it is
down. The most useful failure this catches is a service that is *up* and *wrong*
— which is why the storefront target requests `/api/health` rather than the
process merely being asked whether it is alive.

Three details that matter more than the polling:

**A timeout, always.** `AbortSignal.timeout(5000)` — without it a hung service
makes the monitoring job hang too, and you lose the monitor and the service in
one go.

**`Promise.all`, not sequential.** Three sequential checks with a 5-second
timeout each could take 15 seconds, inside a job that runs every 60. Checks
should be simultaneous so they describe the same moment.

**Pruning.** One row per target per minute is 4,320 rows a day. `pruneOlderThan`
keeps a week. Monitoring data that grows without bound becomes its own incident.

The aggregation lives in the module service, not the route:

```ts
await ops.uptimeSummary(24)   // uptime %, streak, last incident, avg latency
```

So a CLI script, the admin panel and the storefront all get identical arithmetic.
Uptime percentages that disagree depending on where you read them are worse than
none.

### The honest-empty problem

`GET /admin/uptime` returns a `monitoring` boolean, and this is the pattern worth
stealing from this chapter:

```json
{ "targets": [], "monitoring": false,
  "note": "No checks recorded yet. The uptime job runs every minute…" }
```

An empty result and a healthy result must not look the same. "No failures
recorded" reads as 100% uptime when it actually means *nothing has ever been
measured*. Every endpoint added in this chapter states which one it is.

---

## 12.3 The request log, and the blind spot in it

`apps/storefront/src/middleware.ts` already saw every request, for rate limiting
([09 §9.7b](09-to-production.md)). Adding a ring buffer costs nothing extra.

`lib/request-log.ts` keeps the last 500 requests plus running totals. The totals
are separate from the buffer on purpose — otherwise "requests since start" would
quietly become "requests in the last 500 requests".

It reports p50 and p95 rather than a mean, because an average hides the slow
tail, which is the only part anyone complains about.

### It cannot see what never reached it

Try this:

```bash
curl -X DELETE localhost:4321/api/reviews/nope
```

That returns **403**, and it does **not** appear in the request log. Now:

```bash
curl -X DELETE -H 'Origin: http://localhost:4321' localhost:4321/api/reviews/nope
```

That reaches the endpoint, and *is* logged.

The 403 comes from Astro's `security.checkOrigin`, which is on by default for
SSR and runs **upstream of middleware**. The lesson generalises well past Astro:
**application-level request logging cannot see what was rejected before the
application ran.** The same hole swallows anything a reverse proxy, WAF or load
balancer turns away. If your traffic graph and your users disagree about whether
requests are arriving, this gap is where to look — and the framework's own log
sits further out and *does* record them.

### The monitor must not be throttled by what it monitors

This one was found by accident. Sending 140 requests to `/api/reviews` exhausts
the 120/minute budget, and the next call to `/api/monitor` returned:

```json
{"error":{"message":"Too many requests.","detail":"… Retry in 31s."}}
```

The monitoring endpoint was rate-limited by the limiter it exists to report on.
Under a flood — the one moment the request log is worth reading — the way to read
it goes dark, and rate limiting working correctly looks like a total outage.

`isObservability()` in the middleware now exempts these paths from **both** the
limiter and the log, from one shared list:

```ts
function isObservability(url: URL): boolean {
  return url.pathname.startsWith('/api/monitor') ||
         url.pathname.startsWith('/api/logs') ||
         url.pathname === '/monitor'
}
```

Two exemptions, one reason: **a tool that measures a system must not become part
of what it measures.** Excluded from the log because polling would fill the
buffer with records of reading the buffer; excluded from the limiter because
otherwise it disappears exactly when needed.

Exempting paths from a limiter is normally a mistake — it leaves an unthrottled
surface. It is defensible here because these are read-only and do no backend
work. In production they belong behind authentication or on an internal
interface, which is the real answer.

---

## 12.4 Workflow states: monitoring that was lying

This is the most instructive of the four, because the wrong version of it is so
convincing.

Medusa has a `workflow_execution` table with a `state` column. On a fresh
install it exists and contains **zero rows** — after workflows have run, and
after workflows have *failed*. The default in-memory engine keeps executions in
the process and discards them.

So the obvious dashboard — "failed workflows: 0" — is not monitoring. It is a
number that reads zero whether none failed or all of them did. **That is worse
than no monitoring, because it is reliably reassuring.**

Two changes are needed, and both are required:

1. `@medusajs/workflow-engine-redis` in `medusa-config.ts`, so there is somewhere
   durable to write ([09 §9.3](09-to-production.md) has the four traps in
   configuring it).
2. `{ store: true, retentionTime: 3600 }` on each `createWorkflow()` — because
   even the Redis engine discards a finished execution unless that workflow
   asked to be kept. **Retention is opt-in per workflow.**

Miss either and `/admin/workflows` returns an empty list that looks like good
news.

### `reverted` is not `failed`

`GET /admin/workflows` folds Medusa's seven `TransactionState` values into four
buckets, and the interesting line is that `reverted` sits apart from `failed`:

| Bucket | States | Means |
|---|---|---|
| successful | `done` | finished |
| pending | `not_started`, `invoking`, `waiting_to_compensate`, `compensating` | in flight |
| **reverted** | `reverted` | failed, and **every compensation ran** |
| **failed** | `failed` | failed, and could **not** be rolled back |

`reverted` is the *success case of failure handling*: something broke and the
workflow undid everything it had already done, leaving no half-written data.
`failed` is the one to wake someone for — it may have left orphans.

Collapsing both into one "errors" count throws away exactly the distinction worth
paging about.

### Seeing a rollback from the inside

Chapter 4 proved compensation works by counting rows. Now you can read the
orchestrator's own record of it:

```bash
DEMO_FAIL_LINK_STEP=1 npm run test:compensation
```

Then open `/monitor`, or:

```bash
curl -s -H "Authorization: Bearer $TOKEN" 'localhost:9000/admin/workflows?state=reverted'
```

```
create-review -> reverted
  ..validate-product              invoke=done/ok                   comp=reverted
  ....create-review               invoke=done/ok                   comp=reverted
  ......link-review-to-product    invoke=failed/permanent_failure   comp=reverted
  ........emit-event-step         invoke=not_started/idle           comp=dormant
```

Read top to bottom and the rollback tells its own story: the link step failed
permanently, the two steps that had already succeeded were compensated in
reverse order, and the step *after* the failure never ran — so it has nothing to
undo and sits `dormant`.

That is what "the database has no orphans" looks like from the inside. Note
`status` next to `state`: `state: failed` says a step failed, `status:
permanent_failure` says it will not be retried.

---

## 12.5 Backups: the dump is the easy part

`npm run db:export` writes:

```
backups/2026-09-18T11-27-28Z/
├── payload_crud.dump      custom format (-Fc), so pg_restore can be selective
├── medusa_crud.dump
├── media.tar.gz           only if apps/cms/public/media has files
└── manifest.json          the part that makes the dumps trustworthy
```

**`pg_dump` runs inside the container.** The container has Postgres 17.11; this
machine's client is 17.7, and a client older than the server refuses:

```
pg_dump: error: server version: 17.11; pg_dump version: 17.7
pg_dump: error: aborting because of server version mismatch
```

Using the container's own binary makes client and server the same build by
construction. Note `docker exec` **without `-t`** — a TTY would translate
newlines in the binary stream and produce a dump that only fails at restore time.

### What the manifest is for

A dump alone is not a backup; it is a snapshot of data *in a schema shape*. The
manifest records the migration ledgers and exact per-table row counts at export
time, which buys four checks in `db:import`:

**1 · Integrity.** sha256 per dump. An export interrupted by a full disk leaves a
plausible-looking file that fails halfway through a restore — when half the old
data is already gone.

**2 · Migration drift.** The hard stop:

```
! medusa_crud    DRIFT
!     dump:    mikro_orm:184 links:21 scripts:5
!     current: mikro_orm:185 links:21 scripts:5
```

Restoring a dump taken *before* a migration gives you old data in a shape the
running code no longer expects — neither the old state nor the new one, with
errors surfacing far from the cause. **This is the failure mode that makes naive
restores dangerous.**

**3 · Active connections.** Postgres will not drop objects another session holds
open, so the script terminates other sessions itself and says so.

**4 · Verification.** After restoring, it recounts every table and compares
against the manifest **per table, not as a total** — two tables off by +3 and −3
would net to zero and a total-only check would call that success.

```
payload_crud   15 tables, 44 rows -- matches the manifest exactly
medusa_crud    58 tables, 982 rows -- matches the manifest exactly
```

### Three things a restore quietly breaks

**API keys.** Payload's key and Medusa's publishable key live *in* these
databases. Restoring replaces them with the ones from the dump, while your
`.env` and Postman environment still hold the old values — the same problem as
`db:reset`. `db:import` ends by telling you to run `npm run postman:env`.

**Media files.** Payload stores upload *metadata* in Postgres and the *files* on
disk. A database-only restore leaves rows pointing at files that are not there,
and every image 404s. `db:export` tars them — a workaround for local-disk
storage ([09 §9.7](09-to-production.md)), not a solution to it.

**Pooled connections.** The apps hold connections that the restore terminated.
Restart them.

### Why there is no button

The `/monitor` backup panel is **read-only**, and the absence of the buttons is
the decision:

- A "create backup" endpoint on an app with **no authentication**
  ([09 §9.5](09-to-production.md)) puts a complete copy of both databases one
  unauthenticated GET away — data exfiltration dressed as convenience.
- A "restore" button would be worse: an unauthenticated endpoint that destroys
  the current database.

The dangerous half stays in scripts you run from a shell, where the operating
system has already decided you are allowed. **The blast radius of a button is
the blast radius of whoever can press it.**

### Do the round trip yourself

A backup nobody has restored is a hypothesis. This one has been restored into a
deliberately emptied volume:

```bash
npm run db:export
npm run db:reset                    # deletes the Docker volume outright
npm run db:import                   # newest backup, with confirmation
```

Then check the app still works. If the row counts match the manifest and
`/monitor` renders, the backup is real.

---

## 12.6 Logs: two formats, and why that is the lesson

`npm run dev` tees Payload's and Medusa's stdout to `logs/`. Astro is different,
and finding out why took a while:

**Astro 7 backgrounds its own dev server when stdout is not a TTY**, and writes
structured JSON-lines to `apps/storefront/.astro/dev.log`. So the `tee` captures
only the launcher's startup line, and the real log is Astro's:

```json
{"message":"[200] /api/reviews 19ms","label":null,"level":"info"}
```

This also explains a confusing symptom: a detached instance keeps running after
you think you stopped it. A stale one predating a new route file will 404 that
route forever. `npx astro dev stop` is the fix, and `astro dev status` tells you
what is actually running.

So `lib/log-reader.ts` handles both, and the asymmetry is kept rather than papered
over:

```ts
cms:        { file: 'logs/cms.log',                    format: 'text' }
commerce:   { file: 'logs/commerce.log',               format: 'text' }
storefront: { file: 'apps/storefront/.astro/dev.log',  format: 'json' }
```

For Astro the level is **read**. For the other two it is **guessed** from the
words in the line:

```ts
if (/\b(fatal|error|err|exception|unhandled|failed)\b/.test(t)) return 'error'
```

That guess is wrong sometimes — an informational line containing the word
"error" is misfiled. Put the two paths side by side and the argument for
structured logging makes itself: one is exact, the other is a regex over prose.
The imprecision is left visible rather than hidden behind a clean API.

One refinement worth noting: Astro logs every request at `info`, including 5xx.
Taken literally, a page full of 500s would read as "no errors", so the reader
upgrades `[5xx]` to error and `[4xx]` to warn. **Trusting a structured level is
right; trusting it blindly is not.**

⚠️ This reads the local filesystem, which works only because all three services
share a machine in development. In production logs are shipped, not tailed
([09 §9.8](09-to-production.md)).

---

## 12.7 Reading the four together

No single panel is the answer. The diagnoses come from disagreements between
them.

**Uptime green, requests red.** The health endpoint answers while real requests
fail — usually a dependency the health check does not touch. A health check that
only proves the process is listening will always miss this.

**Requests fine, workflows failing.** The HTTP response was 200 because the work
is asynchronous: the user was told it worked. This is the gap most monitoring
has. Check whether the state is `reverted` (clean) or `failed` (may have left
orphans).

**Uptime shows a gap nothing else explains.** Look at what restarted. Uptime
samples once a minute and is measured from outside, so it catches restarts the
in-process request log cannot see — that buffer resets on restart and loses the
evidence.

**Everything green, backup a week old.** The only panel that describes the
future. The other four tell you about a system that is currently working; this
one tells you what you keep if it stops.

**All four quiet, users complaining.** Suspect the blind spots, and they are
known ones — see below.

---

## 12.8 Where every signal here is blind

Every one of these has an edge. Knowing where it is, is the difference between
monitoring and reassurance.

| Signal | Cannot see |
|---|---|
| Request log | anything rejected before middleware (origin check, proxy, WAF); anything served by another instance; anything before the last restart |
| Uptime | outages shorter than its 60-second interval; anything wrong that still returns 200 |
| Workflows | workflows whose `createWorkflow` lacks `store`/`retentionTime`; executions past `retentionTime` |
| Logs | anything a service wrote before the `tee` started; anything past the 256 kB tail; the correct level, for two of three services |
| Backups | whether the dump would actually restore — until you try it |

Two of these are structural rather than fixable here: the request log and the
rate limiter are **per-process**, so a second Astro instance would see its own
traffic and nothing else. That limitation is kept deliberately — a working
demonstration of why per-process counters break under scaling is worth more in a
teaching repo than one fewer caveat.

**The biggest gap is not in the table.** Every signal here requires a human to
open a page. There are no alerts. Monitoring that nobody is looking at is
documentation.

---

## 12.9 Try it yourself

**1 · Make uptime record a real outage.** Stop Payload, wait two minutes,
restart:

```bash
kill $(ss -ltnp | grep ':3000 ' | grep -oP 'pid=\K[0-9]+' | head -1)
```

Then poll `/admin/uptime?hours=1`. The sequence looks like this:

```
before    up=True   streak=32  failures=2  94.1%
+30s      up=False  streak=1   failures=3  91.4%   err="fetch failed"
recovery  up=True   streak=1   failures=3  91.7%
```

Three things to notice.

**The streak resets to 1 in both directions.** It counts consecutive checks in
the *current* state, so `up=True streak=1` means "just recovered" and
`up=True streak=32` means "solid for half an hour". A boolean alone cannot tell
you those apart.

**Detection takes up to a minute**, because the job samples once a minute. An
outage shorter than that interval leaves no trace at all — sampling frequency
*is* your blind spot size.

**And now the interesting part.** Check the incident list, and you will probably
find *two* failures at the same timestamp:

```
2026-09-18T11:50:00.416Z  storefront  HTTP 503
2026-09-18T11:50:00.416Z  payload     fetch failed
```

You stopped one service and two went unhealthy. The storefront was running fine
— its `/api/health` endpoint returned **503 on purpose**, because it checks its
dependencies and Payload was one of them.

That is a dependency outage propagating into a dependent service's health check,
and it is worth sitting with, because it cuts both ways:

- It is **correct**. A storefront that cannot reach its CMS cannot serve pages,
  so reporting itself healthy would be a lie.
- It also means **one root cause produces two alerts**, and neither one says
  which failed first. With a deeper dependency chain you get an alert storm
  pointing at everything except the cause.

Distinguishing "I am broken" from "something I depend on is broken" is what
separates a health check from a useful one. Compare this with `/monitor`'s
request panel during the same window: Astro kept serving 200s for pages that do
not touch Payload — so the storefront was *degraded*, not down, and no single
boolean captures that.

**2 · Make the request log disagree with uptime.** Exhaust the rate limit, then
compare panels:

```bash
for i in $(seq 1 140); do curl -s -o /dev/null localhost:4321/api/reviews; done
```

Uptime stays green (health checks are exempt from nothing — they just fit in
budget) while the request log fills with 429s. Both are correct. Neither alone
tells you what happened.

**3 · Prove the workflow table would have lied.** Comment out `store: true` in
`apps/commerce/src/workflows/create-review.ts`, restart, run
`npm run test:compensation`, and watch `/admin/workflows` report nothing while
the test proves a rollback happened.

**4 · Find the request log's blind spot.** The two `curl -X DELETE` commands in
[§12.3](#123-the-request-log-and-the-blind-spot-in-it). One is invisible.

**5 · Break a backup and watch it refuse.**

```bash
npm run db:export
head -c 40000 backups/<newest>/payload_crud.dump > /tmp/t && mv /tmp/t backups/<newest>/payload_crud.dump
npm run db:import -- backups/<newest>
```

It stops at the checksum, before touching either database — which is the point,
since restoring one of two databases is worse than restoring neither.

---

## 12.10 Command reference

| Command | What |
|---|---|
| `npm run db:export` | dump both databases + media + manifest |
| `npm run db:import` | restore newest backup (confirms first) |
| `npm run db:import -- backups/<dir>` | restore a specific one |
| `FORCE=1 npm run db:import -- <dir>` | skip prompts (still honours the checksum) |
| `npm run logs` | tail all three service logs |
| `npm run logs:errors` | grep warnings and errors out of them |
| `docker exec apm-redis redis-cli dbsize` | prove Redis is carrying load |
| `npx astro dev status` / `stop` | find and stop a detached Astro dev server |

| Endpoint | What |
|---|---|
| [`/monitor`](http://localhost:4321/monitor) | all five panels |
| `/api/monitor` | request log summary + recent requests (JSON) |
| `/api/logs?level=error&service=commerce` | filtered log lines (JSON) |
| `/admin/uptime?hours=24` | uptime history (Medusa, admin JWT) |
| `/admin/workflows?state=failed` | workflow executions (Medusa, admin JWT) |

---

## Where next

- [09 · To production](09-to-production.md) — what this still is not: alerting,
  off-box log storage, scheduled restores
- [10 · Databases](10-databases.md) — `uptime_check` and `workflow_execution` in
  the wider schema
- [11 · Capstone](11-capstone.md) — build a feature across all three services,
  and now instrument it
