/**
 * The content the CMS is seeded with: a developer knowledge base for this stack.
 *
 * Kept separate from seed.ts so that file stays readable as the *mechanism* —
 * find-or-create, API keys, media uploads — while this directory is purely
 * *data*. One module per category, because a single file holding 88 guides is
 * about 3,000 lines and nobody finds anything in it.
 *
 * See ./types.ts for the body format, the honesty labels, and the two
 * constraints that bite (slug collisions and the 300-character excerpt).
 */
import type { DatedGuide, Guide } from './types'

import { installationAndSetup } from './installation-and-setup'
import { gettingStarted } from './getting-started'
import { keyFiles } from './key-files'
import { contentModelling } from './content-modelling'
import { frontend } from './frontend'
import { commerce } from './commerce'
import { dataAndApis } from './data-and-apis'
import { operations } from './operations'
import { deployment } from './deployment'
import { security } from './security'
import { performance } from './performance'
import { testing } from './testing'

export type { Guide, DatedGuide } from './types'

/**
 * Twelve categories, listed in the same order as the curriculum below — the
 * storefront renders its filter chips straight from this array, so the order
 * here is what a reader sees. check-guides.ts asserts the two agree.
 *
 * Originally ten. These map onto how someone actually looks for an answer: by
 * the part of the stack they are stuck in.
 *
 * ⚠️ Every name here needs a colour in `ACCENTS` in ../placeholders.ts. An
 * unmapped category still works — it falls back to grey — but its cover images
 * lose the colour coding that makes the archive scannable.
 */
export const categorySeeds = [
  {
    name: 'Installation & Setup',
    description: 'Prerequisites, the setup script, ports, containers and what to do when it fails.',
  },
  {
    name: 'Getting Started',
    description: 'Orientation, project structure, and the commands you will type every day.',
  },
  {
    name: 'Key Files & Folders',
    description:
      'The map: which files matter in each app, what every env var does, what is generated.',
  },
  {
    name: 'Content Modelling',
    description: 'Payload collections, fields, blocks, globals and relationships.',
  },
  {
    name: 'Frontend',
    description: 'Astro routing, pages, layouts, components and islands.',
  },
  {
    name: 'Data & APIs',
    description: 'Reading, writing and deleting across two backends over HTTP.',
  },
  {
    name: 'Commerce',
    description: 'Medusa products, payments, inventory and multi-store.',
  },
  {
    name: 'Operations & Tooling',
    description: 'Databases, backups, monitoring, editors and the things that keep it running.',
  },
  {
    name: 'Testing & Quality',
    description: 'Unit, integration and end-to-end tests, fixtures, and gates that actually gate.',
  },
  {
    name: 'Performance',
    description: 'Query cost, indexes, pooling, caching layers and measuring before optimising.',
  },
  {
    name: 'Security',
    description: 'Authentication, secrets, CORS, injection, rate limiting and headers.',
  },
  {
    name: 'Deployment & Infrastructure',
    description: 'Server sizing, hardening, TLS, process supervision and shipping a change.',
  },
] as const

/** Base date; each guide is offset by an hour so ordering is stable. */
const DAY = '2026-09-15'

const at = (hoursFromStart: number) => {
  const base = new Date(`${DAY}T08:00:00.000Z`).getTime()
  return new Date(base + hoursFromStart * 3_600_000).toISOString()
}

/**
 * This array IS the curriculum. Position here becomes `order` on every post,
 * and the storefront's archive sorts on it ascending — so guide 1 is the first
 * thing a newcomer sees and the last assumes everything before it.
 *
 * It previously ran the other way. Position became `publishedAt`, the archive
 * sorted `-publishedAt`, and the effect was an archive that opened on server
 * hardening and buried "what to install" eighty guides down. That is a fine
 * ordering for a news feed and a terrible one for teaching.
 *
 * The progression: install it, understand its shape, learn the map, then model
 * content, render it, wire the services together, sell something, operate it,
 * test it, make it fast, make it safe, and ship it.
 */
const ordered: Guide[] = [
  ...installationAndSetup,
  ...gettingStarted,
  ...keyFiles,
  ...contentModelling,
  ...frontend,
  ...dataAndApis,
  ...commerce,
  ...operations,
  ...testing,
  ...performance,
  ...security,
  ...deployment,
]

/**
 * Stamp each guide with its curriculum position and a date, both derived from
 * array index so neither can drift from the list above.
 *
 * `order` is 1-based because it is shown to readers as "step 7 of 103", and a
 * step 0 reads badly. `publishedAt` stays in the same direction, so the
 * secondary "newest first" view is a coherent reverse of the path rather than
 * an arbitrary shuffle.
 *
 * Hand-numbering either of these was the previous approach. It worked at 32
 * guides and became a liability at 88: one duplicate silently collapses two
 * guides onto the same key and makes the sort arbitrary between them.
 */
export const guideSeeds: DatedGuide[] = ordered.map((guide, i) => ({
  ...guide,
  order: i + 1,
  publishedAt: at(i),
}))

/** How many guides there are, for anything that wants to say "of 103". */
export const guideCount = guideSeeds.length
