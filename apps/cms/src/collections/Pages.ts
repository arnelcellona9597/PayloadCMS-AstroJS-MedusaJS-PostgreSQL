import type { CollectionConfig } from 'payload'

import { slugFrom } from '../hooks/slugify'

/**
 * Pages — built from BLOCKS.
 *
 * `blocks` is the field type people choose Payload for, and it is the one that
 * most changes how a CMS feels to use. Instead of a fixed set of fields, an
 * editor assembles a page from a menu of typed sections, in any order, any
 * number of times.
 *
 * ── Why it matters ────────────────────────────────────────────────────────
 *
 * A `richText` field gives an editor freedom and gives you unstructured HTML.
 * Blocks give the editor freedom *within a contract*: each block has known
 * fields, so the frontend can render it as a real component rather than
 * guessing. You keep design control; they keep layout control.
 *
 * ── What it costs, on disk ────────────────────────────────────────────────
 *
 * Each block type gets **its own table**, named `pages_blocks_<slug>`, plus
 * ordering columns to reconstruct the sequence. Three block types here means
 * three tables — and with drafts enabled it would be six. Check for yourself
 * after this collection is registered:
 *
 *   docker exec apm-postgres psql -U postgres -d payload_crud -c '\dt' | grep pages
 *
 * See docs/learn/10-databases.md §10.2 for why arrays and blocks explode the
 * table count.
 */
export const Pages: CollectionConfig = {
  slug: 'pages',

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'updatedAt'],
    description: 'Assembled from blocks. Rendered by the Astro storefront at /pages/<slug>.',
  },

  access: {
    read: () => true,
    create: ({ req }) => Boolean(req.user),
    update: ({ req }) => Boolean(req.user),
    delete: ({ req }) => req.user?.role === 'admin',
  },

  fields: [
    { name: 'title', type: 'text', required: true },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      index: true,
      admin: { position: 'sidebar', description: 'Left blank, derived from the title.' },
      // The same field hook Posts and Categories use — hooks are portable.
      hooks: { beforeValidate: [slugFrom('title')] },
    },
    {
      name: 'layout',
      type: 'blocks',
      minRows: 1,
      labels: { singular: 'Section', plural: 'Sections' },
      admin: {
        description: 'Add, reorder and remove sections. Order here is order on the page.',
      },
      blocks: [
        {
          slug: 'hero',
          labels: { singular: 'Hero', plural: 'Heroes' },
          fields: [
            { name: 'heading', type: 'text', required: true },
            { name: 'subheading', type: 'textarea' },
            {
              name: 'align',
              type: 'select',
              defaultValue: 'left',
              options: [
                { label: 'Left', value: 'left' },
                { label: 'Centre', value: 'center' },
              ],
            },
          ],
        },
        {
          slug: 'prose',
          labels: { singular: 'Text', plural: 'Text sections' },
          fields: [
            { name: 'body', type: 'richText' },
          ],
        },
        {
          slug: 'stats',
          labels: { singular: 'Stat row', plural: 'Stat rows' },
          fields: [
            {
              name: 'items',
              type: 'array',
              minRows: 1,
              maxRows: 4,
              // An array INSIDE a block — this nests one more table deep.
              fields: [
                { name: 'value', type: 'text', required: true },
                { name: 'label', type: 'text', required: true },
              ],
            },
          ],
        },
      ],
    },
  ],

  /**
   * Deliberately NO drafts here, unlike Posts.
   *
   * Not an oversight — a demonstration. Drafts would double every one of the
   * block tables, and chapter 10 uses the contrast between Posts (drafts on)
   * and Pages (drafts off) to show the cost.
   */
  timestamps: true,
}
