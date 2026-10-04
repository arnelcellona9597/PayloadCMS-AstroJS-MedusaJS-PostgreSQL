# 10 · The databases

> Explore this chapter live at **http://localhost:4321/schema** — both schemas,
> read from the running databases. Reference: [02-infrastructure.md](02-infrastructure.md)
> §2.11 for the `psql` basics this chapter assumes.

You have been treating both databases as somewhere data goes. This chapter opens
them, because **the schema is the clearest statement of what each framework
actually believes** — and both will surprise you.

Two headline facts to sit with:

- You declared **5 Payload collections and 1 global**. They became **21 tables**.
- Medusa has **145 tables**, of which you wrote exactly **one**.

Every one of those extra tables has a cause. Learning to read them is the skill.

---

## 10.1 Where they live, and why there are two

```bash
docker exec apm-postgres psql -U postgres -c '\l' | grep _crud
```

```
 medusa_crud  | postgres | UTF8
 payload_crud | postgres | UTF8
```

One Postgres **server** (the container on :5433), two **databases**. Not two
schemas, not two table prefixes — two databases, so that:

- each backend owns its own migration history and cannot corrupt the other's
- Payload's `push` can never touch a Medusa table
- **you cannot write a `JOIN` across them**, which forces integration up into the
  Astro layer where you can read it

That last constraint is load-bearing. Every time this repo needs data from both
sides, it does it over HTTP — including the `/schema` page itself, which asks
each backend to describe its own database rather than opening a connection.

---

## 10.2 Payload: six declarations, twenty-one tables

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt'
```

Grouped by what produced each one:

| Group | Count | Tables |
|---|---|---|
| **Your collections** | 5 | `users`, `media`, `categories`, `posts`, `pages` |
| **Block tables** | 4 | `pages_blocks_hero`, `pages_blocks_prose`, `pages_blocks_stats`, `pages_blocks_stats_items` |
| **Array sub-tables** | 2 | `posts_tags`, `site_settings_social_links` |
| **Drafts & versions** | 2 | `_posts_v`, `_posts_v_version_tags` |
| **Global** | 1 | `site_settings` |
| **Auth** | 1 | `users_sessions` |
| **Payload's bookkeeping** | 6 | `payload_kv`, `payload_locked_documents`(+`_rels`), `payload_preferences`(+`_rels`), `payload_migrations` |

### An `array` field becomes its own table

```ts
{ name: 'tags', type: 'array', fields: [{ name: 'tag', type: 'text' }] }
```

That one field created **`posts_tags`** — with a parent foreign key and an
`_order` column, because arrays are ordered. Each tag is a *row*, not a JSON blob.

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts_tags'
```

The consequence: filtering or counting tags is a normal SQL join, not JSON
surgery. That is the upside of the design. The downside is table count.

### Drafts double everything

`versions: { drafts: true }` on Posts created **`_posts_v`** — and, because the
array had to be versioned too, **`_posts_v_version_tags`**.

Note the naming: the versions table prefixes columns with `version_`. That is why
Lab 1's cleanup needs two `ALTER TABLE`s and why a leftover
`version_reading_time` can block startup ([07](07-troubleshooting.md) §7.2).

**Drafts roughly double the tables for that collection.** Worth knowing before
enabling them on everything.

### `media` has 25 columns from one option

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d media' | head -30
```

Two `imageSizes` (`thumbnail`, `card`) each added six columns — url, width,
height, mimeType, filesize, filename. Add a third size and you add six more.

Files are **not** in the database. Only metadata is; the bytes sit in
`public/media`, which is exactly why [§9.7](09-to-production.md) says move to
object storage before you scale or containerise.

### Blocks explode the table count

`Pages` has ONE field — `layout`, of type `blocks`, offering three block types.
That created **four** tables:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep pages
```

```
pages                      the page itself
pages_blocks_hero          one row per hero section used
pages_blocks_prose         one row per text section
pages_blocks_stats         one row per stat row
pages_blocks_stats_items   one row per stat INSIDE a stat row  ← nested array
```

**One table per block type, plus one more for the array nested inside a block.**
Add a fourth block type and you add a fifth table.

Now notice what `Pages` does *not* have: drafts. That is deliberate. Posts has
`versions: { drafts: true }` and paid for it with `_posts_v` and
`_posts_v_version_tags`. Turn drafts on for Pages and every one of those four
block tables gets a `_pages_v_...` twin — **nine tables for one collection**.

That is the real cost of the blocks field, and it is worth it when editors need
layout control. It is not worth it for a collection with three fixed fields.

### A global is one row, and still gets tables

`SiteSettings` is a global — exactly one record — and it produced two tables:

```
site_settings               the single row
site_settings_social_links  its array field
```

Confirm there really is only ever one row:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c 'select count(*) from site_settings;'
```

Arrays behave identically whether they are in a collection or a global — the
`array` field type is what creates a table, not the thing containing it.

### Payload's own six tables

| Table | What it is for |
|---|---|
| `payload_migrations` | migration history — holds one `dev` sentinel row under `push`; see below |
| `payload_preferences`(`_rels`) | per-user admin UI state: column widths, last-used filters |
| `payload_locked_documents`(`_rels`) | document locking, so two editors don't silently overwrite each other |
| `payload_kv` | internal key/value store (jobs, scheduling) |

`payload_migrations` is the interesting one. Look inside:

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c 'select * from payload_migrations;'
```

```
 id | name | batch |         created_at
----+------+-------+---------------------------
  1 | dev  |    -1 | 2026-08-30 13:12:12.53+00
```

Exactly one row, named `dev`, with **`batch = -1`**. That is not a migration — it
is a sentinel meaning *"this schema was produced by `push`, not by a migration
history."* The negative batch keeps it from ever colliding with real migrations
numbered from 1.

So the table is not unused; it is recording the *absence* of a history. Switch to
`push: false` and your first real migration lands as batch 1 alongside it — which
is the mechanic behind the warning in [09](09-to-production.md) §9.2 about
baselining a database that `push` built.

---

## 10.3 Medusa: 145 tables, partitioned by module

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c \
  "select split_part(table_name,'_',1), count(*) from information_schema.tables
   where table_schema='public' group by 1 order by 2 desc limit 8;"
```

```
order        24
product      19
cart         10
promotion     8
fulfillment   6
price         6
auth          5
customer      5
```

**`order` alone is 24 tables.** Not because Medusa is bloated, but because an
order is genuinely that complicated: line items, adjustments, tax lines, changes,
claims, exchanges, returns, each with their own history.

This is what module isolation looks like on disk. Nothing enforces the naming —
Medusa does not record module ownership in the database — but the partition is
real, because each module owns its own migrations.

### 135 of 145 tables soft-delete

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c \
  "select count(*) from information_schema.tables t where table_schema='public'
   and exists (select 1 from information_schema.columns c
               where c.table_name=t.table_name and c.column_name='deleted_at');"
```

`deleted_at` is not an occasional choice in Medusa — it is the default posture.
Commerce data is evidence: an order someone disputes a year later must still be
reconstructible.

This is also what makes workflow compensation cheap ([04](04-medusa.md) §4.6):
undoing a delete is one `restoreReviews` call.

⚠️ **It changes how you read the data.** Every ad-hoc query you write needs
`where deleted_at is null`, or you will count rows the application considers gone.
The generated service methods do this for you; raw SQL does not.

### Link tables — 21 declared, and yours is one

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c \
  'select * from product_product_review_review limit 3;'
```

A link table has a distinctive **shape** — an id, timestamps, and exactly two
`*_id` columns — and Medusa uses them everywhere:

```
product_sales_channel              product_id ↔ sales_channel_id
publishable_api_key_sales_channel  publishable_key_id ↔ sales_channel_id
order_cart                         order_id ↔ cart_id
product_variant_price_set          variant_id ↔ price_set_id
product_product_review_review      product_id ↔ review_id      ← yours
```

**That last line is the point of the whole chapter.** The table your `defineLink`
created is indistinguishable from the ones Medusa ships. You did not use a
special extension mechanism; you used the ordinary one.

⚠️ **Shape alone is not proof, and you do not have to guess.** Shape-matching
finds **30** candidates, but only **21** are real cross-module links —
`product_sales_channel` joins two *modules*, while `product_tags` joins two
entities *inside* the product module. Identical shape, different meaning.

Medusa records the real ones itself:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c \
  'select table_name, link_descriptor from link_module_migrations order by table_name;'
```

21 rows, each carrying which module sits on each side:

```
product_product_review_review | {"fromModule": "product", "fromModel": "product",
                                 "toModule": "review",  "toModel":  "review"}
```

That is the authoritative list — the same thing `npm run db:migrate` prints under
"Created following links tables", queryable at any time. **Trust this over any
naming convention**, including the one this repo's `/schema` page uses as a
teaching foil.

---

## 10.4 Two ID strategies, and why

```bash
docker exec apm-postgres psql -U postgres -d payload_crud -c '\d posts' | grep -w id
docker exec apm-postgres psql -U postgres -d medusa_crud  -c '\d review' | grep -w id
```

| | Payload | Medusa |
|---|---|---|
| Type | `integer` | `text` |
| Source | `nextval('posts_id_seq')` — the database | the application |
| Looks like | `4` | `01M0JDBDQYJ9K65N7XJRHWY9TD` |
| Format | serial | ULID, with a `prod_` / `rev_` style prefix on built-ins |

**Payload uses serial integers.** Short, sortable, human-quotable — you can say
"post 4" out loud. The cost: the database must issue them, so you cannot know an
id before insert, and ids leak volume ("we have 47 customers").

**Medusa uses application-generated ULIDs.** The cost is verbosity; the benefits
are what commerce needs:

- **The application knows the id before the insert.** A workflow can create a
  review, reference its id in the next step, and roll both back — without a
  round trip to fetch what the database decided.
- **They are unique across databases.** Modules that may one day live in separate
  databases cannot rely on a shared sequence.
- **They sort by creation time**, unlike UUID v4, so `order by id` is meaningful.
- **They leak nothing** about how many rows you have.

Neither is right in general. Notice that the id strategy follows from the same
commitments as everything else: Payload optimises for a legible admin experience,
Medusa for distributed, reversible operations.

---

## 10.5 The two schema strategies, in the data

| | Payload (dev) | Medusa (always) |
|---|---|---|
| How schema changes | `push` diffs the config against the DB | you generate a migration file |
| Artefact in git | **none** | one file per change, with `up()` and `down()` |
| Applied by | starting the dev server | `npm run db:migrate` |
| Rollback | none | `npx medusa db:rollback <module>` |
| History table | `payload_migrations` — one `dev` sentinel row | **three** tables, see below |

See both:

```bash
cat apps/commerce/src/modules/review/migrations/*.ts
docker exec apm-postgres psql -U postgres -d payload_crud -c 'select * from payload_migrations;'
```

The Medusa file is plain SQL you can read and revert. Payload's table holds a
single `dev` marker — `push` left no trace of *how* the schema got that way. That
is the whole trade-off in two commands.

### Medusa keeps three histories, not one

```bash
for t in mikro_orm_migrations link_module_migrations script_migrations; do
  echo -n "$t: "
  docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c "select count(*) from $t;"
done
```

```
mikro_orm_migrations:   178   module schema changes (incl. your review migration)
link_module_migrations:  21   link tables
script_migrations:        5   one-off data-migration scripts
```

**This is why `db:generate` and `db:migrate` are separate commands.**
`db:generate` writes a module migration (history 1). `db:migrate` applies it
*and* syncs links (history 2) *and* runs pending data scripts (history 3). Adding
a link file touches only the second — which is exactly why a new link needs
`db:migrate` but not `db:generate` ([04](04-medusa.md) §4.4).

---

## 10.6 Reading a schema you didn't design

A transferable skill, and 145 tables is good practice.

**Start from the thing you understand.** You know what a review is:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d review'
```

**Find what references it.** Search for tables with a matching `*_id`:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -c \
  "select table_name from information_schema.columns
   where column_name = 'review_id' and table_schema = 'public';"
```

**Look at real rows before theorising.** A schema tells you what is *possible*;
the data tells you what actually happens.

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c \
  'select status, count(*) from review group by status;'
```

**Check the size distribution** — it tells you what the system is really for:

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -t -A -F' | ' -c \
  "select relname, pg_size_pretty(pg_total_relation_size(relid))
   from pg_catalog.pg_statio_user_tables order by pg_total_relation_size(relid) desc limit 8;"
```

**Four questions that decode most tables:**

1. Is it named `<a>_<b>` with two `*_id` columns? → a join or link table
2. Does it have `deleted_at`? → soft deletes; your queries need a filter
3. Does it have `_order` or `_parent_id`? → an array/blocks sub-table
4. Does it start with the framework's name? → internal bookkeeping, leave alone

---

## 10.7 Things you can safely do, and things you cannot

**Safe:**
- `SELECT` anything, for debugging
- `\d`, `\dt`, `\l` — introspection
- Reading migration files

**Not safe:**
- **`INSERT`/`UPDATE`/`DELETE` on Medusa tables directly.** You bypass workflows,
  so no compensation, no events, no link maintenance. The whole point of
  [04](04-medusa.md) is that mutations go through workflows.
- **Writing to Payload tables directly.** You bypass hooks, so no slug is
  generated, no `afterChange` fires, and drafts fall out of sync with `_posts_v`.
- **Adding columns by hand.** Payload's `push` will try to drop them; Medusa's
  migrations will not know about them.

The one exception this repo makes is cleanup of *test residue* — dropping a
column `push` orphaned, or deleting soft-deleted rows a lab left behind. Those
touch nothing the application relies on.

---

## 10.8 Try it

1. **Open http://localhost:4321/schema** and find `product_product_review_review`
   highlighted among Medusa's own link tables.
2. **Add a second `imageSize`** to `Media`, restart, and count `media`'s columns
   before and after. Predict the number first.
3. **Turn drafts off** on Posts (`versions: { drafts: false }`) and see what
   happens to `_posts_v`. Then turn it back on. *(Read [07](07-troubleshooting.md)
   §7.2 first — `push` will ask about dropping tables.)*
4. **Find the biggest table in `medusa_crud`** and work out why it is biggest.
   (It is `price_rule` — before you look, guess why a store with four products
   needs the most space there.)
5. **Count soft-deleted rows** after running Lab 6:
   ```bash
   docker exec apm-postgres psql -U postgres -d medusa_crud -c \
     'select count(*) from review where deleted_at is not null;'
   ```

---

## 10.9 Check yourself

1. You declared 5 collections and 1 global and got 21 tables. Name five causes.
2. Why does `posts_tags` exist instead of a JSON column on `posts`?
2b. `Pages` has one field and made four tables. How many would it make with
   drafts enabled, and why?
3. `payload_migrations` holds one row named `dev` with `batch = -1`. What is it
   recording, and why a negative batch?
4. How do you recognise a link table, and why is shape not proof?
5. Payload uses serial ints, Medusa ULIDs. Give one concrete thing each buys.
6. Why must every hand-written query against Medusa consider `deleted_at`?
7. Why does `/schema` ask the backends instead of connecting to Postgres itself?

---

**Next:** [11-capstone.md](11-capstone.md) — build a feature across all three
services, with no worked solution.
