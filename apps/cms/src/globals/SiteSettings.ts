import type { GlobalConfig } from 'payload'

/**
 * A GLOBAL — one record, not a collection.
 *
 * Use a global when there is exactly one of the thing: site settings, the
 * footer, a navigation menu, a maintenance banner. Modelling those as a
 * collection is a common mistake and leaves you defending against "what if
 * there are two?" forever.
 *
 * ── How it differs from a collection ──────────────────────────────────────
 *
 *   Collection                        Global
 *   ─────────────────────────         ─────────────────────────
 *   many documents                    exactly one
 *   /api/posts, /api/posts/:id        /api/globals/site-settings
 *   GET / POST / PATCH / DELETE       GET / POST only  (nothing to create
 *                                     or delete — it always exists)
 *   payload.find / findByID           payload.findGlobal
 *   list + edit screens               a single edit screen
 *
 * It gets its own table (`site_settings`) with exactly one row, created on
 * first read. There is no "empty" state to handle — Payload returns defaults.
 */
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'Site settings',

  access: {
    // Public: the storefront renders these on every page.
    read: () => true,
    update: ({ req }) => Boolean(req.user),
  },

  admin: {
    description: 'One record. Edited here, read by the Astro storefront on every request.',
  },

  fields: [
    {
      name: 'siteName',
      type: 'text',
      required: true,
      defaultValue: 'Astro · Payload · Medusa',
    },
    {
      name: 'tagline',
      type: 'text',
      defaultValue: 'A teaching stack you can read.',
    },
    {
      name: 'announcement',
      type: 'group',
      admin: { description: 'A banner across the storefront. Leave disabled to hide it.' },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: false },
        { name: 'message', type: 'text' },
        {
          name: 'tone',
          type: 'select',
          defaultValue: 'info',
          options: [
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warning' },
          ],
        },
      ],
    },
    {
      name: 'socialLinks',
      type: 'array',
      labels: { singular: 'Link', plural: 'Links' },
      // Like any array field, this becomes its own table —
      // `site_settings_social_links`. See docs/learn/10-databases.md §10.2.
      fields: [
        { name: 'label', type: 'text', required: true },
        { name: 'url', type: 'text', required: true },
      ],
    },
  ],
}
