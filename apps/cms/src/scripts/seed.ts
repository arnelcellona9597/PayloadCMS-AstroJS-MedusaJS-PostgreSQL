/**
 * Seeds the CMS and prints the API key the Astro storefront needs.
 *
 *   npm run seed
 *
 * The npm script wraps this in `dotenv -e .env --` on purpose. `payload run`
 * evaluates payload.config.ts BEFORE this file's body executes, and that config
 * reads DATABASE_URL / PAYLOAD_SECRET at module-evaluation time — so calling
 * dotenv from inside this script is already too late ("missing secret key").
 * The environment has to exist before Node starts. `next dev` does this for you;
 * standalone scripts do not. Everything below uses the LOCAL API —
 * direct in-process calls, no HTTP. Note `overrideAccess` is not passed, so it
 * defaults to `true` and access control is bypassed: correct for trusted setup
 * code, and the reason seeds can create an admin before any admin exists.
 *
 * ── Content lives in guides.ts ────────────────────────────────────────────
 *
 * This file is the mechanism: find-or-create, API keys, image generation,
 * Lexical construction. The 32 guides it writes are data, in ./guides.ts.
 *
 * ── This seed DELETES before it writes ────────────────────────────────────
 *
 * The previous version skipped anything whose title already existed, which made
 * it impossible to change content: editing a guide left the old row in place and
 * silently did nothing. Posts, media and categories are now cleared first, so
 * re-running always converges on exactly what guides.ts says.
 *
 * It only clears collections this seed owns. Users are left alone — deleting the
 * admin would invalidate the API key every other service is configured with.
 */
import { randomUUID } from 'crypto'
import { readdir, rm } from 'fs/promises'
import path from 'path'

import { getPayload } from 'payload'
import config from '@payload-config'

import { toSlug } from '../hooks/slugify'
import { categorySeeds, guideSeeds } from './guides'
import { coverFilename, renderCover } from './placeholders'

const ADMIN_EMAIL = 'admin@local.test'
const ADMIN_PASSWORD = 'supersecret'

// ── Lexical ─────────────────────────────────────────────────────────────────
/**
 * Lexical stores rich text as a node tree, not HTML. These builders produce the
 * exact shape both the admin editor and the storefront renderer expect.
 *
 * ⚠️ Every element node needs `format` (a STRING, usually empty), `indent`,
 * `version` and `direction`. Text nodes need `detail`, `format` (a NUMBER — the
 * style bitmask), `mode`, `style`, `text` and `version`. Omitting any of them
 * produces a tree Payload accepts and the admin editor then fails to open.
 */
const BOLD = 1
const CODE = 16

type TextNode = {
  type: 'text'
  detail: number
  format: number
  mode: 'normal'
  style: string
  text: string
  version: number
}

const textNode = (text: string, format = 0): TextNode => ({
  type: 'text',
  detail: 0,
  format,
  mode: 'normal',
  style: '',
  text,
  version: 1,
})

/**
 * Turn `inline markup` into text nodes.
 *
 * Formatting in Lexical is a bitmask on the node, not a wrapper element, so
 * "`code`" becomes one node with format 16 rather than a node inside a `<code>`.
 * That is why a naive converter loses formatting: it looks for tags that were
 * never there.
 */
const inlineNodes = (raw: string): TextNode[] => {
  const nodes: TextNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0

  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) nodes.push(textNode(raw.slice(last, index)))

    const token = match[0]
    if (token.startsWith('`')) {
      nodes.push(textNode(token.slice(1, -1), CODE))
    } else {
      nodes.push(textNode(token.slice(2, -2), BOLD))
    }
    last = index + token.length
  }

  if (last < raw.length) nodes.push(textNode(raw.slice(last)))
  return nodes.length > 0 ? nodes : [textNode(raw)]
}

const elementBase = { format: '' as const, indent: 0, version: 1, direction: 'ltr' as const }

const paragraph = (text: string) => ({
  ...elementBase,
  type: 'paragraph' as const,
  textFormat: 0,
  children: inlineNodes(text),
})

const heading = (text: string, tag: 'h2' | 'h3') => ({
  ...elementBase,
  type: 'heading' as const,
  tag,
  children: inlineNodes(text),
})

const quote = (text: string) => ({
  ...elementBase,
  type: 'quote' as const,
  children: inlineNodes(text),
})

const horizontalRule = () => ({ type: 'horizontalrule' as const, version: 1 })

/**
 * Lists need more keys than you would guess: `listType`, `tag` and `start` on
 * the list, and `value` on each item. The storefront renderer ignores most of
 * them, but the admin editor will not open a list that is missing them.
 */
const list = (items: string[], ordered: boolean) => ({
  ...elementBase,
  type: 'list' as const,
  listType: ordered ? ('number' as const) : ('bullet' as const),
  tag: ordered ? ('ol' as const) : ('ul' as const),
  start: 1,
  children: items.map((item, i) => ({
    ...elementBase,
    type: 'listitem' as const,
    value: i + 1,
    children: inlineNodes(item),
  })),
})

/**
 * Parse the small markdown subset documented in guides.ts into a Lexical tree.
 * Consecutive list items are merged into a single list node, which is what
 * Lexical expects — one `list` with many `listitem` children, not many lists.
 */
const richText = (blocks: string[]) => {
  const children: unknown[] = []
  let pending: { items: string[]; ordered: boolean } | null = null

  const flush = () => {
    if (pending) {
      children.push(list(pending.items, pending.ordered))
      pending = null
    }
  }

  for (const block of blocks) {
    const bullet = /^- (.*)$/.exec(block)
    const numbered = /^\d+\. (.*)$/.exec(block)

    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      const item = (bullet ?? numbered)![1]
      if (pending && pending.ordered === ordered) pending.items.push(item)
      else {
        flush()
        pending = { items: [item], ordered }
      }
      continue
    }

    flush()

    if (block.startsWith('### ')) children.push(heading(block.slice(4), 'h3'))
    else if (block.startsWith('## ')) children.push(heading(block.slice(3), 'h2'))
    else if (block.startsWith('> ')) children.push(quote(block.slice(2)))
    else if (block === '---') children.push(horizontalRule())
    else children.push(paragraph(block))
  }

  flush()

  return {
    root: {
      type: 'root' as const,
      format: '' as const,
      indent: 0,
      version: 1,
      direction: 'ltr' as const,
      children,
    },
  }
}

const seed = async () => {
  const payload = await getPayload({ config })

  // ── Admin user ────────────────────────────────────────────────────────────
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: ADMIN_EMAIL } },
    limit: 1,
  })

  let adminId: string | number

  if (existing.docs.length > 0) {
    adminId = existing.docs[0].id
    payload.logger.info(`Admin already exists: ${ADMIN_EMAIL}`)
  } else {
    const admin = await payload.create({
      collection: 'users',
      data: {
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        name: 'Local Admin',
        role: 'admin',
        // Turning this on makes Payload generate `apiKey` for this user.
        enableAPIKey: true,
      },
    })
    adminId = admin.id
    payload.logger.info(`Created admin: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  }

  /**
   * Ensure the admin has a usable API key.
   *
   * Two things surprise people here:
   *   1. `enableAPIKey: true` does NOT generate a key. It only turns the feature
   *      on for that user. You have to supply the `apiKey` value yourself.
   *   2. Payload stores the key encrypted (`apiKeyIndex`), so ordinary reads
   *      return null for it. `showHiddenFields: true` is required to read it
   *      back — which is why this script prints it: it is the easiest moment to
   *      capture the plaintext.
   */
  const current = await payload.findByID({
    collection: 'users',
    id: adminId,
    showHiddenFields: true,
    depth: 0,
  })

  let apiKey = (current as { apiKey?: string | null }).apiKey ?? null

  if (!apiKey) {
    apiKey = randomUUID()
    await payload.update({
      collection: 'users',
      id: adminId,
      data: { enableAPIKey: true, apiKey },
    })
    payload.logger.info('Generated a new API key for the admin user.')
  } else {
    payload.logger.info('Reusing the existing API key.')
  }

  // ── Clear what this seed owns ─────────────────────────────────────────────
  /**
   * Order matters. Posts reference media and categories, so they go first;
   * deleting a category out from under a post would leave a dangling id.
   *
   * `id: { exists: true }` is how you say "everything" — Payload requires a
   * `where` on bulk delete rather than letting an empty object wipe a table.
   */
  for (const collection of ['posts', 'media', 'categories', 'pages'] as const) {
    const { docs } = await payload.delete({
      collection,
      where: { id: { exists: true } },
    })
    payload.logger.info(`Cleared ${collection}: ${docs.length} removed`)
  }

  /**
   * Deleting a media DOCUMENT removes its files, but files whose documents were
   * never deleted — because the database was dropped out from under them by
   * `db:reset`, which wipes the Docker volume and not the disk — survive with
   * nothing pointing at them.
   *
   * Payload will not overwrite an existing filename; it appends `-1`, then
   * `-2`. So without this the directory doubles on every reset and the live
   * documents end up pointing at `…-cover-3.png`.
   *
   * Scoped to Media.ts's `staticDir`, and only removes files.
   */
  const mediaDir = path.resolve(process.cwd(), 'public/media')
  let orphans = 0
  try {
    for (const entry of await readdir(mediaDir, { withFileTypes: true })) {
      if (entry.isFile()) {
        await rm(path.join(mediaDir, entry.name))
        orphans += 1
      }
    }
  } catch {
    // The directory does not exist yet on a fresh clone. Nothing to clear.
  }
  payload.logger.info(`Cleared media files on disk: ${orphans} removed`)

  // ── Categories ────────────────────────────────────────────────────────────
  const categoryIds: Record<string, string | number> = {}

  for (const data of categorySeeds) {
    const created = await payload.create({ collection: 'categories', data })
    categoryIds[data.name] = created.id
    payload.logger.info(`Created category: ${created.name} (${created.slug})`)
  }

  // ── Guides, each with a generated cover ───────────────────────────────────
  /**
   * Sequential rather than parallel on purpose. Each iteration rasterises a PNG
   * and writes three files (the original plus the `thumbnail` and `card`
   * derivatives sharp generates), and running 32 of those at once competes for
   * the same CPU without finishing any sooner.
   */
  let covers = 0

  for (const guide of guideSeeds) {
    const slug = toSlug(guide.title)

    const png = await renderCover({ title: guide.title, category: guide.category })
    const media = await payload.create({
      collection: 'media',
      data: { alt: `Cover image for “${guide.title}”` },
      file: {
        data: png,
        mimetype: 'image/png',
        name: coverFilename(slug),
        size: png.length,
      },
    })
    covers += 1

    const created = await payload.create({
      collection: 'posts',
      // Drafts must be written with draft:true so the version machinery
      // records them as unpublished rather than publishing immediately.
      draft: guide.status === 'draft',
      data: {
        title: guide.title,
        excerpt: guide.excerpt,
        content: richText(guide.body) as never,
        category: categoryIds[guide.category] as never,
        coverImage: media.id as never,
        tags: guide.tags.map((tag) => ({ tag })),
        /**
         * Explicit, and staggered in guides.ts. The `beforeChange` hook only
         * stamps `publishedAt` when it is missing — so without this every guide
         * would land within the same millisecond and `sort: '-publishedAt'`
         * would return them in an arbitrary order.
         */
        publishedAt: guide.publishedAt,
        _status: guide.status,
      },
    })

    payload.logger.info(`Created guide: ${created.title} [${created._status}]`)
  }

  // ── A block-built page ────────────────────────────────────────────────────
  // Demonstrates the `blocks` field: the editor chooses sections and their
  // order, and the storefront renders each type as a component.
  const published = guideSeeds.filter((g) => g.status === 'published').length

  const page = await payload.create({
    collection: 'pages',
    data: {
      title: 'About this stack',
      layout: [
        {
          blockType: 'hero',
          heading: 'Three services, one frontend',
          subheading:
            'This page was assembled from blocks in the admin. Reorder them there and reload — nothing here is hard-coded.',
          align: 'center',
        },
        {
          blockType: 'stats',
          items: [
            { value: '3', label: 'Services' },
            { value: '2', label: 'Databases' },
            { value: String(guideSeeds.length), label: 'Guides' },
            { value: String(categorySeeds.length), label: 'Categories' },
          ],
        },
        {
          blockType: 'prose',
          body: richText([
            `The posts in this CMS are a knowledge base for this stack — ${published} published guides across ${categorySeeds.length} categories, written for a developer arriving from WordPress.`,
            'Each block type above has its own Postgres table. The hero is a row in pages_blocks_hero, the stat row is a row in pages_blocks_stats, and each stat inside it is a row in pages_blocks_stats_items.',
            'That is the cost of giving editors layout control without giving them your markup. Chapter 10 of the course walks through it.',
          ]) as never,
        },
      ],
    } as never,
  })

  payload.logger.info(`Created page: ${page.title} (/pages/${page.slug})`)

  // ── Site settings (a global — exactly one record) ──────────────────────────
  await payload.updateGlobal({
    slug: 'site-settings',
    data: {
      siteName: 'Astro · Payload · Medusa',
      tagline: 'A teaching stack you can read.',
      announcement: {
        enabled: true,
        message: `${published} developer guides are published here — start with "What are Payload CMS collections?"`,
        tone: 'info',
      },
      socialLinks: [{ label: 'Course', url: '/schema' }],
    },
  })
  payload.logger.info('Updated global: site-settings')

  // ── Print what the storefront needs ───────────────────────────────────────
  /* eslint-disable no-console */
  console.log('\n' + '─'.repeat(72))
  console.log('  CMS seeded.')
  console.log('─'.repeat(72))
  console.log(`  Guides        ${guideSeeds.length} (${published} published, ${guideSeeds.length - published} draft)`)
  console.log(`  Categories    ${categorySeeds.length}`)
  console.log(`  Cover images  ${covers}`)
  console.log('')
  console.log(`  Admin panel   http://localhost:3000/admin`)
  console.log(`  Login         ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log('')
  console.log('  Put this in apps/storefront/.env :')
  console.log('')
  console.log(`  PAYLOAD_API_KEY=${apiKey}`)
  console.log('')
  console.log('  Used as:  Authorization: users API-Key <key>')
  console.log('─'.repeat(72) + '\n')
  /* eslint-enable no-console */

  process.exit(0)
}

await seed()
