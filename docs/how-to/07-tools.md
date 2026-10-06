# 7 · Tools — viewing the database and everything else

> Background reading: [10 · Databases](../learn/10-databases.md) explains what is
> *in* these two databases and why there are two of them;
> [02 · Infrastructure](../learn/02-infrastructure.md) explains what is running,
> on which port, and how to take a port back. This page is about the tools you
> point at all of it.

You have reached for phpMyAdmin or Adminer on every WordPress project you have
ever shipped. The equivalent question here has a good answer, several of them in
fact, and it is answered nowhere else in this repo — so this page starts there
and then covers the rest of the toolkit.

One thing to get straight before anything else, because it changes how you use a
database GUI here: in WordPress, editing `wp_posts` in phpMyAdmin is *risky*. In
this stack it is *architecturally wrong*. §7.6 shows you the evidence rather than
asking you to take it on trust.

---

## 7.1 Every client wants the same five values, and the port is 5433

**In WordPress:** your host handed you a phpMyAdmin link, already logged in, and
you never typed a connection string. If you ran Local or ddev, the credentials
were in a panel somewhere.

**Here:** Postgres runs in a Docker container defined by
[`infra/docker-compose.yml`](../../infra/docker-compose.yml). Everything — pgAdmin,
DBeaver, `psql`, the three apps — connects with the same five values.

| Setting | Value |
|---|---|
| Host | `localhost` |
| **Port** | **`5433`** |
| User | `postgres` |
| Password | `postgres` |
| Databases | `payload_crud`, `medusa_crud` |

⚠️ **The port is 5433, not 5432, and this is the single most common way the
connection fails.** Postgres's default is 5432 and every tutorial, every default
field in every GUI and your own muscle memory will say 5432. The compose file
says why in a comment at the top of the file:

```yaml
# infra/docker-compose.yml
# Port 5433 (not 5432) on purpose: this machine already has a local
# PostgreSQL 18 service on 5432 and ddev containers bound to other ports.
# Mapping to 5433 means this stack never fights with either of them.
…
    ports:
      - "5433:5432"
```

Read that mapping as **host:container**. Inside the container Postgres still
listens on 5432, which is why `docker exec` commands never mention 5433 — they
are already inside. Only things connecting from outside the container use 5433.
That includes all three apps:

```bash
for f in apps/cms/.env apps/commerce/.env; do
  printf '%-22s ' "$f"; grep '^DATABASE_URL=' "$f" | sed 's/postgres:postgres/postgres:******/'
done
```

```
apps/cms/.env          DATABASE_URL=postgres://postgres:******@localhost:5433/payload_crud
apps/commerce/.env     DATABASE_URL=postgres://postgres:******@localhost:5433/medusa_crud
```

**Verify** — the container is up, the port is mapped, and both databases exist:

```bash
docker ps --filter name=apm-postgres --format '{{.Names}}  {{.Image}}  {{.Ports}}  {{.Status}}'
docker exec apm-postgres psql -U postgres -At -c '\l' | cut -d'|' -f1 | head -3
```

```
apm-postgres  postgres:17-alpine  0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp  Up 2 hours (healthy)
medusa_crud
payload_crud
postgres
```

⚠️ **`medusa_crud` and `payload_crud` cannot be joined to each other.** A Postgres
connection belongs to one database, so no GUI, no view and no clever query will
let you `JOIN` a Payload post to a Medusa review. That is deliberate, and
[`infra/init/01-databases.sql`](../../infra/init/01-databases.sql) says so in its
first comment. WordPress put everything in one database and `JOIN`ing `wp_posts`
to `wp_woocommerce_order_items` was always available to you; it is not available
here, and [10 §10.1 Where they live, and why there are two](../learn/10-databases.md)
is the argument for why that constraint is worth the loss.

**Going deeper:** [02 §2.5 Connection strings, dissected](../learn/02-infrastructure.md)
and [10 §10.1 Where they live, and why there are two](../learn/10-databases.md).

---

## 7.2 Six options, honestly compared

There is no single answer the way phpMyAdmin was the single answer. Pick one and
stop shopping.

| Tool | What it is | Closest WordPress analogue | Cost | The honest trade-off |
|---|---|---|---|---|
| **pgAdmin 4** | The Postgres project's own admin app. Runs a local web server and renders it in a desktop window (or a real browser, in server mode). | phpMyAdmin, almost exactly | Free, open source | Closest to what you know, and the most capable introspection. Also the slowest and the most cluttered — the tree view has a dozen node types you will never open. **Already installed on this machine** (§7.3). |
| **DBeaver** | Desktop IDE for ~80 database engines | phpMyAdmin plus a real SQL editor | Free (Community Edition) | Much better query editor and results grid than pgAdmin; a Java desktop app, so it is heavy to start. Best choice if you also touch MySQL/MariaDB for your WordPress work — one tool for both. |
| **TablePlus** | Native desktop client | — | Paid, with a free tier that caps how many tabs and connections you can open at once | The fastest and nicest of the lot. The free tier is usable for a stack this size, but it will nag, and the cap is worth checking before you rely on it. |
| **Beekeeper Studio** | Native desktop client | — | Free Community Edition, paid Ultimate | Lighter than DBeaver, prettier than pgAdmin, fewer features than either. A good middle. |
| **Adminer** | A single PHP file serving a web UI | **This is the literal analogue** — it was written as a lighter phpMyAdmin replacement: one file, drop it in, no install | Free, open source | Can be added to this repo's compose file as one more service and reached in a browser like phpMyAdmin (§7.4). 📋 **Not configured here.** |
| **`psql`** | The official terminal client | WP-CLI's `wp db cli` | Free, already present | No install, no GUI, works over SSH, and every command in this repo's docs is written for it. Steepest first ten minutes, flattest curve after (§7.5). |

**The recommendation, plainly:** use `psql` for the checks in these docs, because
every doc is written in it and the one-liners are copy-pasteable. Use pgAdmin when
you want to *browse* — when you do not yet know the name of the table you are
looking for. That is exactly the division of labour you already had between
WP-CLI and phpMyAdmin.

---

## 7.3 How to connect pgAdmin 4 to this stack ✅

**In WordPress:** you clicked the phpMyAdmin link in cPanel.

**Here:** pgAdmin is a separate application that has never heard of this project,
so you register the server once. It is installed already — version 9.11, at
`C:\Users\infoa\AppData\Local\Programs\pgAdmin 4`.

**Steps**

1. Start the database if it is not running. From the repo root:

   ```bash
   npm run db:up
   ```

2. Launch **pgAdmin 4** from the Windows Start menu. Desktop mode starts
   pgAdmin's own web server on `127.0.0.1` on a random port and shows it in an
   application window. That port is pgAdmin's, not your database's.
3. On first launch it asks you to set a **master password**. This encrypts the
   saved connection passwords in pgAdmin's own config. It is not the database
   password and it is not stored anywhere in this repo. Pick one and write it
   down.
4. In the left-hand browser tree, right-click **Servers** → **Register** →
   **Server…**.
5. On the **General** tab, set **Name** to something you will recognise later —
   `apm-postgres` matches the container name.
6. Switch to the **Connection** tab and fill in exactly five fields:

   | Field | Value |
   |---|---|
   | Host name/address | `localhost` |
   | Port | `5433` |
   | Maintenance database | `postgres` |
   | Username | `postgres` |
   | Password | `postgres` |

7. Tick **Save password** so you are not retyping it, and press **Save**.
8. Expand **apm-postgres → Databases**. You should see `medusa_crud`,
   `payload_crud` and `postgres`.
9. To read a table: **payload_crud → Schemas → public → Tables → posts**,
   right-click → **View/Edit Data** → **All Rows**. That is phpMyAdmin's
   **Browse** tab.
10. To run SQL: select a database first, then **Tools → Query Tool**. The
    database you had selected is the database you are querying — there is no
    `USE` statement in Postgres.

**Verify** — the same answer from the command line proves pgAdmin is pointed at
the right server, not at some other Postgres on the machine:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c 'select count(*) from posts;'
```

```
 count 
-------
    11
(1 row)
```

Your number will differ; the row count moves every time anybody saves a post, and
a full `npm run postman:test` adds one.
What matters is that pgAdmin's `posts` grid and that number agree.

⚠️ **WSL2 caveat: the host is `localhost`, not a WSL IP address.** You will find
advice telling you to run `hostname -I` in WSL and use that address from Windows.
You do not need it here. Docker Desktop publishes the container's port onto the
Windows host, so `localhost:5433` works from a Windows application. If
`localhost` fails, try `127.0.0.1` before anything more exotic — some Windows
builds resolve `localhost` to IPv6 `::1` first and pgAdmin occasionally trips on
it. The container does bind both stacks:
`0.0.0.0:5433->5432/tcp, [::]:5433->5432/tcp`.

⚠️ **"Maintenance database" is not "the database you want".** It is the database
pgAdmin connects to in order to *list the others*. Leave it as `postgres`. If you
put `payload_crud` there it still works, but you lose the `postgres` database
from the tree, which is the one that is always there even if both app databases
are dropped.

⚠️ **`connection refused` almost always means the port.** Check 5433 before
anything else, then check `docker ps` shows `apm-postgres` as `(healthy)`.

**Going deeper:** [10 §10.6 Reading a schema you didn't design](../learn/10-databases.md)
— four questions that decode most of the 146 tables in `medusa_crud`.

---

## 7.4 How Adminer would be added to this stack 📋

**In WordPress:** you dropped `adminer.php` into the web root and opened it. One
file, no install, delete it when done.

**Here:** the same idea, as a container. Adminer is the closest thing in spirit
to what you are used to — one PHP file, a login form, a table list, a Browse tab
— and because this repo already runs Docker Compose, adding it is one service
block rather than an install.

📋 **This is not configured in this repo.** There is no Adminer service in
[`infra/docker-compose.yml`](../../infra/docker-compose.yml) today, so nothing on
this page starts one. The steps below are what you would do, written out in full
so they are followable — but step 3 is the first one that actually changes
anything, and nothing here runs until you have done step 2.

**Steps**

1. Check the host port is free before you claim it. `8080` is taken on this
   machine by a WordPress container, so the block below uses `8081`:

   ```bash
   docker ps --format '{{.Names}}  {{.Ports}}' | grep -E '8080|8081' || echo '8081 is free'
   ```

   ```
   aps-app-plugin-wordpress-1  0.0.0.0:8080->80/tcp, [::]:8080->80/tcp
   ```

2. Add this service to `infra/docker-compose.yml`, indented to the same level as
   the existing `postgres` and `redis` services:

   ```yaml
   # infra/docker-compose.yml — NOT PRESENT TODAY. This is what you would add.
     adminer:
       image: adminer:5
       container_name: apm-adminer
       restart: unless-stopped
       ports:
         - "8081:8080"
       environment:
         ADMINER_DEFAULT_SERVER: postgres
       depends_on:
         postgres:
           condition: service_healthy
   ```

3. Bring the stack up again from the repo root with `npm run db:up`. Compose
   creates the new container and leaves `apm-postgres` alone.
4. Open `http://localhost:8081` and log in with **System** PostgreSQL, **Server**
   `postgres`, **Username** `postgres`, **Password** `postgres`, **Database**
   `payload_crud`.
5. Click `posts` in the table list. That is phpMyAdmin's Browse tab, and the row
   count should match the `select count(*) from posts;` in §7.3.

**Verify, once it exists** — `docker ps` would list `apm-adminer` publishing
`0.0.0.0:8081->8080/tcp`, and `curl -s -o /dev/null -w '%{http_code}' http://localhost:8081/`
would return `200`. Today it returns `000`, because nothing is listening.

Three things in that block are worth understanding rather than copying:

| Line | Why |
|---|---|
| `ADMINER_DEFAULT_SERVER: postgres` | Adminer's login form asks for a server. Inside the Compose network the hostname is the **service name**, `postgres` — not `localhost`, and **not port 5433**. Container-to-container traffic never touches the host port mapping. |
| `"8081:8080"` | 8080 on this machine is already serving a WordPress container (`aps-app-plugin-wordpress-1`). Two services cannot publish the same host port, and `docker compose up` would fail with a bind error. |
| `depends_on … service_healthy` | The existing `postgres` service declares a `healthcheck` (`pg_isready -U postgres`, `infra/docker-compose.yml:24-28`), so Adminer can wait for a database that actually accepts connections rather than one that has merely started. |

⚠️ **An Adminer container is reachable by anything that can reach the host.** It
has no second factor and the password is `postgres`. That is fine on a laptop and
unacceptable anywhere else — the same judgement you already make about leaving
`adminer.php` on a live server, which is to say: do not.

**Going deeper:** [02 §2.3 The Docker Compose file, line by line](../learn/02-infrastructure.md)
— what each existing block does, including the healthcheck Adminer would wait on.

---

## 7.5 How to use psql without installing anything ✅

**In WordPress:** `wp db cli` dropped you into a MySQL prompt, and you mostly
avoided it because phpMyAdmin was right there.

**Here:** the repo already wires it up. Nothing to install, because the client
ships inside the Postgres container.

**Steps**

1. From the repo root, open a session:

   ```bash
   npm run db:psql
   ```

   That is `docker exec -it apm-postgres psql -U postgres`, defined in the root
   [`package.json`](../../package.json).

2. You land in the `postgres` database — which has no tables. Switch:

   ```
   \c payload_crud
   ```

3. Use the ten commands below. Press `\q` when done.

**The ten worth memorising.** The right-hand column is what you would have
clicked or typed instead.

| psql | What it does | phpMyAdmin / MySQL equivalent |
|---|---|---|
| `\l` | list databases | the database list down the left sidebar · `SHOW DATABASES;` |
| `\c payload_crud` | switch database | clicking a database name · `USE payload_crud;` |
| `\dt` | list tables in the current database | the table list under a database · `SHOW TABLES;` |
| `\d posts` | describe one table — columns, types, indexes, foreign keys | the **Structure** tab · `DESCRIBE wp_posts;` |
| `\di posts*` | list indexes matching a pattern | Structure → Indexes panel · `SHOW INDEX FROM wp_posts;` |
| `select * from posts limit 5;` | read rows (**semicolon required**) | the **Browse** tab |
| `select count(*) from posts;` | count rows | the row-count column in the table list |
| `\x` | toggle expanded output — one column per line | phpMyAdmin's vertical row view |
| `\timing` | toggle query duration reporting | "Query took 0.0021 seconds" under the results |
| `\q` | quit | closing the tab |

Backslash commands take no semicolon; SQL always does. Forgetting the semicolon
gives you a `payload_crud-#` continuation prompt and the appearance of a hang —
type `;` and press enter.

**Verify** — a real session, start to finish:

```
\c payload_crud
You are now connected to database "payload_crud" as user "postgres".
select count(*) from posts;
 count 
-------
    11
(1 row)

\x
Expanded display is on.
select id, slug, _status from posts order by id limit 2;
-[ RECORD 1 ]-------------------------------------
id      | 1
slug    | what-are-payload-cms-collections
_status | published
-[ RECORD 2 ]-------------------------------------
id      | 3
slug    | what-is-seeding-and-when-should-you-use-it
_status | published

\x
Expanded display is off.
\timing
Timing is on.
select count(*) from _posts_v;
 count 
-------
    11
(1 row)

Time: 3.237 ms
\q
```

`\x` is the one that converts people. A `posts` row has eleven columns and wraps
into unreadable soup in a terminal; expanded output puts one field per line, which
is exactly phpMyAdmin's vertical view and is usually what you wanted.

**One-liners, without entering the shell.** This is how nearly every check in
these docs is written, because it pastes into a terminal and into a script
equally well:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | head -8
```

```
                     List of relations
 Schema |             Name              | Type  |  Owner   
--------+-------------------------------+-------+----------
 public | _posts_v                      | table | postgres
 public | _posts_v_version_tags         | table | postgres
 public | categories                    | table | postgres
 public | media                         | table | postgres
 public | pages                         | table | postgres
```

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\di posts*'
```

```
                         List of relations
 Schema |           Name           | Type  |  Owner   |   Table    
--------+--------------------------+-------+----------+------------
 public | posts__status_idx        | index | postgres | posts
 public | posts_category_idx       | index | postgres | posts
 public | posts_cover_image_idx    | index | postgres | posts
 public | posts_created_at_idx     | index | postgres | posts
 public | posts_pkey               | index | postgres | posts
 public | posts_slug_idx           | index | postgres | posts
 public | posts_tags_order_idx     | index | postgres | posts_tags
 public | posts_tags_parent_id_idx | index | postgres | posts_tags
 public | posts_tags_pkey          | index | postgres | posts_tags
 public | posts_updated_at_idx     | index | postgres | posts
(10 rows)
```

Ten indexes nobody wrote by hand — and only one of them was asked for. `slug`
carries `unique: true` and `index: true` in
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
(`:66-67`), which is where `posts_slug_idx` comes from. Payload added the other
nine itself: a primary key, one per relationship and upload field, one for
`_status`, two for the timestamps, and three for the `tags` sub-table. That is
the point [03 · Payload for ACF and CPT](../from-wordpress/03-payload-for-acf-and-cpt.md)
§3.3 makes about fields becoming columns and sub-tables.

Two flags worth knowing: `-t` strips the header and row count, `-A` removes the
column padding. Together they give you a bare value suitable for a shell
variable.

⚠️ **`npm run db:psql` needs a real terminal.** The script passes `-it` to
`docker exec`, so running it from a script, a CI job or anything without a TTY
fails immediately:

```bash
npm run --silent db:psql
```

```
the input device is not a TTY
```

That is not a broken container. Use the `-c 'query'` one-liner form instead,
which needs no TTY.

⚠️ **A local `psql` connects fine whatever its version; `pg_dump` is the one
that cares.** The client on this machine is newer than the server and neither
minds:

```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d payload_crud \
  -c "select current_database(), split_part(version(), ' on ', 1) as server;"
```

```
 current_database |      server      
------------------+------------------
 payload_crud     | PostgreSQL 17.11
(1 row)
```

The direction that bites is `pg_dump`: it refuses to dump a server newer than
itself. This machine has `pg_dump` 17.7 against a 17.11 server, which is exactly
why [`scripts/db-export.sh`](../../scripts/db-export.sh) runs `pg_dump` **inside**
the container. Its header comment walks through the error.

**Going deeper:** [02 §2.11 psql: the five commands worth memorising](../learn/02-infrastructure.md)
and [10 §10.6](../learn/10-databases.md).

---

## 7.6 Read freely; write through the APIs

This is the discipline that is genuinely different from WordPress, and it is
worth being precise about *how* different.

In WordPress, editing `wp_posts` directly is **risky**: you skip `save_post`, you
skip cache invalidation, you might leave orphaned `wp_postmeta` rows. But the
data model is forgiving, a later save through the admin usually puts the derived
state right again, and plenty of working developers have fixed a stuck post
status in phpMyAdmin at 2am and suffered nothing. You have probably done it. It
was a reasonable thing to do.

Here it is **architecturally wrong**, because the database is deliberately not
the system of record for behaviour. Three pieces of evidence, all of them
runnable right now.

**One — Medusa's foreign keys stop at the module boundary.** Inside a module the
database enforces the relationship. Across modules, and in this repo's own
`review` module, nothing does:

```bash
for t in product_variant review product_product_review_review; do
  printf 'medusa_crud  %-30s FKs: ' "$t"
  docker exec apm-postgres psql -U postgres -d medusa_crud -At -c \
    "select count(*) from information_schema.table_constraints
     where constraint_type='FOREIGN KEY' and table_schema='public' and table_name='$t';"
done
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d _posts_v' \
  | grep 'parent_id_posts_id_fk'
```

```
medusa_crud  product_variant                FKs: 1
medusa_crud  review                         FKs: 0
medusa_crud  product_product_review_review  FKs: 0
    "_posts_v_parent_id_posts_id_fk" FOREIGN KEY (parent_id) REFERENCES posts(id) ON DELETE SET NULL
```

`medusa_crud` has 95 foreign keys in total, and `product_variant → product` is
one of them — so this is not a database with the constraints turned off. It is a
database where every constraint lives inside one module.

`product_product_review_review` is the link table that associates a review with a
product. It has `product_id` and `review_id` and **no foreign key to either**,
because a link table spans two modules and a foreign key would couple them.
`DELETE FROM review WHERE id = '…'` in a GUI succeeds instantly and leaves a link
row pointing at a review that no longer exists. MySQL would not have saved you
either — `wp_postmeta` has no FK to `wp_posts` — but `wp_delete_post()` deletes a
post's meta for you, so going through the API was enough. Nothing here sweeps
orphaned link rows, and no API call will find them later.

**Two — the delete you would perform is not the delete the system performs.**
[`apps/commerce/src/workflows/delete-review.ts`](../../apps/commerce/src/workflows/delete-review.ts)
soft-deletes and says why in its own header:

```ts
// apps/commerce/src/workflows/delete-review.ts
/**
 * Soft-delete a review.
 *
 * The link row is intentionally left in place. A soft delete means "hide this,
 * reversibly", and dismissing the link would make the restore incomplete — the
 * review would come back detached from its product. Rolling back a soft delete
 * has to be symmetric, so the association survives.
 */
```

So the table and the API disagree *on purpose*, and the API is right:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud \
  -c 'select count(*) as rows, count(deleted_at) as soft_deleted from review;'
PK=$(grep '^MEDUSA_PUBLISHABLE_KEY=' apps/storefront/.env | cut -d= -f2)
curl -s "http://localhost:9000/store/reviews?limit=1" -H "x-publishable-api-key: $PK" \
  | python3 -c 'import json,sys; print("what /store/reviews shows:", json.load(sys.stdin)["count"])'
```

```
 rows | soft_deleted 
------+--------------
   45 |           30
(1 row)
what /store/reviews shows: 9
```

Forty-five rows, nine visible. The gap is soft deletes plus the status filter —
[03 §3.13](03-data.md#313-how-to-delete-a-review--and-why-the-row-is-still-there-afterwards)
walks one review through it, before and after.
A GUI shows you 45 and a hard `DELETE` from a GUI turns a reversible hide into an
irreversible hole, with no workflow run recorded and no compensation possible.
⚠️ **Your two numbers will be larger than these.** Every `npm run postman:test`
creates and soft-deletes more reviews, so the left column climbs and the right
one climbs with it. The gap is the lesson, not the figures.

**Three — Payload's hooks never fire for a direct write.** Insert a row into
`posts` by hand and the `beforeValidate` field hook in
[`apps/cms/src/hooks/slugify.ts`](../../apps/cms/src/hooks/slugify.ts) does not
run, so there is no slug; the `beforeChange` hook in
[`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts)
does not run, so `publishedAt` is never stamped; and no version row is written to
`_posts_v`. Delete a row by hand and the FK above is `ON DELETE SET NULL`, so the
version rows survive with `parent_id` set to null — rows that belong to nothing,
forever.

| Operation | In a GUI | Do this instead |
|---|---|---|
| `SELECT` anything | ✅ always safe | — |
| `\d`, `\dt`, `\l`, `\di` | ✅ always safe | — |
| `EXPLAIN` a slow query | ✅ safe | — |
| `UPDATE` a Payload row | 🚫 skips hooks, versions, access rules | [`PATCH /api/posts/:id`](03-data.md#311-how-to-update--payload-says-patch-medusa-says-post), or the admin at `:3000/admin` |
| `DELETE` a Payload row | 🚫 orphans `_posts_v` rows | [`DELETE /api/posts/:id`](03-data.md#312-how-to-delete-a-post--the-row-is-really-gone) |
| `UPDATE` a Medusa row | 🚫 skips the workflow, so no compensation and no event | `POST /admin/reviews/:id` |
| `DELETE` a Medusa row | 🚫 turns a reversible soft delete into a dangling link | `DELETE /admin/reviews/:id` |
| `ALTER TABLE` by hand | 🚫 Payload's `push` will try to drop your column; Medusa's migrations will not know about it | edit the collection or the model, then regenerate |

⚠️ **The practical rule: treat every GUI as read-only, and reach for the admin UI
or `curl` the moment you want to change something.** The one exception this repo
allows is cleaning up test residue a lab left behind — rows nothing in the
application depends on. If you find yourself about to fix production data in
pgAdmin, the honest version of that instinct is: the API is missing an endpoint,
write the endpoint.

**Going deeper:** [10 §10.7 Things you can safely do, and things you cannot](../learn/10-databases.md)
and [05 · Medusa for WooCommerce](../from-wordpress/05-medusa-for-woocommerce.md)
on why mutations go through workflows.

---

## 7.7 The rest of the toolkit, and what each one replaces

Everything below is already in this repo or already on this machine.

| Tool | Replaces | Where | Status |
|---|---|---|---|
| Payload admin | wp-admin, Posts/Pages screens | http://localhost:3000/admin | ✅ |
| Medusa admin | WooCommerce → Products | http://localhost:9000/app | ✅ reachable; its Orders and Customers screens are empty here (0 rows each) |
| `/schema` page | phpMyAdmin's Structure tab, for both databases at once | [`schema.astro`](../../apps/storefront/src/pages/schema.astro) | ✅ |
| `/monitor` page | Query Monitor, Site Health, a logs plugin | [`monitor.astro`](../../apps/storefront/src/pages/monitor.astro) | ✅ |
| Postman collection | — (you tested by clicking the site) | [`postman/`](../../postman/) | ✅ 49 requests; 28 assertions fail today for the reason in §7.8 |
| `docs/requests.http` | — | [`requests.http`](../requests.http) | ✅ needs an extension |
| `npm run logs` | `WP_DEBUG_LOG` + tailing `debug.log` | root [`package.json`](../../package.json) | ✅ |

**The two admin UIs.** Payload's is at http://localhost:3000/admin, sign in with
`admin@local.test` / `supersecret`. Medusa's is at http://localhost:9000/app,
same email. They are separate applications with separate user tables — there is
no single sign-on, and no equivalent of one wp-admin that covers both content and
commerce. That is the clearest day-to-day cost of splitting the stack, and it is
worth naming: WordPress gave you one login and one menu.

```bash
for u in http://localhost:3000/admin http://localhost:9000/app; do
  printf '%-32s -> ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "$u"
done
```

```
http://localhost:3000/admin      -> 200
http://localhost:9000/app        -> 200
```

**This repo's own two pages.** `/schema` composes both backends' schema endpoints
into one view — 21 Payload tables and 146 Medusa tables side by side, which is
the question "what tables exist?" answered without opening a GUI at all.
`/monitor` is 843 lines of uptime history, workflow executions, request log,
application logs and backup inventory. You would normally reach for two or three
plugins to cover that spread in WordPress — Query Monitor is the closest single
analogue, and Site Health covers part of the rest.

**Postman.** [`postman/README.md`](../../postman/README.md) documents 49 requests
across five folders — `00 Auth`, `01 Payload CMS`, `02 Medusa Store`,
`03 Medusa Admin`, `04 Astro BFF` — with automatic variable chaining, so folder
03 reuses the JWT that folder 00 produced. Import the collection *and* the
environment, then run the whole thing headlessly:

```bash
npm run postman:env     # regenerate the environment from apps/*/.env first
npm run postman:test    # newman, 49 requests
```

```
│                         │         executed │           failed │
│              iterations │                1 │                0 │
│                requests │               49 │                0 │
│              assertions │              103 │               28 │
```

⚠️ **The README says to expect `49 requests · 104 assertions · 0 failed`, and
that is not what happens here.** All 49 requests fire, but 28 assertions fail and
every one of them is in `04 Astro BFF` — they fail for the reason §7.8 chases
down: the collection points at `:4321`, which on this machine belongs to a
different project. Fix the port and that folder goes green. Run it once now, so
the baseline you remember is the one your machine actually produces rather than
the one the README promises.

⚠️ **`npm run db:reset` invalidates both API keys**, and every saved Postman
request starts failing with 401 or 400. `npm run postman:env` rewrites the
environment from the apps' `.env` files; the script
[`scripts/gen-postman-env.sh`](../../scripts/gen-postman-env.sh) exists entirely
because this is the most confusing failure mode in the repo.

**`docs/requests.http`.** 476 lines of runnable requests covering every CRUD path,
with the equivalent `curl` under each. To get the "Send Request" links you need
the REST Client extension — `humao.rest-client`, 0.25.1 on the marketplace
today. 📋 It is not installed on this machine; `ls ~/.vscode-server/extensions`
does not list it. Read the file's header before using it — it documents two
things that will trip you up from `curl`: square brackets in Payload's
`where[...]` queries need `-g`, and Astro rejects a `DELETE` to `/api/**` without
a matching `Origin` header.

**Logs.** `npm run logs` tails all three; `npm run logs:errors` greps them. The
second one is the useful one:

```bash
npm run --silent logs:errors | tail -3
```

```
warn:    [uptime] 1/3 DOWN: storefront (HTTP 404)
warn:    [uptime] 1/3 DOWN: storefront (HTTP 404)
warn:    [uptime] 1/3 DOWN: storefront (HTTP 404)
```

That is a real warning, not a demo — §7.8 chases it down.

⚠️ **Patterns that span a colour change silently fail.** The dev servers write
ANSI escape codes into these files, and they land *inside* what looks like one
word: Medusa writes `warn` and `:` with an escape sequence between them, so
`grep 'warn'` matches every warning line in `logs/commerce.log` and
`grep 'warn:'` matches none of them. Strip the colours first, then grep:

```bash
grep -c 'warn:' logs/commerce.log            # 0 — the colon is behind an escape
sed 's/\x1b\[[0-9;]*m//g' logs/commerce.log | grep -c 'warn:'
```

```
0
28
```

The second number climbs by one a minute, because `jobs/uptime-check.ts` writes a
warning every minute. The number that matters is the first one: **zero**, from a
pattern that is plainly in the file.

**VS Code extensions.** Of these, only the first is installed here:

| Extension | ID | Why |
|---|---|---|
| Astro | `astro-build.astro-vscode` | Syntax, IntelliSense and TypeScript inside `.astro` frontmatter. ✅ installed, 2.16.20 |
| REST Client | `humao.rest-client` | Makes `docs/requests.http` clickable. 📋 not installed |
| PostgreSQL | `ms-ossdata.vscode-pgsql` | Microsoft's client; a tables tree and a query editor without leaving the editor. 📋 |
| SQLTools + driver | `mtxr.sqltools`, `mtxr.sqltools-driver-pg` | The lighter alternative; the driver is a separate install. 📋 |

Your existing PHP extensions — Intelephense, PHPCS — do nothing here and nothing
in this repo conflicts with them. Leave them installed.

**Going deeper:** [12 · Operating it](../learn/12-operating-it.md) for what
`/monitor` is actually measuring, and [02 §2.9 Reading the logs](../learn/02-infrastructure.md)
for the two log formats.

---

## 7.8 Worked example: the tools catching a port collision

This is not a contrived exercise. It is what the warning in §7.7 turned out to
be, found while writing this page, and it exercises four tools in sequence.

**Start with the symptom.** The uptime job says the storefront is down. The
storefront is plainly not down — it renders in a browser. So either the job is
wrong or it is looking at the wrong thing.

**Ask who owns the port:**

```bash
ss -ltnp | grep -E ':(4321|4322) ' | awk '{print $4, $6}'
ps -o args= -p "$(ss -ltnp | grep ':4321 ' | grep -oP 'pid=\K[0-9]+' | head -1)" | cut -c1-72
```

```
127.0.0.1:4321 users:(("node",pid=10239,fd=22))
127.0.0.1:4322 users:(("node",pid=116040,fd=22))
node /home/infoa/Projects/Freelance/hr-astro-payload/node_modules/.bin/a
```

The PIDs are yours, not mine — the second command reads the one holding 4321
rather than repeating a number that goes stale on the next restart.

There it is. **A different project's Astro dev server was holding 4321** — in
this capture, `hr-astro-payload` — so this repo's storefront quietly took 4322
instead. Astro picks the next free port rather than failing. Two Astro apps, one
laptop, one default port.
[04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321) is
the short recipe for asking Astro where it landed.

⚠️ **This is a captured case study, not the current state.** The collision was
resolved afterwards by stopping both servers and restarting this one, so 4321 is
this repo's storefront again. The commands above are the generic diagnosis and
work whenever it recurs — which, with two Astro projects on one machine, it
will.

**Confirm what the monitor is polling:**

```bash
grep '^STOREFRONT_URL=' apps/commerce/.env
curl -s -o /dev/null -w 'uptime job polls :4321 -> HTTP %{http_code}\n' http://localhost:4321/api/health
```

```
STOREFRONT_URL=http://localhost:4321
uptime job polls :4321 -> HTTP 404
```

The job is polling 4321, reaching the *other* project, and getting a 404 because
that project has no `/api/health`. Not down — **misaddressed**, which is worse,
because a misaddressed check is a check that can never go green and can never be
trusted again.

**Confirm the real storefront is healthy on whichever port it took** — `$SF`,
set from `astro dev status`, so this works whether it landed on 4321 or 4322:

```bash
curl -s "$SF/api/health" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["ok"], d["services"]["payload"]["detail"])'
```

```
True 103 posts (3 draft), authenticated as admin@local.test
```

Healthy, and reachable — it was only ever the *monitor* that was looking in the
wrong place.

**The fix is one of two.** Either stop the other project and restart this one so
it reclaims 4321, or point `STOREFRONT_URL` in `apps/commerce/.env` at whichever
port this storefront actually landed on and restart Medusa. The first is better,
and is what was done here: every doc in this repo, the Postman environment and
`docs/requests.http` all hardcode 4321.

⚠️ **Stopping the other project means stopping it.** `npx astro dev stop` inside
*its* directory is the clean way. Killing the process group by port works too,
but you are killing somebody else's dev server — know which project it is before
you do, which is exactly what the `ps -o args=` command above tells you.

⚠️ **This is the one WordPress habit that transfers perfectly.** You have
debugged "the site is down" and found it was a `WP_HOME` pointing at the wrong
host. Same shape, same lesson: check what the checker is checking before you
trust what it says.

⚠️ **Do not reach for `pkill -f astro`.** The pattern can match your own shell's
command line and kill your session. Target the port's PID, as
[02 §2.6](../learn/02-infrastructure.md) sets out:

```bash
kill $(ss -ltnp | grep ':4321 ' | grep -oP 'pid=\K[0-9]+' | head -1)
```

**Going deeper:** [12 §12.2 Uptime: measuring from outside](../learn/12-operating-it.md)
and [12 §12.8 Where every signal here is blind](../learn/12-operating-it.md).

---

## Check yourself

1. The port is 5433 on the host and 5432 inside the container. Which of those
   does pgAdmin use, and which does a `docker exec` command use? Why are they
   different?
2. You want to list every post whose category is "Architecture" alongside every
   review of a product. Write the SQL — then explain why you cannot.
3. In WordPress you fixed a stuck post status in phpMyAdmin and nothing bad
   happened. Name two things that would go wrong if you did the equivalent to a
   row in `posts` here, and one that would go wrong in `review`.
4. `review` has 45 rows and `/store/reviews` reports 9. Account for the
   difference without looking it up.
5. `product_variant` has a foreign key to `product`, and
   `product_product_review_review` has none to anything. Is the second one a bug?
   Give the argument for it and the cost it accepts.
6. `npm run db:psql` prints `the input device is not a TTY` when you run it from
   a script. What is the flag causing it, and what do you use instead?
7. The uptime job reported the storefront DOWN while the storefront was serving
   pages. Which tool told you the truth first, and what would you change so the
   check cannot be wrong in the same way again?
8. You install Adminer as a Compose service and the login form asks for a server.
   Why is the answer not `localhost:5433`?

---

**Next:** [README.md](README.md) — back to the question index, which is the
fastest way to any of the twenty-one answers once you stop reading in order.

From here the course takes over:
[12 · Operating it](../learn/12-operating-it.md) covers what `/monitor` measures,
what it cannot see, and why "no failures recorded" never means "no failures".
