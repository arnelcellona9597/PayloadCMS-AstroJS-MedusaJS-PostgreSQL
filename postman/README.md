# Postman collection

Full API surface for this stack — Payload, Medusa (store **and** admin), and the
Astro BFF — as an importable Postman collection with assertions and automatic
variable chaining.

**49 requests · 104 assertions · 5 folders.** Verified end to end against the
running stack with 0 failures.

Everything here uses Collection Format **v2.1** and free-tier features only. No
Vault secrets, no Package Library, no mock servers or monitors.

---

## Import

1. Start the stack: `npm run dev`
2. Make sure the environment has current keys:

   ```bash
   npm run postman:env
   ```

3. In Postman: **Import** → **Files** → select **both**:
   - `postman/astro-payload-medusa.postman_collection.json`
   - `postman/local.postman_environment.json`
4. Top-right environment selector → **Local (astro-payload-medusa)**

If you skip step 4 the base URLs still resolve (they're collection variables),
but every authenticated request fails — the keys live in the environment.

---

## Run it

**In the app:** open the collection → **Run** → keep the default order → **Run
Astro + Payload + Medusa**.

**From the terminal:**

```bash
npm run postman:test
```

Expect `49 requests · 104 assertions · 0 failed`.

### Order matters

The folders are numbered because they feed each other:

| Folder | Produces | Consumes |
|---|---|---|
| `00 Auth` | `medusaJwt` | — |
| `01 Payload CMS` | `postId` | `payloadApiKey` |
| `02 Medusa Store` | `productId`, `reviewId` | `medusaPublishableKey` |
| `03 Medusa Admin` | `uptimeTargets` | `medusaJwt`, `reviewId` |
| `04 Astro BFF` | `bffReviewId` | `productId` |

To click a single request in folder 03 or 04, run **00** and **02** first — or
just run the whole collection; it takes about 1.5 seconds.

---

## What it covers

Ten of the 49 requests are **negative cases**, and they are the point. A run
exercises `400`, `401`, `403`, `404` and `422` against four different layers:

| Request | Code | What it demonstrates |
|---|---|---|
| Payload create without key | `403` | Well-formed but not permitted — not 401 |
| Medusa store without publishable key | `400` | Required on custom routes too |
| Medusa create, rating 9 | `400` | zod reports *every* failing field at once |
| Medusa create with `status` | `400` | `.strict()` blocks self-publishing |
| Medusa create, unknown product | `404` | Fails in the workflow's first step |
| Read a pending review publicly | `404` | Not 403 — no information leak |
| Medusa admin without JWT | `401` | The publishable key is not enough |
| Admin update, empty body | `400` | `.refine()` rejects a silent no-op |
| BFF create, bad payload | `422` | Per-field detail, unlike Medusa's single string |
| BFF delete without `Origin` | `403` | Astro's CSRF check |

The positive path also asserts the architecture, not just status codes:

- Anonymous vs keyed post counts differ → **access control filters, it doesn't reject**
- `author_email` and `status` never appear on any public review response
- A review created via the store lands `pending`; approving it via admin makes it
  appear on the store surface in the very next request
- `/store/products/:id/reviews` resolves across the **module link table**
- `?include_pending=true` flips the BFF's `source` from `store` to `admin`

---

## Rate limiting

Every response carries the budget:

```
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 1788096465
```

A full collection run is 49 requests against limits of 120 (Astro) and 240
(Medusa), so it passes with headroom. Running it repeatedly **within the same
minute** can trip the limit — you'll see `429`s and failing assertions. Wait a
minute, or raise `RATE_LIMIT_MAX` in `apps/storefront/.env` and
`RATE_LIMIT_STORE_MAX` in `apps/commerce/.env` (restart the app after either).

## After `npm run db:reset`

The reset regenerates both API keys, so the environment goes stale and everything
starts failing with 401/400. One command fixes it:

```bash
npm run postman:env
```

Then re-import the environment file, or paste the two values into Postman under
**Environments → Local (astro-payload-medusa)**.

---

## Repeated runs leave soft-deleted rows

Each run creates two reviews and deletes them again — but Medusa's delete is a
**soft** delete, and the delete workflow deliberately keeps the link row so a
restore reattaches the review to its product.

So every run leaves behind one soft-deleted review and one orphan link row per
created review. That is correct behaviour, not a leak, and it's exactly the
situation described in
[`../docs/learn/04-medusa.md`](../docs/learn/04-medusa.md) §4.5 — those orphan
links are what make `query.graph` return holes.

It's harmless for a handful of runs. To get back to a clean baseline:

```bash
npm run db:reset && npm run setup && npm run postman:env
```

Or remove just the residue:

```sql
delete from product_product_review_review
 where review_id in (select id from review where deleted_at is not null);
delete from review where deleted_at is not null;
```

---

## Files

| File | Committed | Purpose |
|---|---|---|
| `astro-payload-medusa.postman_collection.json` | ✅ | The collection |
| `local.postman_environment.example.json` | ✅ | Placeholders, safe to share |
| `local.postman_environment.json` | ❌ gitignored | Real keys, generated |
| `../scripts/gen-postman-env.sh` | ✅ | Regenerates the above |

---

## Notes

- **Collection-level auth is deliberately off.** Every request shows its own
  `Authorization` / `x-publishable-api-key` header, so you can see what each
  surface actually requires instead of inheriting it invisibly.
- **The Astro Action request** (`?_action=post.create`) returns `302` with
  *Automatically follow redirects* **off**, and `200` with it on. The test accepts
  either.
- **`{{...}}` bracket params need no escaping** in Postman, unlike `curl`, which
  needs `-g` for Payload's `where[title][contains]` syntax.
- The same requests exist as a `.http` file for VS Code's REST Client:
  [`../docs/requests.http`](../docs/requests.http).
