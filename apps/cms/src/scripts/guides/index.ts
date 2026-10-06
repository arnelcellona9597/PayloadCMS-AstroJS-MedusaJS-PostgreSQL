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

import { gettingStarted } from './getting-started'
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
 * Ten categories. These map onto how someone actually looks for an answer: by
 * the part of the stack they are stuck in.
 *
 * ⚠️ Every name here needs a colour in `ACCENTS` in ../placeholders.ts. An
 * unmapped category still works — it falls back to grey — but its cover images
 * lose the colour coding that makes the archive scannable.
 */
export const categorySeeds = [
  {
    name: 'Getting Started',
    description: 'Orientation, project structure, and the commands you will type every day.',
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
    name: 'Commerce',
    description: 'Medusa products, payments, inventory and multi-store.',
  },
  {
    name: 'Data & APIs',
    description: 'Reading, writing and deleting across two backends over HTTP.',
  },
  {
    name: 'Operations & Tooling',
    description: 'Databases, backups, monitoring, editors and the things that keep it running.',
  },
  {
    name: 'Deployment & Infrastructure',
    description: 'Server sizing, hardening, TLS, process supervision and shipping a change.',
  },
  {
    name: 'Security',
    description: 'Authentication, secrets, CORS, injection, rate limiting and headers.',
  },
  {
    name: 'Performance',
    description: 'Query cost, indexes, pooling, caching layers and measuring before optimising.',
  },
  {
    name: 'Testing & Quality',
    description: 'Unit, integration and end-to-end tests, fixtures, and gates that actually gate.',
  },
] as const

/** Base date; each guide is offset by an hour so ordering is stable. */
const DAY = '2026-09-15'

const at = (hoursFromStart: number) => {
  const base = new Date(`${DAY}T08:00:00.000Z`).getTime()
  return new Date(base + hoursFromStart * 3_600_000).toISOString()
}

/**
 * Order matters: it becomes `publishedAt`, and the storefront sorts on it.
 *
 * The foundational categories come first so that the newest-first archive opens
 * on the specialised material — deployment, security, performance — with the
 * orientation guides further back where someone browsing already knows to look.
 */
const ordered: Guide[] = [
  ...gettingStarted,
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
 * Stamp each guide with a date derived from its position.
 *
 * Hand-numbered offsets worked at 32 guides and became a liability at 88: one
 * duplicate silently collapses two guides onto the same timestamp and makes
 * `sort: '-publishedAt'` arbitrary between them. Deriving it from the index
 * means the ordering above *is* the ordering, and cannot drift from it.
 */
export const guideSeeds: DatedGuide[] = ordered.map((guide, i) => ({
  ...guide,
  publishedAt: at(i),
}))
