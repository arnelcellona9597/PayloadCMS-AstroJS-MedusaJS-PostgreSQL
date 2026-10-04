# 2 · Frontend — routing, archives, single pages and components

> Why it works this way:
> [04 · Astro for theme developers](../from-wordpress/04-astro-for-theme-developers.md)
> and [05 · Astro](../learn/05-astro.md). This page is the hands-on half.

Four of your questions live in the storefront: the archive page, the single post
page, routing, and the frontend half of "widget". All four are one app,
[`apps/storefront`](../../apps/storefront), and all four come down to one idea:
**a file in `src/pages/` is a URL, and nothing else is.**

⚠️ **Find your port first — every storefront command below uses `$SF`.** Astro 7
backgrounds its own dev server and takes the next free port if 4321 is busy, so
run `cd apps/storefront && npx astro dev status`, then set
`SF=http://localhost:4321` or whatever it printed — it will not always be 4321.
Commands aimed at Payload use `http://localhost:3000`; that port is fixed.
[04 §4.12](04-stack.md#412-how-to-find-the-storefront-when-it-is-not-on-4321)
explains why it moves and how to take 4321 back.

---

## 2.1 Routing is a map of files, not a cascade you memorise

**In WordPress:** the template hierarchy. Ask for a single post and WordPress
tries `single-post-{slug}.php`, then `single-post.php`, then `single.php`, then
`singular.php`, then `index.php`, taking the first that exists. Behind that sits
the rewrite layer — `WP_Rewrite`, `add_rewrite_rule()`, permalink structures, and
the "flush your permalinks" ritual when a URL mysteriously 404s.

**Here:** Astro maps files to routes explicitly. No cascade, no fallback chain,
and **no rewrite layer at all** — so there is nothing to flush. The routing table
is `find apps/storefront/src/pages -type f`, and this is what it currently says:

| File in `src/pages/` | URL it serves | Closest WordPress file |
|---|---|---|
| `index.astro` | `/` | `front-page.php` |
| `posts/index.astro` | `/posts` | `archive.php` |
| `posts/[slug].astro` | `/posts/:slug` | `single-post.php` |
| `posts/new.astro` | `/posts/new` | — core has no front-end editor |
| `posts/[id]/edit.astro` | `/posts/:id/edit` | — |
| `pages/[slug].astro` | `/pages/:slug` | `page.php` |
| `products/index.astro` | `/products` | `archive-product.php` |
| `products/[handle].astro` | `/products/:handle` | `single-product.php` |
| `reviews/index.astro` | `/reviews` | — |
| `reviews/[id]/edit.astro` | `/reviews/:id/edit` | — |
| `schema.astro` | `/schema` | a one-off page template |
| `monitor.astro` | `/monitor` | — |
| `api/health.ts`, `api/logs.ts`, `api/monitor.ts` | `/api/health`, `/api/logs`, `/api/monitor` | `register_rest_route()` |
| `api/reviews/index.ts`, `api/reviews/[id].ts`, `api/reviews/[id]/moderate.ts` | `/api/reviews`, `/api/reviews/:id`, `/api/reviews/:id/moderate` | `register_rest_route()` |

Eighteen files, eighteen URLs, nothing hidden. There are only four shapes to
learn, and that is the whole routing system:

| Shape | Example here | Gives you |
|---|---|---|
| `index.astro` in a folder | `posts/index.astro` | the folder's own URL, `/posts` |
| `[param].astro` | `posts/[slug].astro` | `Astro.params.slug` |
| a nested folder with a param | `posts/[id]/edit.astro` | `/posts/:id/edit` |
| a `.ts` file under `api/` | `api/health.ts` | JSON, not HTML — exports `GET`, `POST`, … |

**Steps** — to add a URL:

1. Create the file under `apps/storefront/src/pages/`. The path *is* the URL:
   `src/pages/about.astro` serves `/about`.
2. For a URL segment that varies, bracket it in the filename —
   `src/pages/guides/[slug].astro` serves `/guides/anything` and gives you
   `Astro.params.slug`.
3. Save. The dev server picks it up; there is no registration step, no
   `functions.php` edit, and nothing to activate.
4. To remove a URL, delete the file.

**Verify** — a route that exists, and one that does not:

```bash
curl -s -o /dev/null -w 'GET /posts          -> %{http_code}\n' "$SF/posts"
curl -s -o /dev/null -w 'GET /nothing-here   -> %{http_code}\n' "$SF/nothing-here"
```

```
GET /posts          -> 200
GET /nothing-here   -> 404
```

That 404 is Astro's built-in page. 📋 This repo has no `src/pages/404.astro`, so
you get the framework default — a theme with no `404.php`.

⚠️ **`getStaticPaths` is not needed here, and most Astro tutorials assume it
is.** Those tutorials target `output: 'static'`, where Astro must know every URL
at build time and `getStaticPaths()` enumerates them. This app sets
`output: 'server'`, so a dynamic route resolves per request and `Astro.params` is
simply read:

```bash
grep -rn 'getStaticPaths' apps/storefront/src | wc -l
grep -n "output:" apps/storefront/astro.config.mjs
```

```
0
9: * ── output: 'server' ───────────────────────────────────────────────────────
11: * `output: 'hybrid'` in a tutorial, that option was removed back in Astro 5 —
26:  output: 'server',
```

Zero occurrences. Copy a tutorial's `getStaticPaths` into this app and the page
still works — you will simply have written dead code. The comment at line 11 is
worth reading too: `output: 'hybrid'` was removed in Astro 5 and older tutorials
still use it.

⚠️ **Route precedence has exactly one rule: static beats dynamic.**
`posts/new.astro` and `posts/[slug].astro` both match `/posts/new`, and the
static file wins — documented in a comment at the top of
[`posts/[slug].astro`](../../apps/storefront/src/pages/posts/%5Bslug%5D.astro).
Remember that before an editor saves a post with the slug `new`:

```bash
curl -s "$SF/posts/new" | grep -oE '<h1[^>]*>[^<]+</h1>'
```

```
<h1>New post</h1>
```

**Where WordPress is ahead, plainly.** The hierarchy gives you fallbacks for
free: a theme with only `index.php` renders every post type, every archive and
every taxonomy. It also hands you archive URLs for every taxonomy and every date
without writing a line. Here a URL with no file is a 404, and §2.2 is you
building one archive by hand.

**Going deeper:**
[04 §4.2](../from-wordpress/04-astro-for-theme-developers.md) on why a map beats
a cascade; [05 §5.3](../learn/05-astro.md) on pages and the frontmatter.

---

## 2.2 How to build a posts archive page

**In WordPress:** `archive.php` or `home.php`. The main query has already run
before your template loads, so you write
`while ( have_posts() ) : the_post();` and WordPress hands you the rows. You
never fetch anything.

**Here:** nothing has run. The page's frontmatter fetches over HTTP from Payload,
then the template renders the array. The archive is
[`apps/storefront/src/pages/posts/index.astro`](../../apps/storefront/src/pages/posts/index.astro),
143 lines.

**Steps**

1. Create `src/pages/posts/index.astro`. The folder name is the URL.
2. Fetch in the frontmatter — the block between the `---` fences, which runs on
   the server and is never sent to the browser:

```astro
---
// apps/storefront/src/pages/posts/index.astro
import Layout from '../../layouts/Layout.astro'
import { listPosts } from '../../lib/payload'

export const prerender = false

const { docs: posts, totalDocs } = await listPosts({
  limit: 50,
  depth: 1,
  includeDrafts: true,
  sort: '-updatedAt',
})
---
```

   `listPosts` is at
   [`apps/storefront/src/lib/payload.ts:90`](../../apps/storefront/src/lib/payload.ts).
   `depth: 1` expands the `category` relationship so you can print
   `post.category.name`; `includeDrafts: true` is what sends the API key, and is
   the only reason drafts appear in this list.

3. Render the array. This is The Loop, written out:

```astro
<!-- apps/storefront/src/pages/posts/index.astro -->
{posts.map((post) => (
  <tr>
    <td><strong>{post.title}</strong><div class="small muted mono">/{post.slug}</div></td>
    <td class="small">
      {post.category && typeof post.category === 'object'
        ? post.category.name
        : <span class="muted">—</span>}
    </td>
    <td><span class:list={['badge', post._status ?? 'draft']}>{post._status ?? 'draft'}</span></td>
    …
  </tr>
))}
```

4. Handle the empty case yourself — there is no `if ( have_posts() ) : else :`.
   The real file branches on `posts.length === 0` and renders a notice telling
   you to run the seed.

**Verify** — titles that are in the HTML before any JavaScript runs:

```bash
curl -s "$SF/posts" | grep -oE '<strong>[^<]+</strong>' | head -4
```

```
<strong>Draft recipe post</strong>
<strong>Hello from the REST API</strong>
<strong>How routing works in Astro</strong>
<strong>Who owns what 1790868907</strong>
```

⚠️ **Your titles will not match these, and that is expected.** The sort is
`-updatedAt`, so the list reorders every time anything is edited, and the posts
above include rows left behind by the other recipes in this cookbook. What you
are checking is the *shape*: `<strong>` titles present in the HTML that `curl`
received, with no JavaScript involved.

### Pagination, honestly

Payload returns the pagination numbers on every list request. Astro gives you a
`?page=` query string. **Nothing in this repo joins the two** — 📋 the archive
asks for `limit: 50` and renders what comes back. This is the most obvious thing
missing from the storefront.

```bash
curl -s 'http://localhost:3000/api/posts?limit=2&page=2&depth=0' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print({k:v for k,v in d.items() if k!="docs"}); print([p["slug"] for p in d["docs"]])'
```

```
{'hasNextPage': True, 'hasPrevPage': True, 'limit': 2, 'nextPage': 3, 'page': 2, 'pagingCounter': 3, 'prevPage': 1, 'totalDocs': 8, 'totalPages': 4}
['who-owns-what-1790868907', 'who-owns-what-1790866486']
```

`totalDocs` and the slugs depend on what is in your `payload_crud` right now.
Note it counts **8**, not every row: this `curl` sends no API key, so Payload's
`read` access rule narrows the query to published documents — the drafts are
excluded from the total as well as from `docs`. The **keys**, not the numbers,
are the part you build against:

| Payload field | WordPress equivalent |
|---|---|
| `totalDocs` | `$wp_query->found_posts` |
| `totalPages` | `$wp_query->max_num_pages` |
| `page` | `get_query_var('paged')` |
| `limit` | `posts_per_page` |
| `hasNextPage` / `nextPage` | what `next_posts_link()` computes |

To wire it up, read the query string and pass it through — `listPosts` already
accepts `page` — then render links from `hasNextPage` and `hasPrevPage`. Every
other query parameter Payload takes is tabulated against its `WP_Query`
equivalent in [03 §3.2](03-data.md#32-the-query-parameters-and-the-wp_query-argument-each-one-replaces). That is
all of `the_posts_pagination()`, by hand:

```ts
const page = Number(Astro.url.searchParams.get('page') ?? 1)
const { docs, totalPages, hasNextPage } = await listPosts({ limit: 10, page })
```

⚠️ **`Astro.url` is where query strings live, not `Astro.params`.**
`Astro.params` holds path segments declared in the filename (`[slug]`, `[id]`);
anything after `?` is `Astro.url.searchParams`. Mixing them is the most common
mistake in this file layout.

⚠️ **`typeof post.category === 'object'` is not defensive padding.** Payload
returns a relationship as a bare ID at `depth=0` and a full document at
`depth=1`, so the field's type is genuinely a union
([03 §3.3](03-data.md#33-how-to-decide-what-depth-should-be)). ACF's Return Format setting
made that choice for you in the field UI; here it is a per-request parameter.

**Going deeper:**
[04 §4.6](../from-wordpress/04-astro-for-theme-developers.md) — there is no
`WP_Query`, because there is no database.

---

## 2.3 How to build a single post page

**In WordPress:** `single.php`. The post is already loaded; `the_title()` and
`the_content()` echo it. A missing post never reaches your template — WordPress
routed it to `404.php` first.

**Here:** the file is
[`apps/storefront/src/pages/posts/[slug].astro`](../../apps/storefront/src/pages/posts/%5Bslug%5D.astro),
87 lines, and you own both the fetch and the not-found branch.

**Steps**

1. Name the file for the parameter: `src/pages/posts/[slug].astro` gives you
   `Astro.params.slug`.
2. Read the param and fetch:

```astro
---
// apps/storefront/src/pages/posts/[slug].astro
const { slug } = Astro.params

const post = await getPostBySlug(slug!)
```

   There is no `/posts/slug/:slug` route on Payload. `getPostBySlug`
   ([`payload.ts:128`](../../apps/storefront/src/lib/payload.ts)) filters the
   list and takes the first result — `?where[slug][equals]=…&limit=1`. That is
   the idiomatic Payload approach, and it is one request, not two.

3. Decide what "not found" means. **Return a `Response` from the frontmatter** —
   that is the whole mechanism, and it short-circuits rendering:

```astro
let draftOnly = false

if (!post) {
  const asEditor = await getPostBySlug(slug!, { includeDrafts: true })
  draftOnly = Boolean(asEditor)

  if (!draftOnly) {
    return new Response('Post not found', { status: 404 })
  }
}
```

   The retry with the API key is deliberate: if the post exists but is a draft,
   the page says so instead of lying with a 404. Payload's `read` access rule
   narrows the anonymous query to published documents — that is
   [03 §3.9](../from-wordpress/03-payload-for-acf-and-cpt.md).

4. Render. `post.content` is **not** HTML — §2.4.

**Verify** — all three outcomes, from one file:

```bash
curl -s -o /dev/null -w 'published -> %{http_code}  ' "$SF/posts/what-are-payload-cms-collections"
curl -s "$SF/posts/what-are-payload-cms-collections" | grep -oE '<h1[^>]*>[^<]+</h1>'
curl -s -w '  <- %{http_code}\n' "$SF/posts/no-such-post"
curl -s -o /dev/null -w 'draft     -> %{http_code}  ' "$SF/posts/draft-a-performance-budget-for-this-stack"
curl -s "$SF/posts/draft-a-performance-budget-for-this-stack" | grep -oE '<h1[^>]*>[^<]+</h1>'
```

```
published -> 200  <h1>What are Payload CMS collections?</h1>
Post not found  <- 404
draft     -> 200  <h1>Not published</h1>
```

⚠️ **`Astro.params.slug` is `string | undefined` to TypeScript**, which is why
the file writes `slug!`. Astro cannot prove at compile time that the route
matched, even though the file cannot run otherwise. Assert with `!` as this file
does, or guard it — do not reach for `any`.

⚠️ **Three things WordPress did for you, you now do yourself:** routing the 404,
choosing the HTTP status, and loading the post. What you gain is the ability to
answer "it exists but you cannot see it" differently from "it does not exist",
which `single.php` cannot express at all.

**Going deeper:**
[04 §4.5](../from-wordpress/04-astro-for-theme-developers.md) on the frontmatter;
[05 §5.3](../learn/05-astro.md).

---

## 2.4 Rich text is a JSON tree you convert — `the_content()` has no equivalent

The biggest surprise on the frontend, so it gets its own recipe.

**In WordPress:** `post_content` is a string of HTML. `the_content()` runs it
through filters (`wpautop`, shortcodes, oEmbed) and echoes it. You never parse
anything.

**Here:** Payload's `richText` field stores a **Lexical node tree** as `jsonb`.
Nothing echoes it. The repo ships a hand-written converter,
[`apps/storefront/src/lib/lexical.ts`](../../apps/storefront/src/lib/lexical.ts)
— 144 lines, dependency-free.

**Steps**

1. Look at what is actually stored:

```bash
curl -gs 'http://localhost:3000/api/posts?where[slug][equals]=what-are-payload-cms-collections&depth=0&limit=1' \
  | python3 -c '
import json,sys
root = json.load(sys.stdin)["docs"][0]["content"]["root"]
print("root children:", [n["type"] for n in root["children"]])
print(json.dumps(root["children"][0]["children"][0], indent=2))'
```

```
root children: ['paragraph', 'paragraph']
{
  "mode": "normal",
  "text": "Payload owns payload_crud. Medusa owns medusa_crud. Neither can see the other.",
  "type": "text",
  "style": "",
  "detail": 0,
  "format": 0,
  "version": 1
}
```

A `root`, two `paragraph` children, and a `text` node inside each. No HTML
anywhere.

2. Walk the tree. The converter is a `switch` on `node.type`:

```ts
// apps/storefront/src/lib/lexical.ts
function renderNode(node: LexicalNode): string {
  switch (node.type) {
    case 'text':      return renderText(node)
    case 'paragraph': { const inner = renderChildren(node.children)
                        return inner.trim() ? `<p>${inner}</p>` : '' }
    case 'heading':   { const tag = node.tag && /^h[1-6]$/.test(node.tag) ? node.tag : 'h2'
                        return `<${tag}>${renderChildren(node.children)}</${tag}>` }
    …  // elided: linebreak, quote, list, listitem, link, autolink,
       // horizontalrule, root
    default:
      // Unknown node types (uploads, blocks, relationships…) still contain text
      // worth showing, so recurse rather than dropping the subtree silently.
      return renderChildren(node.children)
  }
}
```

   Formatting is a **bitmask on the text node**, not nested tags —
   `FORMAT_BOLD = 1`, `FORMAT_ITALIC = 1 << 1` and so on at
   [`lexical.ts:21-25`](../../apps/storefront/src/lib/lexical.ts). Bold-italic is
   `format: 3`, not two wrapper elements.

3. Use it in the page, with the one `set:html` this file allows itself:

```astro
<!-- apps/storefront/src/pages/posts/[slug].astro -->
{/*
  `set:html` is Astro's explicit opt-in to unescaped HTML. It is safe here
  because lexicalToHtml() escapes every text node itself — see
  src/lib/lexical.ts. Never pass raw CMS output straight into it.
*/}
<div class="prose" set:html={html} />
```

**Verify** — that tree, as HTML:

```bash
curl -s "$SF/posts/what-are-payload-cms-collections" \
  | python3 -c 'import re,sys; print(re.search(r"<div class=\"prose\">(.*?)</div>", sys.stdin.read(), re.S).group(1))'
```

```
<p>Payload owns payload_crud. Medusa owns medusa_crud. Neither can see the other.</p><p>That is not a limitation to work around — it is the boundary that lets each service own its own migrations, and it forces integration to happen in the one place you can reason about it: the Astro layer.</p>
```

The converter exports three functions. Two are wired into pages; the third is
written and tested but not yet called from one:

| Function | Returns | Used by |
|---|---|---|
| `lexicalToHtml` | HTML string | `posts/[slug].astro`, the `prose` block in `pages/[slug].astro` |
| `lexicalToText` | one flat line | 📋 **no page yet** — exported and unit-tested, intended for meta descriptions and list previews |
| `lexicalToPlainParagraphs` | text with blank lines between blocks | `posts/[id]/edit.astro`, so a tree round-trips through a `<textarea>` |

```bash
grep -rn 'lexicalToText' apps/storefront/src --include='*.astro' --include='*.tsx' | wc -l
grep -rln 'lexicalToText' apps/storefront/src | sort
```

```
0
apps/storefront/src/lib/__tests__/lexical.test.ts
apps/storefront/src/lib/lexical.ts
```

Zero `.astro` or `.tsx` callers: it is reachable from a test and from nowhere
else. Reach for it when you add a `<meta name="description">`.

⚠️ **Never pass CMS output to `set:html` without escaping first.** This repo is
safe because `escapeHtml()` runs on every text node inside the converter, not
because `set:html` is safe.

⚠️ **Payload ships a real renderer; this repo does not use it.** 📋
`@payloadcms/richtext-lexical/react` renders the tree as React components. The
hand-written converter exists so the storefront stays React-free, and so you can
read it. For a production site with editors using the full Lexical toolbar,
prefer the official renderer over extending this file.

**Going deeper:** [05 §5.12](../learn/05-astro.md) — rendering rich text safely.

---

## 2.5 How to make a reusable component — `get_template_part()` with a signature

**In WordPress:** `get_template_part( 'template-parts/card', 'post' )`. The
partial inherits globals and whatever is in scope; passing data means
`set_query_var()`, the `$args` array added in WP 5.5, or relying on the global
`$post`. Nothing checks that the partial got what it needed.

**Here:** a `.astro` file under `src/components/` with a typed `Props` interface.
Arguments are explicit and `astro check` enforces them.

**Steps**

1. Create the file and declare the contract in its frontmatter:

```astro
---
// apps/storefront/src/components/RatingStars.astro
interface Props {
  rating: number
  showNumber?: boolean
}

const { rating, showNumber = false } = Astro.props
const filled = Math.round(rating)
---
```

2. Import it where you need it and pass props as attributes:

```astro
---
// apps/storefront/src/pages/index.astro — the import goes in the frontmatter
import StatTile from '../components/StatTile.astro'
…
---

<StatTile
  label="Payload · CMS"
  value={payloadOk ? 'Reachable' : 'Down'}
  note={payloadOk ? `${payloadMs}ms · :3000` : (stats.ok ? '' : stats.error)}
  tone={payloadOk ? 'ok' : 'down'}
  href="http://localhost:3000/admin"
/>
```

   The import belongs **between the `---` fences**, with the rest of the
   server-side code. An `import` in the template body is not an import; it is
   text.

3. There is no registration step. No `functions.php`, no `add_theme_support`, no
   autoloader — the import *is* the registration.

All eight components in the repo, with their real props:

| Component | Props | Used by |
|---|---|---|
| [`StatTile.astro`](../../apps/storefront/src/components/StatTile.astro) | `label`, `value`, `note?`, `tone?`, `href?` | `index`, `monitor`, `schema` |
| [`DistributionBar.astro`](../../apps/storefront/src/components/DistributionBar.astro) | `title?`, `rows[]`, `unit?`, `emptyMessage?` | `index`, `monitor` |
| [`RatingStars.astro`](../../apps/storefront/src/components/RatingStars.astro) | `rating`, `showNumber?` | `index`, `products/*`, `reviews/index` |
| [`ReviewCard.astro`](../../apps/storefront/src/components/ReviewCard.astro) | `review` | `products/[handle]` |
| [`PostFormFields.astro`](../../apps/storefront/src/components/PostFormFields.astro) | `post?`, `bodyText?`, `categories`, `errors?` | `posts/new`, `posts/[id]/edit` |
| [`FieldError.astro`](../../apps/storefront/src/components/FieldError.astro) | `messages?` | `PostFormFields.astro` only |
| [`ServiceStatus.astro`](../../apps/storefront/src/components/ServiceStatus.astro) | `name`, `ok`, `detail`, `url`, `role` | **nothing** — an orphan, see the Verify below |
| [`ReviewFilter.tsx`](../../apps/storefront/src/components/ReviewFilter.tsx) | `reviews[]` | `reviews/index` — §2.8 |

**Verify** — count the imports, then hunt the orphan. The second command prints
nothing, which is the finding:

```bash
grep -rn "components/" apps/storefront/src/pages --include='*.astro' | grep -c import
grep -rn "ServiceStatus" apps/storefront/src | grep -v 'components/ServiceStatus.astro:'
```

```
13
```

Thirteen imports across the pages, and not one of them is `ServiceStatus.astro`.
That second `grep` is *proof*, which is the part worth noticing: an Astro import
is a static identifier, so no caller means no caller. `get_template_part()` takes
a **string**, and that string can be built at runtime
(`get_template_part( 'template-parts/card', $type )`), so a silent `grep` for a
partial's filename is evidence, not proof. Drop `| grep -c import` to see the
full map.

⚠️ **Components do not nest a layout.** `Layout.astro` is imported by pages, not
wrapped around components. In a classic theme, `get_header()` and `get_footer()`
are two calls you have to remember in the right order — forget one and the page
breaks open. A layout with a `<slot />` cannot have that failure mode, because
the wrapper is one thing, not two halves.

⚠️ **`PostFormFields.astro` is the pattern to copy.** Two pages (`new` and
`edit`) share one field set, so they cannot drift apart. That is exactly why you
reach for `get_template_part()` in a theme, and the reason is unchanged.

**Going deeper:**
[04 §4.4](../from-wordpress/04-astro-for-theme-developers.md) — components are
`get_template_part()` with a signature.

---

## 2.6 "Widget", part one: a reusable block an editor can edit

"Widget" means two different things here, and conflating them costs an
afternoon. This section is the WordPress **sidebar widget** — reusable UI that
appears on many pages, whose content an editor controls. §2.7 is the *admin
dashboard* widget, which is a different thing entirely.

**In WordPress:** `register_sidebar()`, then a block placed in that widget area
(block-based since WP 5.8) or a classic `WP_Widget`. The editor drops it into a
sidebar, types some text, and it appears everywhere that sidebar renders.

**Here:** two pieces, and neither is a widget API.

| WordPress widget part | Here |
|---|---|
| the widget's markup | an `.astro` component, or markup in the layout |
| the editor-editable content | a Payload **global** |
| the sidebar / block area | wherever you put it — `Layout.astro`, usually |
| `register_sidebar()`, `dynamic_sidebar()` | 🚫 no equivalent, and none needed |

**The live worked example is the announcement banner**, and it is exactly this
pattern: an editor edits one record in Payload, every page shows it.

**Steps**

1. Model the content as a global —
   [`apps/cms/src/globals/SiteSettings.ts`](../../apps/cms/src/globals/SiteSettings.ts)
   already has it, and
   [01 §1.7](01-content.md#17-how-to-share-one-piece-of-content-across-every-page)
   is the recipe for declaring one:

```ts
// apps/cms/src/globals/SiteSettings.ts
{ name: 'announcement', type: 'group', fields: [
  { name: 'enabled', type: 'checkbox', defaultValue: false },
  { name: 'message', type: 'text' },
  { name: 'tone', type: 'select', defaultValue: 'info', options: [ … ] },
] },
```

2. Read it once, in the layout, so every page gets it —
   [`apps/storefront/src/layouts/Layout.astro`](../../apps/storefront/src/layouts/Layout.astro):

```astro
---
// apps/storefront/src/layouts/Layout.astro
let settings: Awaited<ReturnType<typeof getSiteSettings>> | null = null

try {
  settings = await getSiteSettings()
} catch {
  settings = null
}

const announcement = settings?.announcement?.enabled ? settings.announcement : null
---
```

3. Render it conditionally, above everything else:

```astro
<!-- apps/storefront/src/layouts/Layout.astro -->
{
  announcement && (
    <div class:list={['announce', announcement.tone ?? 'info']}>
      <div class="wrap">{announcement.message}</div>
    </div>
  )
}
```

4. Edit the content at **http://localhost:3000/admin/globals/site-settings**.
   Untick `enabled` and the banner disappears from every page — no deploy.

**Verify** — one record, five pages:

```bash
for p in / /posts /products /reviews /pages/about-this-stack; do
  printf '%-24s %s\n' "$p" "$(curl -s "$SF$p" \
    | grep -oE '<div class="announce [^"]*"><div class="wrap">[^<]*' | sed 's/.*wrap">//' | cut -c1-44)"
done
curl -s http://localhost:3000/api/globals/site-settings \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["announcement"])'
```

```
/                        This banner comes from a Payload global —
/posts                   This banner comes from a Payload global —
/products                This banner comes from a Payload global —
/reviews                 This banner comes from a Payload global —
/pages/about-this-stack  This banner comes from a Payload global —
{'enabled': True, 'message': 'This banner comes from a Payload global — one record, read on every page.', 'tone': 'info'}
```

⚠️ **That banner costs one Payload HTTP request per page render, including pages
that never show it.** `get_option()` was an in-process read, usually from the
object cache. The layout wraps the call in `try`/`catch` precisely because a
throwing layout takes down every page at once — the comment at
[`Layout.astro:20-35`](../../apps/storefront/src/layouts/Layout.astro) says so.
Caching this is the first optimisation this stack needs, and there is no plugin
that will do it for you —
[05 §5.7](05-plugins.md#57-how-to-cache--and-why-there-is-no-caching-plugin),
costed in [09 §9.6](../learn/09-to-production.md).

⚠️ **If the content is structural rather than editorial, skip the global.** A
component with hard-coded markup and no CMS round trip is cheaper and simpler.
Reach for a global only when someone who cannot deploy needs to change the words.

**Going deeper:**
[03 §3.5](../from-wordpress/03-payload-for-acf-and-cpt.md) — a global is an ACF
options page with a real table.

---

## 2.7 "Widget", part two: an admin dashboard widget

**In WordPress:** `add_meta_box()` for a panel on an edit screen, or
`wp_add_dashboard_widget()` for the dashboard. Routine work for you.

**Here:** which backend you are extending decides everything.

| Admin | Custom UI in this repo | Label |
|---|---|---|
| Payload (`:3000/admin`) | none — `admin: { components: … }` is never used | 📋 supported, not configured |
| Medusa (`:9000/app`) | [`src/admin/widgets/product-reviews.tsx`](../../apps/commerce/src/admin/widgets/product-reviews.tsx) | ✅ real and running |

**Steps** — for Medusa, the one you can actually run:

1. Create a file under `apps/commerce/src/admin/widgets/`. Medusa's dashboard
   scans that directory at build time; there is no registration call.
2. Default-export a React component.
3. Export a `config` built with `defineWidgetConfig`, naming a **zone**:

```tsx
// apps/commerce/src/admin/widgets/product-reviews.tsx
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import { Badge, Button, Container, Heading, Text, Table, toast } from "@medusajs/ui"
import { useEffect, useState } from "react"

…  // a local `type Review = { … }` and a STATUS_COLOR map, elided

const ProductReviewsWidget = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const [reviews, setReviews] = useState<Review[]>([])
  …
  const load = async () => {
    const res = await fetch(
      `/admin/reviews?product_id=${product.id}&limit=100&order=-created_at`,
      { credentials: "include" }
    )
    …
  }
  …
}

/**
 * The zone determines where this renders. Other useful zones follow the same
 * `<entity>.<page>.<position>` shape, e.g. `order.details.before`,
 * `customer.details.after`, `product.list.before`.
 */
export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductReviewsWidget
```

4. The component receives the record it is mounted beside:
   `DetailWidgetProps<AdminProduct>` gives you `data: product`. That is `$post`
   on a meta box, typed.

**Verify** — prove the widget was compiled into the dashboard bundle, then look
at it:

```bash
ls apps/commerce/src/admin/widgets/
grep -rl 'product.details.after' apps/commerce/.medusa/server/public/admin/assets | head -1
curl -s -o /dev/null -w '/app                        -> %{http_code}\n' http://localhost:9000/app
curl -s -o /dev/null -w '/admin/reviews (no session) -> %{http_code}\n' http://localhost:9000/admin/reviews
```

```
product-reviews.tsx
apps/commerce/.medusa/server/public/admin/assets/index-DCBK3SlZ.js
/app                        -> 200
/admin/reviews (no session) -> 401
```

Your bundle's hash will differ — it changes on every build — and
`.medusa/server/public/admin/` is a **build artifact**, so the `grep` finds
nothing until `medusa develop` or `medusa build` has run at least once. The
point is that your zone string ends up *inside Medusa's own bundle*, not loaded
beside it. The 401 is the other half: the route needs the dashboard's session,
which is why the widget sends `credentials: "include"` and no header.

Then open **http://localhost:9000/app**, open any product, and scroll past the
details card. The approve / reject / delete buttons call `/admin/reviews/:id` —
the routes in `apps/commerce/src/api/admin/`.

⚠️ **There is no `Authorization` header anywhere in that widget.** The dashboard
is a browser session, so the auth cookie rides along and `credentials: "include"`
is all it needs — spelled out at
[`product-reviews.tsx:44-49`](../../apps/commerce/src/admin/widgets/product-reviews.tsx).
The Astro storefront cannot use that session, which is why
[`medusa-admin.ts`](../../apps/storefront/src/lib/medusa-admin.ts) logs in for a
JWT instead.

⚠️ **You are not forking the dashboard.** Your file is compiled into it, so a
Medusa upgrade does not break it as long as the zone still exists — and the zone
names are part of Medusa's published widget API. `add_meta_box()`'s `$context`
and `$priority` are documented too; the difference is that a zone is a
compile-time name you can grep for, while a meta box's final position depends on
what every other plugin registered and on the user's screen layout.

⚠️ **For Payload, this recipe does not exist here.** 📋 The capability is real —
`admin: { components: … }` on a collection, resolved through a generated import
map — but nothing in this repo declares one:

```bash
grep -rn "components" apps/cms/src/collections apps/cms/src/globals apps/cms/src/payload.config.ts | wc -l
```

```
0
```

Do not copy a Medusa widget into `apps/cms` and expect it to mount.

**Going deeper:** [learn 04 §4.10](../learn/04-medusa.md) on admin widgets;
[03 §3.14](../from-wordpress/03-payload-for-acf-and-cpt.md) on why Payload's
admin here is entirely generated.

---

## 2.8 Make a component an island only when the server cannot pre-compute it

**In WordPress:** `wp_enqueue_script()`. A script enqueued on the
`wp_enqueue_scripts` hook loads site-wide; keeping it off a page means
`is_page()`-style conditionals inside that hook. Block themes ship very little
front-end JavaScript of their own, so the baseline is far lighter than it was —
but the default is still "loaded unless you exclude it", and most plugins
enqueue on every page.

**Here:** a component ships zero JavaScript unless you write a `client:`
directive on it. Shipping JS is opt-in, per component, per page.

**Steps**

1. Write the component as `.tsx` (or `.vue`, `.svelte`) rather than `.astro` —
   `.astro` components cannot hydrate.
2. Make sure the framework integration is in the config. It is —
   `integrations: [react()]` at
   [`astro.config.mjs:38`](../../apps/storefront/astro.config.mjs). An
   integration is a compiler capability, not a runtime payload; it costs nothing
   until something hydrates.
3. Add exactly one directive where you use it:

```astro
<!-- apps/storefront/src/pages/reviews/index.astro -->
<ReviewFilter
  client:visible
  reviews={reviews.map((r) => ({ id: r.id, title: r.title, … }))}
/>
```

The five directives, and when each is right:

| Directive | Hydrates | Use for |
|---|---|---|
| `client:load` | immediately | above-the-fold controls hit at once |
| `client:idle` | when the main thread frees up | nice-to-have interactivity |
| `client:visible` | when it scrolls into view | **this repo's choice** — anything below the fold |
| `client:media={query}` | when the media query matches | a mobile-only drawer |
| `client:only={framework}` | never server-rendered | components that touch `window` on first render |

**Verify** — the whole storefront has one real directive, and you can see its
effect in the HTML:

```bash
grep -rn --include='*.astro' --include='*.tsx' -E 'client:(load|idle|visible|media|only)' apps/storefront/src
for p in /posts /products /reviews; do
  printf '%-10s %s islands\n' "$p" "$(curl -s "$SF$p" | grep -o '<astro-island' | wc -l)"
done
curl -s "$SF/reviews" | grep -oE 'component-url="[^"]*"|client="[^"]*"'
```

```
apps/storefront/src/pages/reviews/index.astro:53:    `client:visible` hydrates it only when it scrolls into view, so the JavaScript
apps/storefront/src/pages/reviews/index.astro:57:      client:idle     after the main thread is free
apps/storefront/src/pages/reviews/index.astro:58:      client:visible  when it enters the viewport   ← this one
apps/storefront/src/pages/reviews/index.astro:59:      client:load     immediately on page load
apps/storefront/src/pages/reviews/index.astro:60:      client:only     skip server rendering entirely (no HTML until JS runs)
apps/storefront/src/pages/reviews/index.astro:76:        client:visible
/posts     0 islands
/products  0 islands
/reviews   1 islands
component-url="/src/components/ReviewFilter.tsx"
client="visible"
```

Six grep hits, five of them the comment block at lines 53–60 that documents the
directives. **Line 76 is the only real one in the app.** The rendered HTML is the
authoritative proof: `/posts` does full CRUD — create, edit, delete — and ships
**zero** islands; `/reviews` ships one so a filter box can work without a round
trip.

⚠️ **`component-url="/src/components/ReviewFilter.tsx"` is the dev server
talking.** It serves the source path and compiles on demand. After
`npm --prefix apps/storefront run build` the same attribute points at a hashed
chunk under `/_astro/`, which is where you measure the real bill:

```bash
ls -l apps/storefront/dist/client/_astro/*.js \
  | awk '{printf "%-44s %6.1f kB\n", $NF, $5/1000}'
```

```
apps/storefront/dist/client/_astro/ReviewFilter.BCnikf87.js    2.1 kB
apps/storefront/dist/client/_astro/client.DnM_O5Vj.js  184.0 kB
apps/storefront/dist/client/_astro/react.B3l9tXpq.js    7.6 kB
```

| Chunk | What it is | Size |
|---|---|---|
| `client.*.js` | the React renderer | 184.0 kB |
| `react.*.js` | shared chunk | 7.6 kB |
| `ReviewFilter.*.js` | the component you wrote | 2.1 kB |
| **total, uncompressed** | | **193.7 kB** |

The hashes change on every build, and the comment at
[`ReviewFilter.tsx:27-31`](../../apps/storefront/src/components/ReviewFilter.tsx)
records slightly smaller figures from an earlier one — the shape is what
matters. **Roughly 192 kB of that is the renderer, not your code.** It is a
fixed entry fee: the second island on the page costs only its own few kB.

**The test, stated once:** *does the interactivity require client state the
server cannot pre-compute?* Filtering an already-loaded list does — it is
instant, local, and a round trip per keystroke would be absurd. Creating a review
does not; it must reach the server anyway, so making it an island would mean
shipping validation logic twice.

⚠️ **Counting `<script src>` tags undercounts islands badly.** Astro references
island JavaScript through `astro-island` *attributes*, not script tags — which is
why the command above greps for `<astro-island`.

⚠️ **The default is inverted, and that is the real difference.** In WordPress a
script you register loads unless you exclude it, and the exclusions are per-page
work spread across themes and plugins. Here nothing ships unless a `client:`
directive asks for it, so every kilobyte is a line you wrote. WordPress has
closed much of the gap — block themes do not enqueue jQuery on the front end —
but you still audit what got added; here you audit what you added.

**Going deeper:** [05 §5.11](../learn/05-astro.md) — islands, measured rather
than estimated — and
[04 §4.7](../from-wordpress/04-astro-for-theme-developers.md).

---

## Check yourself

1. You want `/blog/2026/10/some-post` to work. In WordPress that is a rewrite
   rule and a permalink flush. Name the files you would create here, and say what
   `Astro.params` holds in each.
2. A tutorial tells you to export `getStaticPaths()` from `[slug].astro`. Why
   does this repo not need it, and which line in `astro.config.mjs` is the reason?
3. `posts/new.astro` and `posts/[slug].astro` both match `/posts/new`. Which wins,
   and what breaks if an editor names a post slug `new`?
4. The archive asks Payload for 50 posts and ignores `totalPages`. Write the two
   frontmatter lines that turn `?page=2` into a working second page.
5. `the_content()` echoes a string; `post.content` is a tree. Name the function
   that converts it, the file it lives in, and the one reason `set:html` is safe
   in `posts/[slug].astro`.
6. `ServiceStatus.astro` has five props and zero importers. What would you do
   with it, and which command proved the claim?
7. "Widget" meant two different things here. For each, name the file in this repo
   that implements it — or say honestly that there is none.
8. `/posts` does create, edit and delete with zero islands; `/reviews` ships
   about 194 kB for a filter box, nearly all of it the React renderer. Give the
   rule that separates them, then argue the opposite case.

---

**Next:** [03-data.md](03-data.md) — fetching, inserting and deleting across two
backends, and why posts go through an Action while reviews go through your own
endpoint.
