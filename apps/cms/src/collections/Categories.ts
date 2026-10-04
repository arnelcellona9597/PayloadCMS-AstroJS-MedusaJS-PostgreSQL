import type { CollectionConfig } from 'payload'

import { slugFrom } from '../hooks/slugify'

/**
 * Categories — the simplest possible collection, kept small on purpose so the
 * "one config object → full CRUD API + admin UI" claim is easy to verify.
 *
 * Creating this file and adding it to `collections` in payload.config.ts is the
 * ENTIRE cost of getting:
 *
 *   GET    /api/categories          list, with where/sort/limit/page
 *   POST   /api/categories          create
 *   GET    /api/categories/:id      read one
 *   PATCH  /api/categories/:id      update
 *   DELETE /api/categories/:id      delete
 *   GET    /api/categories/count    count
 *   + a GraphQL schema and a full admin CRUD screen
 *
 * Compare that with apps/commerce/src/api/** , where every one of those verbs is
 * a file you write by hand.
 */
export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'slug', 'updatedAt'],
  },
  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => req.user?.role === 'admin',
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        description: 'Left blank, this is derived from the name.',
      },
      hooks: {
        beforeValidate: [slugFrom('name')],
      },
    },
    {
      name: 'description',
      type: 'textarea',
    },
  ],
}
