# 11 · Capstone — reviewer replies

**There is no worked solution in this file, and that is the point.**

Every lab so far told you what to type. This gives you requirements and a way to
check your own work, which is the actual job. Expect it to take a few hours and
to involve rereading chapters 3–5.

Hints are behind `<details>` tags. Open them when you are stuck, not before — the
struggle *is* the exercise.

---

## The feature

A review can receive **one reply from the store**. Think of the merchant
answering a complaint publicly.

It must span all three services, because that is what makes it a capstone:

| Service | Its part |
|---|---|
| **Medusa** | store the reply, link it to the review, create it through a workflow |
| **Payload** | the editorial copy shown around replies (a global) |
| **Astro** | display replies publicly; let an admin write one |

---

## Requirements

### R1 · Medusa: a `Reply` model

- Belongs to the **existing `review` module** — do not create a second module
- Fields: `body` (text), `author_name` (text), and the usual free timestamps
- A review has **at most one** reply
- Linked to a review through Medusa's link mechanism, **not** a `review_id`
  column

<details>
<summary>Hint — where "at most one" is enforced</summary>

Not in the data model. `defineLink` has an `isList` option; think about which
side needs it and which does not. Then think about what happens if two requests
try to reply at the same time, and where you would catch that.

Chapter 4 §4.4 covers `isList`. The uniqueness question has more than one
defensible answer — pick one and be able to say why.
</details>

### R2 · Medusa: a workflow

`createReplyWorkflow`, with compensation, doing:

1. Validate the review exists **and has no reply yet**
2. Insert the reply
3. Link it to the review
4. Emit `review.replied`

If any step fails, nothing must remain.

<details>
<summary>Hint — the shape to copy</summary>

`src/workflows/create-review.ts` is the same shape: a read-only validation step
first, then two writes, then `emitEventStep`. Read
`src/workflows/steps/create-review.ts` for the `StepResponse(output,
compensateInput)` pattern, and remember every compensation needs an
`if (!input) return` guard.
</details>

### R3 · Medusa: API routes

| Route | Auth | Behaviour |
|---|---|---|
| `POST /admin/reviews/:id/reply` | admin | create the reply |
| `DELETE /admin/reviews/:id/reply` | admin | remove it |
| `GET /store/reviews/:id` | publishable key | now includes `reply`, if any |

Validate the body with zod, wired in `src/api/middlewares.ts`.

<details>
<summary>Hint — a trap in the store route</summary>

`/store/reviews/:id` currently uses the module service directly, which cannot see
replies — they are behind a link. You will need Query.

And when you use Query, re-read chapter 4 §4.5 on **holes**: a soft-deleted reply
keeps its link row.
</details>

### R4 · Medusa: a subscriber

On `review.replied`, log that the author would be notified. Same shape as
`src/subscribers/review-created.ts`.

### R5 · Payload: a global

Extend `SiteSettings` (or add a new global) with the copy shown around replies:

- `replyHeading` — e.g. "Response from the store"
- `replyDisclaimer` — optional small print

**Why a global and not hardcoded strings:** this is editorial copy. Someone
non-technical should be able to change it without a deploy.

### R6 · Astro: display

On `/products/[handle]`, show a review's reply beneath it, using the Payload
copy as the heading. If a review has no reply, render nothing extra — no empty
heading.

### R7 · Astro: write

On `/reviews/[id]/edit`, add a form to write or delete the reply. Follow the
page's existing pattern — a form POST to this app's own endpoint, which
translates to Medusa's verb.

<details>
<summary>Hint — which pattern, and why</summary>

Chapter 5 §5.6 has the rule. This is a form on a page you own, so an Action is
the natural fit — but the surrounding page already uses the endpoint pattern, and
consistency inside one page is worth something too. Either is defensible; be able
to argue it.

If you choose an endpoint, remember DELETE needs an `Origin` header from curl.
</details>

### R8 · A test

Extend `src/scripts/test-compensation.ts`, or add a sibling, asserting that a
failing `createReplyWorkflow` leaves no orphan reply **and** no orphan link.

<details>
<summary>Hint — how to make it fail on demand</summary>

`link-review-to-product.ts` reads an env var at execution time, which is what
lets the existing test toggle failure in-process without a restart. Do the same
thing in your link step.
</details>

---

## Acceptance criteria

Work through these in order. Each is a command, so you are not guessing.

### Schema

```bash
docker exec apm-postgres psql -U postgres -d medusa_crud -c '\dt' | grep -i reply
```

- [ ] A `reply` table exists
- [ ] A link table exists joining review and reply
- [ ] `reply` has **no** `review_id` column
  ```bash
  docker exec apm-postgres psql -U postgres -d medusa_crud -c '\d reply' | grep -c review_id   # 0
  ```
- [ ] Your link appears in Medusa's own record
  ```bash
  docker exec apm-postgres psql -U postgres -d medusa_crud \
    -c 'select table_name from link_module_migrations;' | grep -i reply
  ```

### Happy path

- [ ] `POST /admin/reviews/:id/reply` returns `201`
- [ ] `GET /store/reviews/:id` now includes the reply
- [ ] The subscriber logged in the `[commerce]` terminal
- [ ] The reply shows on `/products/[handle]` under the right review
- [ ] The heading comes from Payload — change it in the admin, reload, see it change

### Rules and failures

- [ ] Replying twice to one review is rejected, with a message that says why
- [ ] Replying to a nonexistent review returns `404`, not `500`
- [ ] An empty body returns `400`, not a reply with empty text
- [ ] `POST /admin/reviews/:id/reply` **without** auth returns `401`
- [ ] `GET /store/reviews/:id` **without** the publishable key returns `400`
- [ ] A review with no reply renders no empty heading

### Compensation

- [ ] Your test passes
- [ ] **Break it deliberately** — remove your compensation function — and confirm
      the test fails. A test you have not seen fail proves nothing.
- [ ] Restore it and confirm it passes again

### Regression

- [ ] `npm run typecheck` clean in all three apps
- [ ] `npm run postman:test` still 49/104/0 — you should not have broken existing
      routes
- [ ] `docker exec apm-postgres psql -U postgres -d medusa_crud -c 'select count(*) from review;'`
      is unchanged from before you started

---

## Stretch goals

Only after everything above passes.

1. **Add it to the Postman collection** with assertions, so a run covers replies.
2. **Show replies in the admin widget** (`src/admin/widgets/product-reviews.tsx`)
   so a moderator can reply without leaving Medusa.
3. **A `reply.pending` count on the dashboard** — reviews awaiting a response.
4. **Make the store route batch** — one `query.graph` for a product's reviews
   *and* their replies, avoiding a second N+1.
5. **A scheduled job** flagging reviews unanswered for more than seven days.

---

## How to know you have understood it

Not "does it work" — that is the acceptance criteria's job. These are the
questions someone would ask you about the design:

1. Why does `reply` have no `review_id` column, and what did you get in exchange
   for that inconvenience?
2. You enforced "at most one reply" somewhere. Why there and not in the database?
3. Your workflow has a validation step and two write steps. Why is validation
   first, and which steps needed compensation?
4. If `emitEventStep` were in the route handler instead of the workflow, what
   would break?
5. Why is the reply heading in Payload rather than in the Astro component?
6. Which frontend pattern did you use for the write form, and what would the
   other one have cost?
7. What happens to the link row when a reply is soft-deleted, and how does that
   affect the store route?

If any answer is "I copied the existing one", go back and find out why the
existing one is shaped that way. That is the difference between having finished
the capstone and having learned from it.

---

## Where to look

| Requirement | Read first |
|---|---|
| R1 model, link | [04-medusa.md](04-medusa.md) §4.2, §4.4 · `src/modules/review/` |
| R2 workflow | [04-medusa.md](04-medusa.md) §4.6 · `src/workflows/create-review.ts` |
| R3 routes, zod | [04-medusa.md](04-medusa.md) §4.7, §4.8 · `src/api/middlewares.ts` |
| R4 subscriber | [04-medusa.md](04-medusa.md) · `src/subscribers/review-created.ts` |
| R5 global | [03-payload.md](03-payload.md) · `src/globals/SiteSettings.ts` |
| R6/R7 Astro | [05-astro.md](05-astro.md) §5.4–5.6 |
| R8 test | `src/scripts/test-compensation.ts` |
| Schema questions | [10-databases.md](10-databases.md) |
| When it breaks | [07-troubleshooting.md](07-troubleshooting.md) |

---

**Finished?** Go back to the checklist in
[README.md](README.md#what-expert-in-this-stack-actually-means). If every box is
now honestly ticked, you are done with this repo — build something of your own.
