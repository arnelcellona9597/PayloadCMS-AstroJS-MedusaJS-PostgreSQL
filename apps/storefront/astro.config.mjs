// @ts-check
import { defineConfig } from 'astro/config'
import node from '@astrojs/node'
import react from '@astrojs/react'

/**
 * Astro 7, configured for on-demand rendering.
 *
 * ── output: 'server' ───────────────────────────────────────────────────────
 * Astro 7 accepts only 'static' (the default) and 'server'. If you have seen
 * `output: 'hybrid'` in a tutorial, that option was removed back in Astro 5 —
 * its behaviour is now what 'static' + an adapter gives you.
 *
 * Why 'server' here: every page in this app reads live data from Payload or
 * Medusa, or writes to them. There is nothing worth pre-rendering, and 'server'
 * is what makes Actions, API routes and secret env vars work at request time.
 *
 * You can still opt a single page out with `export const prerender = true`.
 *
 * ── Why this matters for secrets ───────────────────────────────────────────
 * Because rendering happens on the server, PAYLOAD_API_KEY and
 * MEDUSA_PUBLISHABLE_KEY never reach the browser. That is the architectural
 * benefit of a BFF: the frontend holds credentials the client is never given.
 */
export default defineConfig({
  output: 'server',

  /**
   * React, for exactly ONE island.
   *
   * Adding a UI framework integration costs nothing until a component is
   * actually hydrated — an integration is a compiler capability, not a runtime
   * payload. Pages with no island still ship zero JavaScript, which you can
   * verify: build, serve, and count <script> tags on /posts.
   *
   * See src/components/ReviewFilter.tsx and docs/learn/05-astro.md §5.14.
   */
  integrations: [react()],

  adapter: node({
    // 'standalone' builds a self-contained Node server (node ./dist/server/entry.mjs).
    // Use 'middleware' instead if you want to mount Astro inside Express/Fastify.
    mode: 'standalone',
  }),

  server: {
    port: 4321,
  },

  devToolbar: {
    enabled: false,
  },
})
