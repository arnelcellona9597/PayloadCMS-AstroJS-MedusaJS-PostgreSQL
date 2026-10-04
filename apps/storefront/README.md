# apps/storefront — Astro 7

The frontend, and the only place the two backends meet. Owns no data.

Runs on **http://localhost:4321** (SSR, `@astrojs/node` standalone)

See the root [`README.md`](../../README.md) for the architecture, and
[`docs/architecture.md`](../../docs/architecture.md) §3 for the Astro specifics.

## The point of this app

It implements the **same CRUD twice, two different ways**, so the trade-off is
visible in one codebase:

| | Posts (Payload) | Reviews (Medusa) |
|---|---|---|
| Mechanism | Astro **Actions** | **Your own REST endpoints** |
| Code | `src/actions/index.ts` | `src/pages/api/reviews/` |
| Works without JS | yes — 0 script tags in prod | no — 1 script, for PATCH/DELETE |
| Callable by | this app only | anything that speaks HTTP |

It is also a **BFF**: every page is server-rendered, so `PAYLOAD_API_KEY` and
`MEDUSA_PUBLISHABLE_KEY` never reach the browser. A visitor calling
`/api/reviews` sends no credential at all. That is why no env var here is
prefixed `PUBLIC_`.

## Read these

| File | Why |
|---|---|
| `src/actions/index.ts` | Pattern A, plus the three form-parsing gotchas |
| `src/pages/api/reviews/index.ts` | Pattern B, and what a BFF buys you |
| `src/lib/payload.ts` | The `users API-Key` header, and `depth` |
| `src/lib/medusa.ts` | Typed SDK methods vs `client.fetch` for custom routes |
| `src/lib/medusa-admin.ts` | Why the admin surface needs its own client |
| `src/lib/lexical.ts` | Rendering Payload's rich-text node tree |

## Commands

```bash
npm run dev         # :4321
npm run build       # then: node dist/server/entry.mjs
npm run typecheck   # astro check
```

## Environment

`PAYLOAD_API_KEY` and `MEDUSA_PUBLISHABLE_KEY` are printed by the backends' seed
scripts. `npm run setup` from the repository root writes them here for you.
