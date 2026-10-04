# apps/cms — Payload 3 + Next 16

The CMS. Owns editorial content: `Post`, `Category`, `Media`, `User`.

Runs on **http://localhost:3000** · admin at `/admin` · REST at `/api/*`

See the root [`README.md`](../../README.md) for the architecture, and
[`docs/architecture.md`](../../docs/architecture.md) §2 for how Payload's model
works.

## Why there is a Next.js app here

Payload 3 is **not standalone** — it mounts into a Next.js app's `(payload)`
route group, which holds the admin panel and the REST/GraphQL handlers. You
should not need to touch that directory.

The `(frontend)` group next to it is the part that is "yours". In this project it
holds a single orientation page, because the real frontend is Astro on :4321.

## Read these

| File | Why |
|---|---|
| `src/collections/Posts.ts` | Access control, fields, hooks, drafts, custom endpoint — the whole model in one object |
| `src/payload.config.ts` | Compare its size with `apps/commerce/medusa-config.ts` |
| `src/endpoints/postStats.ts` | The Local API, for the aggregate generated CRUD cannot express |
| `src/collections/Users.ts` | API-key auth — note the mandatory `users ` header prefix |

## Commands

```bash
npm run dev              # :3000
npm run seed             # content + print the storefront's API key
npm run generate:types   # after changing any field
npm run payload -- migrate:create   # only needed with push: false
```

In development the Postgres adapter's `push` mode syncs the schema from the
config automatically — which is why adding a field needs no migration step.
