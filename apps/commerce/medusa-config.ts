import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

/**
 * Compare the size of this file with apps/cms/src/payload.config.ts.
 *
 * Payload's config IS the application — schema, API, admin UI and access rules
 * all come out of that one object. Medusa's config barely does anything: it
 * points at a database, sets CORS and secrets, and lists which modules to load.
 *
 * The behaviour lives elsewhere, discovered by CONVENTION from the filesystem:
 *
 *   src/modules/      data models + services   (business logic)
 *   src/links/        associations between modules
 *   src/workflows/    orchestration + rollback
 *   src/api/          HTTP routes  (file path = URL path)
 *   src/admin/        React injected into the admin dashboard
 *   src/subscribers/  event handlers
 *   src/jobs/         scheduled tasks
 *
 * Neither approach is better. They optimise for different rates of change.
 */
module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,

    /**
     * This is the SESSION store, and it is a completely different setting from
     * the `redisUrl` inside each module's options below.
     *
     * Without it Medusa logs, on every boot:
     *
     *   info: redisUrl not found. A fake redis instance will be used.
     *
     * That line is easy to misread as "Redis is not working". It is not about
     * the cache, event bus, locking or workflow modules at all — those connect
     * independently and announce themselves separately. It comes from
     * normalizeProjectConfig() checking THIS field, and it governs where admin
     * sessions live.
     *
     * In-memory sessions are the fourth thing that quietly prevents running two
     * instances: each holds its own session map, so an admin logged in on
     * instance A is anonymous on instance B, and every restart logs everyone out.
     */
    redisUrl: process.env.REDIS_URL,

    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || 'supersecret',
      cookieSecret: process.env.COOKIE_SECRET || 'supersecret',
    },
  },

  /**
   * Custom modules are registered here by path. Medusa's own modules (product,
   * cart, order, pricing, …) are loaded implicitly — you only list the ones you
   * wrote, or ones whose configuration you want to override.
   *
   * After changing a data model inside a registered module:
   *   npm run db:generate     (writes a migration into the module folder)
   *   npm run db:migrate      (applies it, and syncs link tables)
   */
  modules: [
    /**
     * ── Redis-backed infrastructure ──────────────────────────────────────
     *
     * Without these, Medusa runs three subsystems in-process and says so on
     * every boot. Each in-memory fallback is fine for one process and wrong for
     * two:
     *
     *   cache           per-process, so instances disagree
     *   event bus       each instance sees only the events it produced
     *   locking         a scheduled job runs once PER INSTANCE
     *   workflow engine executions are not persisted AT ALL
     *
     * That last one is why `workflow_execution` sits empty on a fresh install
     * even after workflows have run and failed — and therefore why there is no
     * "pending" or "failed" workflow to monitor until Redis is in place.
     *
     * ⚠️ Two things that each cost a boot failure to discover:
     *
     * 1. These are SEPARATE PACKAGES, not subpaths of @medusajs/medusa. The
     *    resolve string is `@medusajs/cache-redis`, not
     *    `@medusajs/medusa/cache-redis` — the latter does not exist.
     *
     * 2. Each needs an explicit `key`. Infrastructure modules REPLACE a
     *    built-in, so Medusa has to know which one. Omit it and you get:
     *
     *      Module @medusajs/cache-redis doesn't have a serviceName.
     *      Please provide a 'key' for the module
     *
     *    …which does not obviously mean "add key". The keys come from the
     *    `Modules` enum: cache, event_bus, workflows, locking.
     */
    {
      key: Modules.CACHE,
      resolve: '@medusajs/cache-redis',
      options: { redisUrl: process.env.REDIS_URL },
    },
    {
      key: Modules.EVENT_BUS,
      resolve: '@medusajs/event-bus-redis',
      options: { redisUrl: process.env.REDIS_URL },
    },
    {
      // The module that makes workflow_execution populate — the whole basis of
      // workflow monitoring.
      //
      /**
       * ⚠️ This option shape looks wrong and is correct. On boot you will see:
       *
       *   warn: [Workflow-engine-redis] The `url` option is deprecated.
       *         Please use `redisUrl` instead for consistency with other modules.
       *
       * **Do not follow that advice on 2.19.** The loader still destructures
       * `options.redis.url`, so passing only `redisUrl` crashes the server:
       *
       *   Loaders for module Workflows failed: Cannot destructure property
       *   'url' of '(intermediate value)' as it is undefined.
       *
       * The deprecation landed before the code that honours it. Keep
       * `redis: { url }` and ignore the warning until a later release.
       */
      key: Modules.WORKFLOW_ENGINE,
      resolve: '@medusajs/workflow-engine-redis',
      options: { redis: { url: process.env.REDIS_URL } },
    },
    {
      /**
       * Locking is the odd one out: it is a MODULE WITH PROVIDERS, not a module
       * you swap wholesale.
       *
       * Resolving '@medusajs/locking-redis' directly fails with
       *   "No service found in module Locking. Make sure your module exports a
       *    service."
       * because that package exports a *provider* (RedisLockingProvider), not a
       * module service. The host is '@medusajs/locking', and the Redis package
       * goes in its `providers` array.
       *
       * Same pattern as payment and fulfillment providers — worth recognising,
       * because the error message points at the wrong thing.
       */
      key: Modules.LOCKING,
      resolve: '@medusajs/locking',
      options: {
        providers: [
          {
            resolve: '@medusajs/locking-redis',
            id: 'locking-redis',
            is_default: true,
            options: { redisUrl: process.env.REDIS_URL },
          },
        ],
      },
    },

    // ── Custom modules ───────────────────────────────────────────────────
    {
      resolve: './src/modules/review',
    },
    {
      // Uptime history. Deliberately its own module rather than a table in the
      // review module — it shares no domain with reviews and has no link to it.
      resolve: './src/modules/ops',
    },
  ],
})
