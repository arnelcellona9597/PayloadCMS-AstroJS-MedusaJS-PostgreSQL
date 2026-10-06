# Coming from WordPress — start here

A translation layer between the stack you already know and the one in this repo.
Every concept is introduced by naming its WordPress counterpart first — or by
saying plainly that there isn't one.

**Who this is for:** a working WordPress developer who is fluent in PHP, the
loop, post types, template hierarchy, hooks and ACF, and who has shipped real
sites with them. It assumes you have never written TypeScript and have never used
Astro, Payload or Medusa — so nothing in this track asks you to already know a
word from the new stack, only words from the old one.

**Want the steps rather than the concepts?** This track explains *why* each
WordPress idea became what it did; [`../how-to/`](../how-to/README.md) gives you
the numbered steps for doing one specific task.

---

## How this track relates to [`../learn/`](../learn/README.md)

Two tracks, same repo, different entry points.

| | [`../learn/`](../learn/README.md) | `from-wordpress/` (you are here) |
|---|---|---|
| Teaches | the stack from zero, in its own terms | the stack mapped onto what you already know |
| Assumes | no prior stack knowledge, no particular background | deep WordPress knowledge, no stack knowledge |
| Shape | 13 chapters, build-up order | 8 chapters, comparison order |
| Typical sentence | "A collection is a schema definition." | "A collection is `register_post_type` and the ACF field group in one file." |

**Read either one first.** They are not prerequisites for each other. If you want
the fastest orientation, start here — the WordPress framing does a lot of work
and chapter 1 will reshape your mental model in an evening. If you would rather
learn the thing cleanly without analogies getting in the way, start with
[`../learn/`](../learn/README.md).

This track **links into the other rather than repeating it**. When a topic is
already taught properly over there — Lexical internals, the six Medusa migration
steps, the full schema walk — these chapters give you the WordPress framing and
the "aha", then point you at the chapter that goes deep. Expect roughly one such
link per major section. Follow them when you want the mechanism; skip them when
you want the map.

---

## The chapters

| # | Chapter | What it gives you | Time |
|---|---|---|---|
| 1 | [01 · The shift — from one program to three](01-the-shift.md) | The mental model, and the only one that matters: one program became three that share nothing but HTTP. Where `functions.php`, `wp-admin` and the database each went. | 1–2 h |
| 2 | [02 · The concept map — every term, mapped](02-concept-map.md) | Every term mapped, in tables — content, templating, data, commerce, auth, extensibility, ops. Plus eight things with **no** WordPress equivalent and seven things WordPress has that this does not. | 1–2 h, then reference |
| 3 | [03 · Payload — if you know ACF and custom post types](03-payload-for-acf-and-cpt.md) | The friendliest chapter. ACF field types → Payload fields, flexible content → blocks, options pages → globals, and why fields become real SQL columns instead of `postmeta` rows. | 3–4 h |
| 4 | [04 · Astro — if you have built WordPress themes](04-astro-for-theme-developers.md) | Your theme skills, mostly intact: layouts, partials, the template hierarchy as a directory. And the one part that does not transfer — there is no `WP_Query`. | 2–3 h |
| 5 | [05 · Medusa — if you have built WooCommerce stores](05-medusa-for-woocommerce.md) | The hardest. Products, variants, regions, pricing, inventory — and an honest inventory of how much of WooCommerce this repo simply does not have. Module isolation, links, workflows, compensation. | 3–4 h |
| 6 | [06 · The three together — who owns what](06-the-worked-example.md) | All three together: who owns which piece of data, two traced requests end to end, and two thought experiments about putting the data in the wrong service. | 2–3 h |
| 7 | [07 · The plugins you will miss — and what replaces them](07-cross-cutting.md) | Your plugin shopping list as a gap analysis. UpdraftPlus, Wordfence, WP-Cron, Gravity Forms, WPML, Yoast, WP Super Cache — what replaces each, and which ones nobody has written. | 2–3 h |
| 8 | [08 · Cheat sheet — WordPress to this stack](08-cheat-sheet.md) | Every mapping in the track as lookup tables, with links back to the chapter that explains it. | reference |

Budget **15–20 hours** for a first pass, and expect to come back to chapters 2
and 8 constantly afterwards. Chapters 3 to 5 are the long ones; chapter 5 is the
one to slow down on, because Medusa's design is the least like anything in your
current toolkit.

---

## The three honesty labels

These appear in every chapter, usually in a table cell or next to a heading. The
repo's whole ethos is that you never have to guess whether an example is real, so
every claim carries one.

| Mark | Meaning |
|---|---|
| ✅ | Running in this repo now. Every command shown was executed, and the output pasted below it is the real output. |
| 📋 | The framework supports it; this repo does not configure it. Read it as a concept. **There is no command.** |
| 🚫 | Does not exist here at all. Conceptual explanation, or a sketch of what you would have to build. |

The 📋 rows are the ones that will bite you. They are the places where you reach
for something WordPress gave you free, find the capability genuinely exists, and
then discover nobody has wired it up — Payload localization for your WPML
instinct, Medusa's pricing module for your product page. Knowing the difference
between "this stack can't" and "this repo didn't" is most of the value of the
labels.

---

## The five things that will surprise you most

Ranked by how hard they hit a WordPress developer, not by how important they are
to the architecture.

**1. Astro has no database access at all.** There is no `WP_Query`, no `$wpdb`,
no `get_posts()` — not because they renamed it, but because the storefront
process holds no database connection. Every byte on `localhost:4321` arrived over
HTTP from another program. Deleting a post is an HTTP call, and when that call
fails you get an error object, not a `WP_Error` you can ignore.
See [04 §4.6](04-astro-for-theme-developers.md) and
[05 · Astro](../learn/05-astro.md).

**2. Access control returns a query, not a boolean.** `current_user_can()` hands
you true or false and leaves the filtering to you. Payload's `read` access
function may return a **`Where` clause** that gets merged into the SQL, so an
anonymous caller does not get a 403 — they get a smaller result set, and the
unpublished rows never leave the database. One function in this repo does it
([`apps/cms/src/collections/Posts.ts`](../../apps/cms/src/collections/Posts.ts),
lines 41–49) and it is the single best teaching moment Payload has.
See [03 §3.9](03-payload-for-acf-and-cpt.md).

**3. Module isolation forbids the JOIN you would just write.** In WooCommerce a
review and a product are both rows in `wp_posts` and you join them without
thinking. In Medusa two modules may not reference each other's tables, so
attaching a review to a product needs a **link** — a third table owned by
neither, holding two ids — and a query planner that fetches from both and
stitches the result in application code. The service method that computes rating
stats takes *review ids*, not a product id, specifically to keep that boundary
intact. See [05 §5.8](05-medusa-for-woocommerce.md) and
[04 · Medusa](../learn/04-medusa.md).

**4. There is no plugin ecosystem, and no global hook system.** No registry, no
one-click install, no activate/deactivate, no `$wp_filter`. Payload's `plugins`
array in this repo is literally `plugins: []`. Hooks exist but are **declared
inside the file they belong to**, so nothing external can attach to them, and
there is no general `apply_filters` — no way for arbitrary code to intercept and
rewrite an arbitrary value in flight. This is a genuine loss, not a trade-up, and
[02 §2.7](02-concept-map.md) says so in those words.

**5. `wp-admin` became two admin panels, permanently.** Payload's at `:3000/admin`
for content, Medusa's at `:9000/app` for commerce, with separate logins and no
shared navigation. Nobody is going to merge them. The curious part is which one
is extended: Payload has **no** custom admin UI in this repo, while Medusa has a
real React widget bolted onto the product detail screen. See
[01 §1.4](01-the-shift.md).

---

## Before anything else: get it running

Do not read this track against a dead environment. The chapters are full of
commands whose real output is pasted underneath, and checking them yourself is
most of the learning.

```bash
npm install && npm run setup
npm run dev
```

Then confirm all three processes are up and talking to each other:

```bash
curl -s http://localhost:4321/api/health | python3 -m json.tool
```

```
{
    "ok": true,
    "services": {
        "payload": {
            "ok": true,
            "detail": "103 posts (3 draft), authenticated as admin@local.test",
            "url": "http://localhost:3000"
        },
        "medusa": {
            "ok": true,
            "detail": "33 approved reviews, products reachable",
            "url": "http://localhost:9000"
        }
    },
    "checkedAt": "2026-10-01T15:13:57.389Z"
}
```

Your counts will differ — the seed is a starting point and the labs move it. What
matters is `"ok": true` in all three places.

Both admin panels, and the storefront, should answer:

```bash
curl -s -o /dev/null -w 'payload :3000/admin  HTTP %{http_code}\n' -L http://localhost:3000/admin
curl -s -o /dev/null -w 'medusa  :9000/app    HTTP %{http_code}\n' -L http://localhost:9000/app
curl -s -o /dev/null -w 'astro   :4321/        HTTP %{http_code}\n' -L http://localhost:4321/
```

```
payload :3000/admin  HTTP 200
medusa  :9000/app    HTTP 200
astro   :4321/        HTTP 200
```

Log in to Payload as `admin@local.test` / `supersecret`.

If any of that fails, go to [07 · Troubleshooting](../learn/07-troubleshooting.md)
first — and if the containers themselves are the problem,
[02 · Infrastructure](../learn/02-infrastructure.md) covers Docker, ports and
recovery. `npm run db:reset` puts everything back; the repo is disposable on
purpose.

---

## How to read this track

**Keep a WordPress site open in another tab.** Not for nostalgia — for checking.
Several comparisons here only land once you have looked at the actual `postmeta`
row or the actual ACF field group next to the Payload file that replaces it.

**Run the commands.** Every ✅ block was executed against the running services on
the day it was written. If one of them disagrees with your machine, that is a
finding worth chasing, not a typo to skim past.

**Do not try to force an equivalent.** Chapters 2 and 5 contain long lists of
things with no WordPress counterpart in either direction. The temptation is to
map them anyway — "a link is sort of a join table, a workflow is sort of a
transaction" — and the analogy will hold right up until it costs you a day.
Where there is no equivalent, the text says so and explains what problem the new
thing solves that WordPress never had to solve. Believe it.

**WordPress is not the loser here.** It made different trade-offs, several of
them better. One database you can join, one admin, one deployment, and an
ecosystem of plugins somebody else security-patches are real engineering assets.
This track names the places where you are giving those up — [02 §2.10](02-concept-map.md),
[05 §5.12](05-medusa-for-woocommerce.md) and [06 §6.10](06-the-worked-example.md)
are the honest ones — so you can tell a client when this stack is the wrong
answer.

---

**Start with** [01-the-shift.md](01-the-shift.md) — one program became three, and
everything else in this track follows from that.
