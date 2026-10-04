/**
 * The product catalogue: developer tooling and infrastructure.
 *
 * Kept separate from seed.ts so that file stays readable as the *mechanism* —
 * regions, sales channels, shipping profiles, inventory — while this one is
 * purely *data*.
 *
 * ── Three things that will silently break a product ───────────────────────
 *
 * 1. **`sales_channels` is mandatory in practice.** The storefront's publishable
 *    key is scoped to a sales channel, so a product not assigned to one is
 *    invisible to `/store/products` — it returns an empty list rather than an
 *    error, which is a miserable thing to debug. seed.ts attaches the default
 *    channel to every product in this file.
 *
 * 2. **`shipping_profile_id` is required** by `createProductsWorkflow` in v2.
 *    seed.ts attaches it.
 *
 * 3. **Prices are in MAJOR UNITS, not cents.** `amount: 49` is €49.00, not
 *    49 cents. This is the opposite of Stripe's convention and of Medusa v1.
 *
 * Only `eur` and `usd` resolve — those are the store's supported currencies
 * (seed.ts). A third currency would be stored and then never selectable.
 *
 * ── Why most variants set manage_inventory: false ─────────────────────────
 *
 * These are subscriptions and licences, not boxes on a shelf. With inventory
 * management off, Medusa creates no inventory item for the variant, so the
 * inventory-levels block at the end of seed.ts loops over a shorter list. The
 * two physical products keep it on, so the inventory machinery still has
 * something real to manage.
 */

export type CatalogueVariant = {
  title: string
  sku: string
  /** EUR; the USD price is derived in seed.ts at a flat 1.2×, rounded. */
  eur: number
  /** Physical goods only. Defaults to false — these are mostly licences. */
  stocked?: boolean
}

export type CatalogueProduct = {
  title: string
  handle: string
  category: string
  description: string
  /** Rendered into `options` as a single option group. */
  optionTitle: string
  variants: CatalogueVariant[]
  /** Physical products need a shipping weight; digital ones do not. */
  weight?: number
}

export const productCategorySeeds = [
  'Hosting & VPS',
  'Managed Databases',
  'Edge & CDN',
  'Security',
  'Observability',
  'Plugins & Extensions',
] as const

export const catalogueSeeds: CatalogueProduct[] = [
  // ── Hosting & VPS ─────────────────────────────────────────────────────────
  {
    title: 'Ignition VPS',
    handle: 'ignition-vps',
    category: 'Hosting & VPS',
    description:
      'NVMe-backed virtual servers in eight regions, provisioned in under sixty seconds. Root access, no noisy neighbours, and a 1 Gbit uplink on every plan. Snapshots are included and hourly billing means a staging box costs pennies.',
    optionTitle: 'Plan',
    variants: [
      { title: '2 vCPU · 4 GB', sku: 'VPS-S', eur: 12 },
      { title: '4 vCPU · 8 GB', sku: 'VPS-M', eur: 29 },
      { title: '8 vCPU · 16 GB', sku: 'VPS-L', eur: 59 },
      { title: '16 vCPU · 32 GB', sku: 'VPS-XL', eur: 119 },
    ],
  },
  {
    title: 'Managed Node Runtime',
    handle: 'managed-node-runtime',
    category: 'Hosting & VPS',
    description:
      'Deploy an Astro, Payload or Medusa service from a Git push and let somebody else own the process manager. Zero-downtime releases, automatic restarts, build caching and per-service environment variables.',
    optionTitle: 'Plan',
    variants: [
      { title: 'Hobby · 1 service', sku: 'NODE-HOBBY', eur: 9 },
      { title: 'Team · 10 services', sku: 'NODE-TEAM', eur: 49 },
      { title: 'Business · unlimited', sku: 'NODE-BIZ', eur: 149 },
    ],
  },
  {
    title: 'Dedicated Edge Server',
    handle: 'dedicated-edge-server',
    category: 'Hosting & VPS',
    description:
      'Single-tenant bare metal for workloads that cannot share a hypervisor. AMD EPYC, ECC memory, redundant power and a four-hour hardware replacement SLA. Shipped racked and provisioned.',
    optionTitle: 'Configuration',
    weight: 14000,
    variants: [
      { title: '16 core · 64 GB', sku: 'METAL-16', eur: 219, stocked: true },
      { title: '32 core · 128 GB', sku: 'METAL-32', eur: 389, stocked: true },
    ],
  },

  // ── Managed Databases ─────────────────────────────────────────────────────
  {
    title: 'Managed PostgreSQL',
    handle: 'managed-postgresql',
    category: 'Managed Databases',
    description:
      'Postgres 17 with automated minor upgrades, point-in-time recovery to any second in the retention window, and connection pooling built in. Both databases in this stack fit comfortably on the Production tier.',
    optionTitle: 'Tier',
    variants: [
      { title: 'Developer · 1 GB', sku: 'PG-DEV', eur: 19 },
      { title: 'Production · 16 GB', sku: 'PG-PROD', eur: 79 },
      { title: 'High Availability · 64 GB', sku: 'PG-HA', eur: 199 },
    ],
  },
  {
    title: 'Redis Cache Cluster',
    handle: 'redis-cache-cluster',
    category: 'Managed Databases',
    description:
      'Managed Redis for the four things Medusa needs it for: the cache, the event bus, distributed locking and workflow persistence. Without it you cannot run more than one Medusa instance, and workflow executions are never recorded.',
    optionTitle: 'Memory',
    variants: [
      { title: '256 MB', sku: 'REDIS-256', eur: 11 },
      { title: '1 GB', sku: 'REDIS-1G', eur: 34 },
      { title: '4 GB · replicated', sku: 'REDIS-4G', eur: 89 },
    ],
  },
  {
    title: 'Offsite Backup Vault',
    handle: 'offsite-backup-vault',
    category: 'Managed Databases',
    description:
      'Encrypted, versioned database and file backups in a separate region from your primary. Restores are tested automatically on a schedule and you get a report — because a backup nobody has restored is a hypothesis, not a backup.',
    optionTitle: 'Retention',
    variants: [
      { title: '7 days', sku: 'BACKUP-7', eur: 8 },
      { title: '30 days', sku: 'BACKUP-30', eur: 24 },
      { title: '365 days', sku: 'BACKUP-365', eur: 69 },
    ],
  },

  // ── Edge & CDN ────────────────────────────────────────────────────────────
  {
    title: 'Global CDN',
    handle: 'global-cdn',
    category: 'Edge & CDN',
    description:
      'Three hundred edge locations, HTTP/3, Brotli, and cache rules you can express per route. The answer to "where is the caching plugin" in a stack that has none: caching here is infrastructure, not an installable.',
    optionTitle: 'Plan',
    variants: [
      { title: 'Starter · 1 TB', sku: 'CDN-START', eur: 15 },
      { title: 'Business · 10 TB', sku: 'CDN-BIZ', eur: 89 },
      { title: 'Enterprise · 100 TB', sku: 'CDN-ENT', eur: 450 },
    ],
  },
  {
    title: 'Image Optimisation Pipeline',
    handle: 'image-optimisation-pipeline',
    category: 'Edge & CDN',
    description:
      'On-the-fly resizing, AVIF and WebP negotiation and smart cropping at the edge. Point it at your Payload media directory and stop generating derivative sizes at upload time.',
    optionTitle: 'Volume',
    variants: [
      { title: '50k transforms', sku: 'IMG-50K', eur: 12 },
      { title: '500k transforms', sku: 'IMG-500K', eur: 59 },
    ],
  },

  // ── Security ──────────────────────────────────────────────────────────────
  {
    title: 'Web Application Firewall',
    handle: 'web-application-firewall',
    category: 'Security',
    description:
      'Managed rulesets, bot scoring and per-route rate limiting at the edge — the layer that catches what an in-process limiter cannot, because it runs before your application does. The Wordfence role, moved off the origin.',
    optionTitle: 'Plan',
    variants: [
      { title: 'Standard', sku: 'WAF-STD', eur: 29 },
      { title: 'Advanced · custom rules', sku: 'WAF-ADV', eur: 99 },
      { title: 'Managed · 24/7 response', sku: 'WAF-MGD', eur: 349 },
    ],
  },
  {
    title: 'Certificate & Secrets Automation',
    handle: 'certificate-secrets-automation',
    category: 'Security',
    description:
      'Automatic TLS issuance and renewal plus a managed secrets store with per-environment scoping and audit logs. Replaces the three .env files full of development placeholders that every project starts with.',
    optionTitle: 'Plan',
    variants: [
      { title: 'Team · 25 secrets', sku: 'SEC-TEAM', eur: 19 },
      { title: 'Business · unlimited', sku: 'SEC-BIZ', eur: 79 },
    ],
  },

  // ── Observability ─────────────────────────────────────────────────────────
  {
    title: 'Uptime & Synthetic Monitoring',
    handle: 'uptime-synthetic-monitoring',
    category: 'Observability',
    description:
      'Checks from twelve regions at up to ten-second resolution, with scripted journeys that exercise a real checkout rather than pinging a health endpoint. Alerting by the route that will actually wake someone.',
    optionTitle: 'Plan',
    variants: [
      { title: '10 monitors · 60s', sku: 'UPTIME-10', eur: 14 },
      { title: '50 monitors · 10s', sku: 'UPTIME-50', eur: 59 },
    ],
  },
  {
    title: 'Application Performance Monitoring',
    handle: 'application-performance-monitoring',
    category: 'Observability',
    description:
      'Distributed tracing across all three services, so one request id follows a page render from Astro into Payload and Medusa and back. The thing you need the moment three services stop being reasonable to debug by hand.',
    optionTitle: 'Retention',
    variants: [
      { title: '7 day traces', sku: 'APM-7', eur: 39 },
      { title: '30 day traces', sku: 'APM-30', eur: 119 },
      { title: '90 day traces', sku: 'APM-90', eur: 299 },
    ],
  },

  // ── Plugins & Extensions ──────────────────────────────────────────────────
  {
    title: 'Payload SEO Suite',
    handle: 'payload-seo-suite',
    category: 'Plugins & Extensions',
    description:
      'Structured data, Open Graph previews, sitemap generation and redirect management as one Payload plugin. Covers the ground Yoast covers in WordPress, in a stack where nothing injects into your head tag for you.',
    optionTitle: 'Licence',
    variants: [
      { title: 'Single project', sku: 'PL-SEO-1', eur: 79 },
      { title: 'Agency · 10 projects', sku: 'PL-SEO-10', eur: 249 },
      { title: 'Unlimited · 1 year', sku: 'PL-SEO-UNL', eur: 599 },
    ],
  },
  {
    title: 'Medusa Subscriptions Module',
    handle: 'medusa-subscriptions-module',
    category: 'Plugins & Extensions',
    description:
      'Recurring billing as a proper Medusa module: subscription plans, proration, dunning and cancellation flows, all built on workflows so a failed renewal rolls back cleanly instead of leaving a half-charged order.',
    optionTitle: 'Licence',
    variants: [
      { title: 'Single store', sku: 'MD-SUBS-1', eur: 149 },
      { title: 'Multi-store · 5', sku: 'MD-SUBS-5', eur: 449 },
    ],
  },
  {
    title: 'Astro Commerce Toolkit',
    handle: 'astro-commerce-toolkit',
    category: 'Plugins & Extensions',
    description:
      'Typed Medusa client, cart and checkout islands, and server-rendered product components for Astro. Ships the one piece this storefront deliberately leaves out: a working cart and checkout flow.',
    optionTitle: 'Licence',
    variants: [
      { title: 'Developer', sku: 'AS-COM-DEV', eur: 59 },
      { title: 'Team · 5 seats', sku: 'AS-COM-TEAM', eur: 199 },
    ],
  },
]

/** USD is derived rather than hand-maintained, so the two never drift apart. */
export const usdFromEur = (eur: number): number => Math.round(eur * 1.2)
