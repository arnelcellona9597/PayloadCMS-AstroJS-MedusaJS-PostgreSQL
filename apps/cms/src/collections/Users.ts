import type { CollectionConfig } from 'payload'

/**
 * Users — Payload's auth collection.
 *
 * `auth` does a lot of work from one option. It adds the email/password fields,
 * password hashing, and this whole set of REST endpoints:
 *
 *   POST /api/users/login
 *   POST /api/users/logout
 *   POST /api/users/refresh-token
 *   GET  /api/users/me
 *   POST /api/users/forgot-password
 *   POST /api/users/reset-password
 *
 * `useAPIKey: true` additionally puts an "API Key" toggle on each user in the
 * admin panel. That key is how the Astro storefront authenticates as a machine
 * rather than as a browser session — see apps/storefront/src/lib/payload.ts.
 *
 * The header format is exact and easy to get wrong:
 *
 *   Authorization: users API-Key <the-key>
 *                  ^^^^^ the COLLECTION SLUG, then a literal " API-Key "
 *
 * `Bearer <key>` does not work. `API-Key <key>` without the slug does not work.
 */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'name', 'role'],
  },
  auth: {
    useAPIKey: true,
  },
  access: {
    // Anyone logged in can read the user list; only admins can manage users.
    read: ({ req }) => Boolean(req.user),
    create: ({ req }) => req.user?.role === 'admin',
    update: ({ req }) => req.user?.role === 'admin',
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    // `email` and `password` are injected by `auth` — do not declare them here.
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: 'Admin', value: 'admin' },
        { label: 'Editor', value: 'editor' },
      ],
      admin: {
        description: 'Admins can delete posts and manage users. Editors cannot.',
      },
    },
  ],
}
