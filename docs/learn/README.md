# Learn this stack — start here

A path from "I have never used any of these" to "I can build and debug this
confidently on my own."

The other docs in this repo are **reference** material — they assume you already
know what a module or a migration is. This folder is the **course**. Read it in
order.

**Coming from WordPress?** There is a parallel track —
[`../from-wordpress/`](../from-wordpress/README.md) — that maps this same stack
onto post types, ACF, the loop and WooCommerce. Neither is a prerequisite for
the other, so start with whichever framing suits you. For the steps to one
specific task rather than the explanation behind it, there is a cookbook:
[`../how-to/`](../how-to/README.md).

| # | File | What it gives you | Time |
|---|---|---|---|
| 1 | [01-foundations.md](01-foundations.md) | The vocabulary. Headless, SSR, BFF, ORM, migration, DI, soft delete, JWT vs API key. | 1–2 h |
| 2 | [02-infrastructure.md](02-infrastructure.md) | Docker, Postgres, ports, env files, logs, the dev loop, how to recover. | 2–3 h |
| 3 | [03-payload.md](03-payload.md) | Payload from zero. The easiest of the three — start here for a win. | 3–4 h |
| 4 | [04-medusa.md](04-medusa.md) | Medusa. The hardest, and the most valuable. Budget real time. | 6–8 h |
| 5 | [05-astro.md](05-astro.md) | Astro SSR, Actions, endpoints, the BFF role. | 3–4 h |
| 6 | [06-labs.md](06-labs.md) | 10 hands-on exercises, each verified to work. **This is where learning happens.** | 8–12 h |
| 7 | [07-troubleshooting.md](07-troubleshooting.md) | Symptom → cause → fix. Keep it open while you work. | reference |
| 8 | [08-glossary.md](08-glossary.md) | Every term, defined plainly. | reference |
| 9 | [09-to-production.md](09-to-production.md) | What this repo deliberately lacks, and what to do about it. | 2–3 h |
| 10 | [10-databases.md](10-databases.md) | Both schemas opened up: why 5 collections became 21 tables, Medusa's 145, link tables, ID strategies. Explore it live at `/schema`. | 2–3 h |
| 11 | [11-capstone.md](11-capstone.md) | **Build a feature across all three services.** Requirements and acceptance criteria only — no solution. | 4–8 h |
| 12 | [12-operating-it.md](12-operating-it.md) | Uptime, request logs, workflow states, log viewer and backups — and where each signal is blind. Live at `/monitor`. | 2–3 h |

The reference docs — [`../../README.md`](../../README.md),
[`../architecture.md`](../architecture.md), [`../rest-api.md`](../rest-api.md),
[`../requests.http`](../requests.http) — assume the vocabulary this course
teaches. Each chapter links to its counterpart; read them *after* the matching
chapter, not before.

---

## Before anything else: get it running

```bash
npm install && npm run setup
npm run dev
```

Open http://localhost:4321. If the two cards at the top say **reachable**, you are
ready. If not, go straight to [07-troubleshooting.md](07-troubleshooting.md) — do
not start reading theory against a broken environment.

---

## How to actually learn this

Four habits separate people who get fluent from people who stay stuck.

**1. Read the request, not the file.** Code makes sense when you follow one HTTP
request from the browser to Postgres and back. Every guide here is organised that
way. When you open a new file, ask "what request reaches this, and what does it do
next?"

**2. Break it deliberately.** Delete a field from a zod schema and watch the 400.
Comment out a link file and watch the field disappear. Set
`DEMO_FAIL_LINK_STEP=1` and watch a workflow roll back. **You learn a system's
shape from its failure modes**, and this repo is disposable — `npm run db:reset`
puts everything back.

**3. Keep four terminals open.** One for `npm run dev` (the logs), one for `curl`,
one for `psql`, one for editing. Guessing what the database contains is the single
biggest time sink; looking is free.

**4. Prefer curl to the browser while learning.** A page that renders hides which
of six requests failed. `curl` shows you one request, one response, one status
code. Use the browser to check your work, not to debug.

---

## What "expert in this stack" actually means

Not memorising APIs. Concretely, you can:

- [ ] Explain why Payload and Medusa have separate databases, and what breaks if
      you merge them
- [ ] Add a field end to end in **both** backends without looking anything up
- [ ] Write a Medusa module with a service, a link, and a workflow that rolls back
- [ ] Say which of Actions vs REST endpoints fits a given requirement, and why
- [ ] Read a 400/401/403/404/500 and know which of the four layers produced it
- [ ] Debug from logs and `psql` rather than by adding print statements
- [ ] Know what this repo does that you must *not* copy into production (see
      [02-infrastructure.md](02-infrastructure.md#214-what-is-missing-for-production)
      and [09-to-production.md](09-to-production.md))
- [ ] Read a schema you did not design and explain what produced each table
- [ ] Name all five ways to run code in Medusa, and when each is right
- [ ] Complete the [capstone](11-capstone.md) without looking at another
      implementation

Come back to that list after the labs. If any box is unchecked, you know exactly
what to reread.

---

## The one-paragraph summary

Three separate programs. **Payload** stores editorial content and hands you a
REST API generated from a config file. **Medusa** stores commerce data and makes
you build your API out of modules, workflows and route files by hand. **Astro**
renders HTML on the server, calls both over HTTP, and holds the credentials so
the browser never sees them. They share no database and no code — only HTTP.
Everything else is detail.

---

## A note on frustration

Medusa will feel like too much ceremony for the first few hours. Five layers to
return one row is a lot when you have just watched Payload do it with a one-line
config.

Push through to the compensation lab ([06-labs.md](06-labs.md), Lab 6). Watching a
half-finished write undo itself is the moment Medusa's design clicks — and until
it clicks, the ceremony genuinely does look pointless. That reaction is correct
for a blog and wrong for an order that took someone's money.
