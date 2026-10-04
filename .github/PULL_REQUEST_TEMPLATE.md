## What this changes

<!-- One or two sentences. What is different after this merges, and why. -->

## Why

<!-- The problem or request behind it. Link an issue if there is one. -->

## Branch target

<!-- Tick one. Work enters at the bottom and is promoted upwards. -->

- [ ] `feature/*` → `development` — new capability
- [ ] `bugfix/*` → `development` — a defect
- [ ] `update/*` → `development` — dependencies, content, documentation
- [ ] `development` → `main` — promotion to live, staging is green

## Which services are touched

- [ ] `apps/cms` — Payload (port 3000, owns `payload_crud`)
- [ ] `apps/commerce` — Medusa (port 9000, owns `medusa_crud`)
- [ ] `apps/storefront` — Astro (port 4321, owns no data)
- [ ] `infra` / `scripts` — Docker, setup, backups
- [ ] `docs` — one or more of the three tracks

## Checks

Run all three. Paste the numbers rather than ticking from memory.

```bash
npm run typecheck && npm test && npm run postman:test
```

- [ ] `npm run typecheck` — 0 errors across all three apps
- [ ] `npm test` — 20 unit tests plus the compensation test
- [ ] `npm run postman:test` — 49 requests / 104 assertions / 0 failures

⚠️ Leave 60 seconds between newman runs. Three inside a minute exhaust the
storefront's 120-per-60s limiter and produce failures that are not real.

## If this touches the schema

- [ ] Payload: ran `npm --prefix apps/cms run generate:types`
- [ ] Medusa: ran `db:generate` **and** `db:migrate`, and committed the migration
- [ ] Restarted the affected service — config changes are not hot-reloaded

## If this touches seed data

Several documentation chapters quote real row counts and real command output.

- [ ] Re-ran the seed and confirmed the app still renders
- [ ] Re-checked any documentation that quotes counts, slugs, handles or IDs
- [ ] Took a backup: `npm run db:export`

## Risk

<!-- What could break, and how would you notice? Say "none" if none. -->

## Screenshots

<!-- For UI changes. Delete this section otherwise. -->
