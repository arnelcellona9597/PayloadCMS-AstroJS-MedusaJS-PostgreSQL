# 4 · Astro — if you have built WordPress themes

> Counterpart in the main course: [05 · Astro](../learn/05-astro.md).

Most of your skill transfers intact. A layout wraps pages, pages compose
components, components take arguments, and it all renders to HTML on the server
before anyone sees it. If you have written a theme, you know that shape.

One thing does not transfer. **`WP_Query` has no counterpart, because Astro has
no database.** Every byte of content on `localhost:4321` arrived over HTTP from
another process. [§4.6](#46-there-is-no-wp_query-because-there-is-no-database) is
the longest section here for that reason.

---

## 4.1 Most of a theme survives; one part of it does not

| WordPress | Here | |
|---|---|---|
| `style.css` header + activation | [`astro.config.mjs`](../../apps/storefront/astro.config.mjs) | ✅ no registry, no activation screen |
| `index.php`, `single.php`, `page.php` | `src/pages/**/*.astro` | ✅ §4.2 |
| `header.php` + `footer.php` | [`src/layouts/Layout.astro`](../../apps/storefront/src/layouts/Layout.astro) | ✅ §4.3 |
| `template-parts/*.php` | `src/components/*.astro` | ✅ §4.4 |
| the top of a PHP template | the `---` frontmatter | ✅ §4.5 |
| `WP_Query`, `get_posts()`, `$wpdb` | **nothing** | 🚫 §4.6 |
| `wp_enqueue_script()` | `client:*` on a component | ✅ used once in the app — §4.7 |
| `admin-post.php`, `admin-ajax.php` | `src/actions/index.ts` **and** `src/pages/api/*` | ✅ both — §4.8 |
| `mu-plugins/`, `template_redirect` | [`src/middleware.ts`](../../apps/storefront/src/middleware.ts) | ✅ §4.9 |
| ACF field types as documentation | `src/lib/types.ts` + `astro check` | ✅ §4.10 |
| `wp-content/uploads` | Payload's `apps/cms/public/media` | Astro stores nothing |
| `functions.php` | deliberately nowhere | see below |

`functions.php` is one file that accumulates everything a theme needs. Astro has
no such file, and the absence is the design: cross-cutting code in
`src/middleware.ts`, backend clients in `src/lib/`, configuration in
`astro.config.mjs`. Whether that is better depends on the day — a 3,000-line
`functions.php` is a known failure mode, and so is hunting through four
directories for the one line that sets a header.

```bash
find apps/storefront/src -maxdepth 1
```

```
apps/storefront/src
apps/storefront/src/lib
apps/storefront/src/layouts
apps/storefront/src/pages
apps/storefront/src/components
apps/storefront/src/actions
apps/storefront/src/middleware.ts
```

Six entries. That is the whole theme.

---

## 4.2 Routing is a directory listing, not a cascade

### Pages and routing

**WordPress:** the template hierarchy. Ask for a single post and WordPress tries
`single-post-{slug}.php`, then `single-post.php`, then `single.php`, then
`singular.php`, then `index.php`, taking the first that exists.

**Why it exists** — the cascade is a resolution *algorithm*: powerful, well
documented, and knowledge you carry in your head. Nothing in a theme directory
tells you which of five candidates wins, or that a file you have not created
would win if you created it. Astro replaces the algorithm with a map and has no
fallback chain: `posts/index.astro` serves `/posts`, `posts/[slug].astro` serves
`/posts/:slug` as `Astro.params.slug`. **The routing table is
`find apps/storefront/src/pages -type f`.**

| File | Route | Closest WordPress file | Lines |
|---|---|---|---|
| `index.astro` | `/` | `front-page.php` | 458 |
| `posts/index.astro` | `/posts` | `archive.php` | 143 |
| `posts/[slug].astro` | `/posts/:slug` | `single-post.php` | 87 |
| `posts/new.astro` | `/posts/new` | — (core has no front-end editor) | 77 |
| `posts/[id]/edit.astro` | `/posts/:id/edit` | — | 86 |
| `pages/[slug].astro` | `/pages/:slug` | `page.php` | 132 |
| `products/index.astro` | `/products` | `archive-product.php` | 78 |
| `products/[handle].astro` | `/products/:handle` | `single-product.php` | 114 |
| `reviews/index.astro` | `/reviews` | — | 323 |
| `reviews/[id]/edit.astro` | `/reviews/:id/edit` | — | 154 |
| `schema.astro` | `/schema` | a custom page template | 275 |
| `monitor.astro` | `/monitor` | a custom page template | 843 |

Plus six endpoints under `src/pages/api/` returning JSON
([05 §5.5](../learn/05-astro.md)). Three things to notice.

**`[slug].astro` is `single-{post_type}.php` without the post type.** The file
does not know it renders posts; the *directory* does. A second content type means
a second directory, not another entry in a hierarchy you must memorise.

**`[id]/edit.astro` uses an id while the public page uses a slug.** Payload
addresses documents by id, and a slug derives from the title, so an edit URL
built on a slug breaks when someone renames a post. WordPress makes the same
split with `?p=123` behind the pretty permalink.

**Static beats dynamic**, which matters because `posts/new.astro` and
`posts/[slug].astro` both match `/posts/new` —
[`posts/[slug].astro`](../../apps/storefront/src/pages/posts/%5Bslug%5D.astro)
documents the rule in its own header.

```bash
curl -s http://localhost:4321/posts/new | grep -o '<h1>[^<]*</h1>'
curl -s http://localhost:4321/posts/what-are-payload-cms-collections | grep -o '<h1>[^<]*</h1>'
curl -s -o /dev/null -w 'no-such-post → %{http_code}\n' http://localhost:4321/posts/no-such-post
```

```
<h1>New post</h1>
<h1>What are Payload CMS collections?</h1>
no-such-post → 404
```

**Reach for a dynamic segment when** the URL carries an identifier to look up.
**Avoid one when** a static file would do.

⚠️ **There is no `index.astro` fallback.** WordPress guarantees something
renders, because a theme must supply a final fallback — `index.php` in a classic
theme, `templates/index.html` in a block theme. Astro has no such floor: a URL
with no file is a 404, and that is the end of it.

---

## 4.3 `Layout.astro` is `get_header()` and `get_footer()` without the ordering problem

### Layouts

**WordPress:** `get_header()` at the top of every template, `get_footer()` at the
bottom, and a convention that you remember both.

**Why it exists** — a WordPress template owns the order, nothing stops it
forgetting `get_footer()`, and one HTML document ends up split across three files
that each hold an unbalanced fragment. An Astro layout holds the *whole* document
and renders the page inside it at `<slot />`. You cannot forget the footer,
because the footer is not yours to emit.

**Real** — one layout serves all twelve pages, and its most interesting line is a
CMS read
([`src/layouts/Layout.astro`](../../apps/storefront/src/layouts/Layout.astro)):

```astro
---
import { getSiteSettings } from '../lib/payload'
…
let settings: Awaited<ReturnType<typeof getSiteSettings>> | null = null

try {
  settings = await getSiteSettings()
} catch {
  settings = null
}

const announcement = settings?.announcement?.enabled ? settings.announcement : null
---
…
  <body>
    {
      announcement && (
        <div class:list={['announce', announcement.tone ?? 'info']}>
          <div class="wrap">{announcement.message}</div>
        </div>
      )
    }
    …
    <main class="wrap">
      <div class="page-head">
        <h1>{title}</h1>
        {subtitle && <p class="subtitle">{subtitle}</p>}
      </div>
      <slot />
    </main>
```

You have built this: a theme options panel driving the header — the ACF options
page, or `get_theme_mod()` in `header.php`. The editor flips the banner on, picks
a tone, writes a message, every page shows it. The only difference is where the
value comes from: a Payload **global** — one typed record with its own table and
its own REST path, a sibling of collections rather than one of them
([03 §3.5](03-payload-for-acf-and-cpt.md), [03 · Payload §3.14](../learn/03-payload.md)). The `try`/`catch` is load-bearing, because
a layout that throws breaks every page at once — `get_theme_mod()` cannot fail,
but a network call can.

```bash
curl -s http://localhost:3000/api/globals/site-settings \
  | python3 -c 'import json,sys; a=json.load(sys.stdin)["announcement"]; print(a["tone"], "|", a["message"])'
curl -s http://localhost:4321/products | grep -o 'class="announce[^"]*"><div class="wrap">[^<]*'
```

```
info | This banner comes from a Payload global — one record, read on every page.
class="announce info"><div class="wrap">This banner comes from a Payload global — one record, read on every page.
```

⚠️ **The banner costs one Payload request per page render, including pages that
never show it.** `get_theme_mod()` is an option lookup served from WordPress's
object cache. This repo caches nothing — `grep -rni 'cache-control'
apps/storefront/src` returns nothing 🚫 — which is honest rather than good.

---

## 4.4 Components are `get_template_part()` with a signature

### Components

**WordPress:** `get_template_part('template-parts/card', 'review', $args)`, then
`$args['review']` inside the part, and hope the caller sent it.

**Why it exists** — a template part is *included*, not called. It declares
nothing about what it needs, and a missing argument surfaces as an
undefined-array-key warning at render time, in production, in front of a visitor
(a notice before PHP 8, a warning since). An `.astro` component is a function
with a typed parameter list; `interface Props` is the signature, and passing the
wrong thing fails the build.

**Real** — the whole frontmatter of
[`RatingStars.astro`](../../apps/storefront/src/components/RatingStars.astro):

```astro
---
interface Props {
  rating: number
  showNumber?: boolean
}

const { rating, showNumber = false } = Astro.props
const filled = Math.round(rating)
---
```

Called as `<RatingStars rating={stats.average} showNumber />`. Omit `rating` and
the build fails; pass a string and the build fails. `$args['rating']` offers
neither guarantee.

| Component | Lines | Props | Imported by |
|---|---|---|---|
| `RatingStars.astro` | 15 | `rating`, `showNumber?` | `/`, `/products`, `/products/:handle`, `/reviews`, `ReviewCard.astro` |
| `FieldError.astro` | 16 | `messages?` | `PostFormFields.astro` |
| `ServiceStatus.astro` | 21 | `name`, `ok`, `detail`, `url`, `role` | **nothing** — see below |
| `ReviewCard.astro` | 25 | `review` | `/products/:handle` |
| `StatTile.astro` | 77 | `label`, `value`, `note?`, `tone?`, `href?` | `/`, `/monitor`, `/schema` |
| `PostFormFields.astro` | 79 | `post?`, `bodyText?`, `categories`, `errors?` | `/posts/new`, `/posts/:id/edit` |
| `DistributionBar.astro` | 121 | `title?`, `rows`, `unit?`, `emptyMessage?` | `/`, `/monitor` |

`PostFormFields.astro` is the one to study: create and edit are the same fields,
so they are one component, and it takes `errors` so a failed submission renders
per-field messages beside the inputs that caused them.

`ServiceStatus.astro` is the one to notice. It compiles, it type-checks, and
nothing imports it — the dashboard's service-health row is built from `StatTile`
instead. Confirm it yourself:

```bash
grep -rn 'ServiceStatus' apps/storefront/src || echo 'imported by nothing'
grep -n 'StatTile' apps/storefront/src/pages/index.astro | head -3
```

```
imported by nothing
3:import StatTile from '../components/StatTile.astro'
94:      <StatTile
101:      <StatTile
```

A dead template part in a WordPress theme is the same hazard, with one
difference: `get_template_part()` resolves by string at render time, so an
orphan is invisible until you grep for it. Here the import graph is the evidence,
and a bundler or a linter can be told to fail on it.

**Reach for a component when** the markup repeats or a block needs a name to be
readable. **Avoid one when** it would exist only to hide three lines.

⚠️ **Seven of the eight components are `.astro` and ship no JavaScript at all.**
An `.astro` component is a server template: no lifecycle, no state, no event
handlers. If you need those you need the eighth component, the React
`ReviewFilter.tsx` — §4.7 and [05 §5.11](../learn/05-astro.md).

---

## 4.5 The frontmatter is the top of a PHP template that the browser never sees

### The frontmatter

**WordPress:** everything above the first HTML tag in `single.php` — the
`get_post_meta()` calls, the attachment lookups, the variables the markup below
will use.

**Why it exists** — the code between the two `---` fences runs on the server,
once per request, before any HTML exists. Identical to PHP so far. The difference
comes afterwards: PHP is safe by construction, because the file never leaves the
server. JavaScript has no such guarantee — the same language runs in both places,
and the default assumption for a file in a frontend project is that it ships.
Astro draws the line explicitly: **frontmatter is server code, and the compiler
strips it from anything sent to the browser.**

**Real** —
[`posts/index.astro`](../../apps/storefront/src/pages/posts/index.astro):

```astro
---
import { actions, isInputError } from 'astro:actions'

import Layout from '../../layouts/Layout.astro'
import { listPosts } from '../../lib/payload'

export const prerender = false
…
const deleteResult = Astro.getActionResult(actions.post.delete)

const { docs: posts, totalDocs } = await listPosts({
  limit: 50,
  depth: 1,
  includeDrafts: true,
  sort: '-updatedAt',
})
---
```

`includeDrafts: true` sends the Payload API key, read in
[`lib/env.ts`](../../apps/storefront/src/lib/env.ts) from a variable *not*
prefixed `PUBLIC_`. Astro inlines only `PUBLIC_` variables into client code and
leaves the rest out of the client bundle entirely, so the key has no route to the
browser — `env.ts` says as much in its own header. Grep four delivered pages for
the key's literal value:

```bash
KEY=$(grep '^PAYLOAD_API_KEY=' apps/storefront/.env | cut -d= -f2)
for p in / /posts /reviews /products; do
  printf '%-10s %s occurrences\n' "$p" "$(curl -s http://localhost:4321$p | grep -c "$KEY")"
done
```

```
/          0 occurrences
/posts     0 occurrences
/reviews   0 occurrences
/products  0 occurrences
```

That is the backend-for-frontend argument in one command: the storefront holds
credentials the visitor is never given, exactly as a PHP theme does — unlike a
single-page app, which must make the credential public or proxy it through a
server you then have to write ([05 §5.2](../learn/05-astro.md)).

**Reach for the frontmatter when** work must happen before the HTML exists.
**Avoid putting work there when** it is slow and optional: `await` blocks the
response, nothing streams, and four sequential awaits are four round trips deep.

---

## 4.6 There is no `WP_Query`, because there is no database

### Data fetching

**WordPress:** `WP_Query`, `get_posts()`, `get_post_meta()`, and `$wpdb` when
those are not enough — all talking to MySQL from inside the same PHP process that
is rendering the page.

**Why it exists** — the blunt version first: **the Astro process cannot reach
either database, and that is not an oversight.** It has no driver, even though
both databases sit on the same machine:

```bash
grep -E '"(pg|postgres|mysql2|prisma|drizzle-orm)"' apps/storefront/package.json \
  || echo 'no database driver in apps/storefront/package.json'
grep -nE '"(@payloadcms/db-postgres|pg)"' apps/cms/package.json
docker exec apm-postgres psql -U postgres -At \
  -c "select datname from pg_database where not datistemplate order by 1"
```

```
no database driver in apps/storefront/package.json
20:    "@payloadcms/db-postgres": "3.88.0",
medusa_crud
payload_crud
postgres
```

`payload_crud` belongs to Payload, `medusa_crud` to Medusa, and the storefront
has credentials for neither — its `.env` holds two backend URLs, two API keys, a
Medusa admin login and two rate-limit settings, and nothing resembling a
connection string. Each service owns its tables and publishes an
HTTP interface. That rule makes the three apps independently deployable; it also
takes `WP_Query` away.

| WordPress | Here |
|---|---|
| `new WP_Query($args)` | `await listPosts({ … })` — one HTTP GET |
| `while (have_posts()) : the_post();` | `posts.map((post) => …)` in the template |
| `get_post_meta($id, 'key', true)` | a property on the object you already fetched |
| `$wpdb->get_results($sql)` | 🚫 nothing — no connection to run SQL on |
| a failed query returns an empty array | a failed fetch **throws** — you handle it |
| `posts_per_page`, `paged` | `limit`, `page` |
| `orderby` + `order` | `sort` — a `-` prefix reverses: `sort=-updatedAt` |
| `name` (a slug) | `where[slug][equals]` |
| `s` (search) | `where[title][contains]` — what this repo wires up |
| `cat` / `tax_query` | `where[category][equals]` |
| `meta_query` joining another table | 🚫 no equivalent — `depth`, below |

**Real** — every read goes through one client in
[`src/lib/payload.ts`](../../apps/storefront/src/lib/payload.ts), which turns a
non-2xx response into a `PayloadError` carrying the status (§4.8 shows where that
status surfaces). Two details will catch you. **There is no `/posts/slug/:slug`
route** — `getPostBySlug` filters the list with `where[slug][equals]` and takes
`docs[0]`, which is idiomatic Payload. And **`depth` replaces the JOIN you cannot
write**: `depth=0` returns `category: 2`, `depth=1` the whole category document,
`depth=2` relationships inside it ([03 §3.10](../learn/03-payload.md)). The posts
list asks for `depth: 1` because it prints the category name, and prints the
request it made:

```bash
curl -s http://localhost:4321/posts | grep -o 'GET http://localhost:3000/api/posts[^<]*'
```

```
GET http://localhost:3000/api/posts?limit=50&depth=1&sort=-updatedAt
```

**Concurrency is suddenly your problem.** A PHP template runs blocking queries
one after another and nobody minds, because MySQL is on the same box at a
millisecond a call. Four HTTP calls at 20 ms each, in sequence, cost 80 ms before
the first byte of HTML exists. So the dashboard fires everything at once
([`pages/index.astro`](../../apps/storefront/src/pages/index.astro)):

```astro
---
const [stats, categories, recentPosts, products, reviews] = await Promise.all([
  settle(() => getPostStats({ authenticated: true })),
  settle(() => listCategories()),
  settle(() => listPosts({ limit: 5, sort: '-updatedAt', depth: 0, includeDrafts: true })),
  settle(() => listProducts(50)),
  settle(() => listAdminReviews({ limit: 100, order: '-created_at' })),
])
---
```

[`settle`](../../apps/storefront/src/lib/settle.ts) turns a rejection into a
value *and* records how long the call took, so Medusa being down leaves the
Payload panels rendering and shows a reason where the commerce numbers would be.
You have never had to think about this in a theme, and that is a genuine
advantage of the old model, not a gap in your knowledge.

**And a service boundary creates N+1s you cannot JOIN away.** `/products` lists
products from Medusa's product module and shows each one's rating from the custom
review module. Two modules, no shared SQL, so
[`products/index.astro`](../../apps/storefront/src/pages/products/index.astro)
maps over the products and fetches ratings concurrently — and prints a card at
the bottom of the page admitting to it. Count the products and you have counted
the requests:

```bash
curl -s http://localhost:4321/products | grep -o 'href="/products/[a-z-]*"' | sort -u
```

```
href="/products/application-performance-monitoring"
href="/products/astro-commerce-toolkit"
href="/products/certificate-secrets-automation"
href="/products/dedicated-edge-server"
href="/products/global-cdn"
…
```

Fifteen products → sixteen Medusa requests per page view, plus the Payload
global for the banner. The N+1 got worse when the catalogue grew, which is
exactly how an N+1 behaves and why it is labelled on the page rather than hidden.

⚠️ **And it is now close enough to a limit to hit it.** Medusa's store surface is
rate limited to 240 requests per 60 seconds
([`api/middlewares.ts`](../../apps/commerce/src/api/middlewares.ts)), so sixteen
requests per view means roughly **fifteen page loads a minute** before the
storefront starts getting 429s and `/products` returns a 500.

With four products nobody noticed. That is the characteristic shape of an N+1:
it is invisible until the collection grows, and then it fails suddenly rather
than degrading. In WordPress one `JOIN` fixes this, or `update_meta_cache()` would
have fixed it silently. Here the fix is a purpose-built backend route resolving
many products' reviews at once: the cost of the boundary, paid in HTTP.
[06 §6.8](06-the-worked-example.md) counts the requests from the log and sketches
that route; [05 §5.9](../learn/05-astro.md) is the Astro-side treatment.

**Reach for a direct backend call when** the page renders on the server. **Avoid
one when** the browser needs data after load — that is §4.8's endpoints.

⚠️ **Transients and the object cache have no counterpart here.** WordPress gives
you `wp_cache_get()`, `set_transient()` and a dozen plugins on top. This
storefront has none: every render re-fetches everything. Deliberate for teaching,
not a recommendation.

---

## 4.7 Shipping JavaScript is opt-in, and this app opts in once

### SSR vs CSR vs islands

**WordPress:** all server, always. The HTML arrives complete; JavaScript is
whatever you or a plugin enqueued on top.

| | WordPress theme | React SPA | This Astro app |
|---|---|---|---|
| Who builds the HTML | PHP, per request | the browser, after JS loads | Node, per request |
| First paint needs JS | no | **yes** | no |
| JS shipped by default | only what is enqueued | the entire app | **zero** |
| Where data is fetched | in-process SQL | XHR from the browser | server `fetch`, before HTML exists |
| Where credentials live | PHP — safe | public, or proxied | the frontmatter — safe |
| Interactivity | a script per feature | everything, everywhere | one component at a time |
| Navigation | full page load | client-side router | full page load |

**Why it exists** — the third column's point is islands: the page is
server-rendered HTML, you mark individual components interactive with a
`client:*` directive, and only those ship JavaScript. It is
`wp_enqueue_script()` with the component attached to the script, and hydration
handled for you. The directives: `client:visible` (on scroll into view),
`client:idle` (once the main thread frees), `client:media` (when a media query
matches), `client:load` (immediately), `client:only` (skip server rendering
entirely). There is no single cheapest one — `client:visible` and `client:media`
may never hydrate at all, which makes them the cheapest *in practice* and the
worst choice for anything that must be interactive on arrival.

**Real** — one mount, in
[`reviews/index.astro`](../../apps/storefront/src/pages/reviews/index.astro):

```astro
<ReviewFilter
  client:visible
  reviews={reviews.map((r) => ({
    id: r.id,
    title: r.title,
    content: r.content,
    author_name: r.author_name,
    rating: r.rating,
    status: r.status,
  }))}
/>
```

**That is the only `client:` directive in the entire storefront**, and
`ReviewFilter.tsx` the only React component. The source says so, and the running
site confirms it — Astro wraps a hydrated component in `<astro-island>`:

```bash
grep -rn --include='*.astro' -E 'client:(load|idle|visible|media|only)[[:space:]]*$' apps/storefront/src
for p in /posts /products /reviews; do
  printf '%-10s %s island(s)\n' "$p" "$(curl -s http://localhost:4321$p | grep -c '<astro-island')"
done
curl -s http://localhost:4321/reviews | grep -oE 'component-url="[^"]+"' | sort -u
```

```
apps/storefront/src/pages/reviews/index.astro:76:        client:visible
/posts     0 island(s)
/products  0 island(s)
/reviews   1 island(s)
component-url="/src/components/ReviewFilter.tsx"
```

`/posts` does full CRUD — list, create, edit, delete — with zero islands. The
component's own header records what the one directive costs, measured on this
repo's production build: 179 kB for the React renderer, 7 kB of shared chunk and
2 kB for the component itself — **188 kB uncompressed, for one filter box.**
`client:*` is a bill, and you should know the amount before signing.

**Reach for an island when** interactivity needs client state the server cannot
pre-compute — filtering an already-loaded list is the textbook case, since a
round trip per keystroke would be absurd. **Avoid one when** the work must reach
the server anyway: creating a review has to hit Medusa, so an island would only
ship the validation logic twice.

⚠️ **Counting `<script>` tags undercounts islands, and an island's props are
serialised into the HTML.** The JavaScript is referenced by `<astro-island>`
*attributes*, not a script tag — and that element's `props="…"` attribute embeds
every review as JSON whether or not the island ever hydrates. You traded a second
request for a bigger first one: usually right, never free
([05 §5.11](../learn/05-astro.md)).

---

## 4.8 Actions are `admin-post.php` with the plumbing already written

### Actions vs endpoints

**WordPress:** `admin-post.php` for form posts, `admin-ajax.php` for XHR. Register
with `add_action('admin_post_my_thing', …)`, verify a nonce, check a capability,
read `$_POST` by hand, sanitise each field, redirect.

**Why it exists** — an Astro Action is a typed server function with a zod schema
attached. It can be a form's `action` attribute, so it works with JavaScript
disabled, and the same function is callable from client code with full types.
This storefront implements the same CRUD twice on purpose, and the files
cross-reference each other as Pattern A and Pattern B:

| | **Pattern A** — Actions | **Pattern B** — endpoints |
|---|---|---|
| Lives in | `src/actions/index.ts` | `src/pages/api/**/*.ts` |
| Covers | Payload / posts **only** | Medusa / reviews |
| WordPress analogue | `admin-post.php` | a REST controller |
| Validation | the `input:` zod schema, automatic | you call zod yourself |
| Field-level errors | `isInputError(error).fields` | you build the shape |
| Works with JS off | **yes**, via `accept: 'form'` | only if a page posts to it |
| Callable by other apps | no — this app only | yes, it is real HTTP |
| HTTP verbs | GET/POST (HTML form limits) | all of them |

Both exist because Actions are the better default for your own forms but are not
an HTTP surface. The moment something outside this app must call you — a mobile
client, a webhook, a `curl` in a runbook — you need an endpoint.

**Real** — [`src/actions/index.ts`](../../apps/storefront/src/actions/index.ts):

```ts
export const server = {
  post: {
    create: defineAction({
      accept: 'form',
      input: z.object(PostFields),
      handler: async (input) => {
        try {
          const post = await createPost(input)
          return { id: post.id, slug: post.slug, status: post._status }
        } catch (error) {
          throw toActionError(error)
        }
      },
    }),
    …
    delete: defineAction({
      accept: 'form',
      input: z.object({ id: z.coerce.number() }),
      handler: async ({ id }) => {
        try {
          await deletePost(id)
          return { id, deleted: true }
        } catch (error) {
          …
        }
      },
    }),
  },
}
```

The form side is `<form method="POST" action={actions.post.create}>`. Note that
`delete` is a POST form rather than an HTTP DELETE, for the same reason your
WordPress delete buttons were POST forms: **HTML forms can only issue GET and
POST.** Three behaviours, three commands — no Origin header, a 2-character title,
and an id that does not exist:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST 'http://localhost:4321/posts?_action=post.delete' -d 'id=999'
curl -s -D - -o /dev/null -X POST 'http://localhost:4321/posts/new?_action=post.create' \
  -H 'Origin: http://localhost:4321' -d 'title=ab' | sed -n '1p'
curl -s -D - -o /dev/null -X POST 'http://localhost:4321/posts?_action=post.delete' \
  -H 'Origin: http://localhost:4321' -d 'id=999' | sed -n '1p'
```

```
403
HTTP/1.1 400 AstroActionInputError
HTTP/1.1 404 AstroActionError
```

The middle one is the one to sit with: its 400 body is **the whole page,
re-rendered**, with the message beside the field.

```bash
curl -s -X POST 'http://localhost:4321/posts/new?_action=post.create' \
  -H 'Origin: http://localhost:4321' -d 'title=ab' | grep -o 'class="error-text">[^<]*'
```

```
class="error-text">Give the post a title of at least 3 characters.
```

No JavaScript ran. That is the progressive enhancement you know from
`admin-post.php`, with the validation and per-field error plumbing written for
you. The third shows `toActionError` mapping a `PayloadError` status onto an
`ActionError` code — `403 → FORBIDDEN`, `404 → NOT_FOUND`, else `BAD_REQUEST` —
so a backend's refusal reaches the user as the right status, not a generic 500.

⚠️ **Here WordPress is plainly better, and you should know it.**
`admin-post.php` arrives with `wp_nonce_field()` and `current_user_can()`, backed
by a real user and capability system. Astro's origin check (the 403 above) stops
cross-site form posts and nothing else. **This app has no authentication at all**
🚫 — anyone who can reach port 4321 can delete any post. Deliberate and
documented in [09 §9.5](../learn/09-to-production.md); do not carry the pattern
into production without closing it.

---

## 4.9 `middleware.ts` is an mu-plugin you cannot deactivate

### Middleware

**WordPress:** `mu-plugins/`, plus the early hooks — `plugins_loaded`, `init`,
`template_redirect`, `send_headers`.

**Why it exists** — one file, one exported function, running before every page
render and every endpoint. WordPress spreads the same job across a hook ladder
you have to learn; Astro gives you one position and `await next()` to decide what
happens around it.

| WordPress | Here |
|---|---|
| a file in `mu-plugins/` | `src/middleware.ts` — always on, cannot be switched off |
| `plugins_loaded` | the top of `onRequest` |
| `template_redirect` + `wp_redirect(); exit;` | `return new Response(…)` instead of calling `next()` |
| `send_headers` | mutate `response.headers` after `await next()` |
| `wp_die()` | return a `Response` with the status you want |
| `shutdown` | the code after `await next()` |
| `is_admin()` | inspect `url.pathname` yourself |

**Real** — the predicate that decides what gets throttled
([`src/middleware.ts`](../../apps/storefront/src/middleware.ts)):

```ts
function isLimited(url: URL, method: string): boolean {
  if (isObservability(url)) return false

  if (url.pathname.startsWith('/api/')) return true

  // Astro Actions post to the same page URL with ?_action=<name>.
  if (method === 'POST' && url.searchParams.has('_action')) return true

  return false
}
```

Three decisions worth stealing. **Reading the site is never throttled** — the
limiter covers `/api/*` and Action submissions, the surfaces that write, so
read traffic never needs an allow-list. Wordfence throttles page views too,
which is the right default when the whole site is one writable PHP
application. **The monitoring paths are exempt from both the limiter and the
request log**, because a flood once exhausted the budget and the next call to
`/api/monitor` came back 429: the tool reporting on the limiter was silenced by
the limiter, exactly when it was needed
([12 §12.3](../learn/12-operating-it.md)). **It fails open** — if `clientAddress`
throws, the key becomes `'unknown'` and the request proceeds.

```bash
for p in /posts /api/reviews /api/monitor; do
  printf '%-14s ' "$p"
  curl -s -D - -o /dev/null "http://localhost:4321$p" | grep -i 'x-ratelimit-limit' \
    || echo '(no limiter headers)'
done
```

```
/posts         (no limiter headers)
/api/reviews   x-ratelimit-limit: 120
/api/monitor   (no limiter headers)
```

**Reach for middleware when** the concern is genuinely every request. **Avoid it
when** one route needs it — a mistake here breaks the whole site.

⚠️ **The counters live in this process's memory.** Restart and the budget resets;
run two instances and each keeps its own. WordPress had the same problem and
solved it with the object cache; here the answer is Redis, and it is not wired up
([09 §9.7b](../learn/09-to-production.md)).

---

## 4.10 TypeScript is the contract ACF never wrote down

### TypeScript

**WordPress:** `get_field('rating')` returns `mixed`. You know it is an integer
because you configured the field that way in the ACF UI — but that knowledge
lives in the ACF admin and in your head, not in the template that uses it.

**Why it exists** — ACF's field configuration *is* a schema; it just is not
available to the code consuming it. PHP cannot tell you that
`get_field('rating')` is a number, so every template re-derives that belief from
memory, and a renamed field is discovered by a visitor. This storefront writes
the contract down by hand, in 121 lines
([`src/lib/types.ts`](../../apps/storefront/src/lib/types.ts)):

```ts
export type Post = {
  id: number
  title: string
  slug: string
  excerpt?: string | null
  content?: LexicalRoot | null
  /** An id when depth=0, the full document when depth>=1. */
  category?: number | Category | null
  coverImage?: number | Media | null
  tags?: { id?: string; tag: string }[] | null
  publishedAt?: string | null
  _status?: 'draft' | 'published'
  createdAt: string
  updatedAt: string
}
```

Read the `category` line twice. `number | Category | null` is the `depth`
parameter expressed as a type, and the compiler forces every template to handle
both shapes. A runtime surprise in PHP; a compile error here.

**Hand-written, deliberately.** Payload generates `apps/cms/src/payload-types.ts`
— 668 lines — and the storefront imports **none** of it. The file's header
explains why: importing it would couple the storefront to the CMS's file layout
and drag Payload's whole type graph in, and Medusa's generated types live in
`.medusa/types`, which only exists after a build. Declaring the consumed subset
locally keeps the three apps independently buildable.

Where it pays off most is blocks. `PageBlock` is a discriminated union, so the
`switch` in
[`pages/[slug].astro`](../../apps/storefront/src/pages/pages/%5Bslug%5D.astro)
is exhaustive and the build fails if you add a block type in Payload and forget
to render it — ACF's Flexible Content field with "did I handle every layout?"
answered by the compiler rather than by clicking every page
([03 §3.14](../learn/03-payload.md)).

```bash
npm --prefix apps/storefront run typecheck
```

```
23:05:47 [@astrojs/node] Enabling sessions with filesystem storage
23:05:47 [types] Generated 52ms
23:05:47 [check] Getting diagnostics for Astro files in …/apps/storefront...
Result (44 files):
- 0 errors
- 0 warnings
- 0 hints
```

⚠️ **These types describe what the storefront *believes*, not what the API
*returns*.** Remove a field in Payload and the type file still claims it exists,
the check still passes, and the failure surfaces at runtime exactly as it would
in PHP. Types across a service boundary are a contract, not a proof — do not let
anyone sell you "end-to-end type safety" without asking which end.

---

## 4.11 What has no WordPress word — and where WordPress is simply better

| No WordPress equivalent | Why WordPress never needed it |
|---|---|
| `client:*` directives | a theme never shipped a component tree; JS was enqueued files, not hydration of server-rendered markup |
| the frontmatter/template boundary | PHP source never left the server, so nothing had to be marked server-only |
| `output: 'server'` + an adapter | PHP had one deployment target; here a different host means a different adapter |
| `Promise.all` in a template | one process, one blocking connection — concurrency was the web server's job |
| `astro check` | PHP has linters and static analysers (PHPStan, Psalm), but nothing that type-checks a template's variables against the data a theme actually passes it |
| a build step | a theme edit is live when you save |
| `set:html` | PHP's default output was unescaped and you opted *in* with `esc_html()`; Astro escapes by default and you opt *out* — safe here only because [`lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts) escapes every text node |

| Where WordPress is better, or simpler | |
|---|---|
| **Media** | library, automatic `srcset`, image sizes, upload UI — included. Here Payload defines two sizes and generates both on upload, and the storefront renders them with a plain `<img>`; Astro's own `astro:assets` is used nowhere in this app 📋 |
| **Users and capabilities** | `wp_get_current_user()` and `current_user_can()` are one line each, backed by a real system. This app has none 🚫 |
| **CSRF** | `wp_nonce_field()` + `check_admin_referer()` is per-form and per-user; Astro's origin check is per-request and coarser |
| **Caching** | object cache, transients, WP Super Cache. Here: nothing 🚫 |
| **i18n** | `__()`, `.po` files, WPML. Payload localization and Astro i18n routing both exist in the installed packages and **neither is configured here** 📋 |
| **SEO** | Yoast gives titles, canonicals, Open Graph, sitemaps, schema. `Layout.astro` emits a `<title>` and a `<meta name="description">`. That is the entire SEO implementation in this repo |
| **Deployment** | upload a theme folder, versus install, build, run a Node process, keep it running, point a proxy at it |
| **One process** | one `wp-config.php`, one log. Here three services, three ports, three `.env` files — which is why [12 · Operating it](../learn/12-operating-it.md) exists |

None of this argues against the stack; it is the bill. WordPress bundled answers
to all of these and charged you in coupling — CMS, renderer, router, user system
and cache in one process, upgraded together. This stack unbundles them and hands
you the parts. The rows above are the parts it has not handed you yet.

---

## 4.12 Try it yourself

**1 · Add a route and watch nothing need registering.** Create
`apps/storefront/src/pages/hello.astro` with a layout and a heading, then
`curl -s localhost:4321/hello`. No activation, no rewrite flush.

**2 · Break route precedence on purpose.** Create a Payload post whose slug is
`new`, then visit `/posts/new`. You get the create form, not the post.

**3 · Prove the frontmatter never ships.** Add
`console.log('server only', env.payload.apiKey)` to a page's frontmatter and
watch it appear in the Astro terminal and nowhere in the page source.

**4 · Make a second island and measure it.** Add `client:load` to an `.astro`
component — it fails, because `.astro` components cannot hydrate. Convert it to
`.tsx`, then re-run the `astro-island` count from §4.7.

**5 · Break the contract and see which check catches it.** Rename `title` to
`heading` in `src/lib/types.ts` and run
`npm --prefix apps/storefront run typecheck`. Then rename the
field in Payload instead, leave the type alone, and run it again. One is caught;
the other is not — §4.10's warning, demonstrated.

---

## Check yourself

1. A request arrives for `/posts/what-are-payload-cms-collections`. Name every
   file it touches, in order, from `middleware.ts` to the HTML.
2. Why does the public post page use a slug and the edit page use an id?
3. The announcement banner renders on `/monitor`, a page with nothing to do with
   the CMS. What does that cost, and where would you fix it?
4. You need a product price on `/products`. What stops you writing a SQL `JOIN`
   to get it, and what do you do instead?
5. A colleague adds `client:load` to `RatingStars` so the stars animate. What
   ships to the browser that did not before, and how would you measure it?
6. When would you add an Action, and when an endpoint under `src/pages/api/`?
   Give one case for each where the other would be wrong.
7. `astro check` reports zero errors. Name two kinds of breakage it cannot see.
8. Which three jobs did `functions.php` do for you that now live in three
   different files, and which of the three would you have put somewhere else?

---

**Next:** [05-medusa-for-woocommerce.md](05-medusa-for-woocommerce.md) — products
and variants you will recognise, and a cart, checkout and order that are not here
at all.
