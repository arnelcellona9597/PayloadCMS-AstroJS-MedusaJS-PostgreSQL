import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'
import sharp from 'sharp'

import { Users } from './collections/Users'
import { Media } from './collections/Media'
import { Categories } from './collections/Categories'
import { Posts } from './collections/Posts'
import { Pages } from './collections/Pages'
import { SiteSettings } from './globals/SiteSettings'
import { schemaEndpoint } from './endpoints/schema'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

/**
 * THE config. In Payload this single object is the application: it defines the
 * database schema, the REST + GraphQL APIs, the admin UI, the access rules and
 * the generated TypeScript types. There is no separate schema file, no route
 * layer and (in development) no migration step.
 *
 * Read this alongside apps/commerce/medusa-config.ts, which does almost nothing
 * by comparison — because in Medusa the behaviour lives in modules, workflows
 * and route files instead.
 */
export default buildConfig({
  admin: {
    // Which collection authenticates into /admin.
    user: Users.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
    meta: {
      titleSuffix: '· Payload CMS',
    },
  },

  // Adding a collection here is the whole cost of a new REST resource.
  collections: [Users, Media, Categories, Posts, Pages],

  /**
   * Root-level endpoints, mounted at /api/<path>.
   *
   * Collection endpoints (like Posts' /stats) hang off one collection's URL.
   * These do not belong to any collection — /api/schema describes the whole
   * database — so they are declared here instead.
   */
  endpoints: [schemaEndpoint],

  /**
   * Globals: exactly one record each, no list view, no create or delete.
   * Reachable at /api/globals/<slug>.
   */
  globals: [SiteSettings],

  editor: lexicalEditor(),

  /**
   * Used to sign JWTs and hash API keys. Payload refuses to start without it
   * ("missing secret key"), and changing it invalidates every existing session
   * and API key.
   */
  secret: process.env.PAYLOAD_SECRET || '',

  /**
   * Origins allowed to call /api/** from a browser.
   *
   * The Astro storefront does not actually need this — every page is
   * server-rendered, so those fetches are server-to-server and CORS never
   * applies. It is here for the case where you add a browser-side island later,
   * and to make the point explicit: if your frontend renders on the server, CORS
   * is not part of your problem.
   */
  cors: (process.env.PAYLOAD_CORS_ORIGINS ?? 'http://localhost:4321').split(','),
  csrf: (process.env.PAYLOAD_CORS_ORIGINS ?? 'http://localhost:4321').split(','),

  serverURL: process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000',

  typescript: {
    // Regenerate with `npm run generate:types` after changing any field.
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },

  db: postgresAdapter({
    pool: {
      connectionString: process.env.DATABASE_URL || '',
    },
    /**
     * `push` (the default in dev) diffs the config against the live database and
     * applies the change automatically — that is why adding a field here needs
     * no migration command.
     *
     * For production you set `push: false` and use:
     *   npm run payload migrate:create
     *   npm run payload migrate
     */
  }),

  sharp,
  plugins: [],
})
