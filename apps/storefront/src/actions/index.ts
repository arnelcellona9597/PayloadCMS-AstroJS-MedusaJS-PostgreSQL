import { ActionError, defineAction } from 'astro:actions'
import { z } from 'astro/zod'

import { createPost, deletePost, PayloadError, updatePost } from '../lib/payload'

/**
 * ═══ PATTERN A — Astro Actions (used for Payload / posts) ═══════════════════
 *
 * An Action is a typed server function you can call three ways:
 *
 *   1. As a form target:   <form method="POST" action={actions.post.create}>
 *   2. From client JS:     const { data, error } = await actions.post.create({...})
 *   3. From another Action or endpoint
 *
 * With `accept: 'form'`, form #1 works with JavaScript DISABLED — the browser
 * posts, Astro runs the handler, redirects, and the page re-renders with the
 * result available via `Astro.getActionResult(...)`. That progressive enhancement
 * is the main argument for Actions over hand-rolled endpoints.
 *
 * You also get zod validation with FIELD-LEVEL errors for free: a failure returns
 * an error you can inspect with `isInputError(error)` to find out which input was
 * wrong, without writing any of that plumbing.
 *
 * ── Compare with PATTERN B ─────────────────────────────────────────────────
 * src/pages/api/reviews/*.ts implements the same CRUD for Medusa as real REST
 * endpoints. The trade-off in one line:
 *
 *   Actions   — typed, validated, progressive forms; callable only from THIS app
 *   Endpoints — a real HTTP surface anything can call; you write the plumbing
 *
 * ── Note on zod ────────────────────────────────────────────────────────────
 * Import from 'astro/zod', the copy Astro bundles. Using a separately installed
 * `zod` gives you two incompatible ZodType identities and confusing type errors —
 * the same trap as `@medusajs/framework/zod` on the Medusa side.
 */

/**
 * `accept: 'form'` changes how input is parsed: FormData instead of JSON.
 *
 * Three consequences that will bite you, all visible below:
 *
 *   1. EVERY value arrives as a string. `?rating=5` is "5", so numbers need
 *      `z.coerce` or an explicit transform.
 *
 *   2. An ABSENT field arrives as `null`, not `undefined`. This matters more than
 *      it sounds, because `z.string().optional()` accepts `undefined` and REJECTS
 *      `null` — so an optional field that the caller simply omitted fails
 *      validation with "expected string, received null". Use `.nullish()`, which
 *      accepts both. A browser form usually submits every field (so you may never
 *      hit this in the UI) and then a curl or fetch call that omits one blows up.
 *
 *   3. An EMPTY field arrives as `''`, not null. Passing '' straight through
 *      would store an empty string where the caller meant "no value", so each
 *      transform below normalises '' to null and lets Payload clear the field.
 */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .max(max, message)
    .nullish()
    .transform((value) => (value && value.trim() ? value.trim() : null))

const PostFields = {
  title: z.string().min(3, 'Give the post a title of at least 3 characters.').max(200),

  excerpt: optionalText(300, 'Keep the excerpt under 300 characters.'),

  body: optionalText(20000, 'That body is too long.'),

  category: z
    .string()
    .nullish()
    .transform((value) => (value && value !== '' ? Number(value) : null)),

  // `.default()` only fires for `undefined`, so a null from an omitted form
  // field would still fail the enum. Normalise it explicitly.
  status: z
    .enum(['draft', 'published'])
    .nullish()
    .transform((value) => value ?? 'draft'),
}

/** Turns a PayloadError into an ActionError so the UI shows the real reason. */
function toActionError(error: unknown): ActionError {
  if (error instanceof PayloadError) {
    return new ActionError({
      code: error.status === 403 ? 'FORBIDDEN' : error.status === 404 ? 'NOT_FOUND' : 'BAD_REQUEST',
      message: error.message,
    })
  }

  return new ActionError({
    code: 'INTERNAL_SERVER_ERROR',
    message: error instanceof Error ? error.message : 'Unknown error talking to Payload.',
  })
}

export const server = {
  post: {
    create: defineAction({
      accept: 'form',
      input: z.object(PostFields),
      handler: async (input) => {
        try {
          const post = await createPost(input)
          return { id: post.id, slug: post.slug, status: post._status }
        } catch (error) {
          throw toActionError(error)
        }
      },
    }),

    update: defineAction({
      accept: 'form',
      input: z.object({
        id: z.coerce.number(),
        ...PostFields,
      }),
      handler: async ({ id, ...fields }) => {
        try {
          const post = await updatePost(id, fields)
          return { id: post.id, slug: post.slug, status: post._status }
        } catch (error) {
          throw toActionError(error)
        }
      },
    }),

    /**
     * Delete via a form POST rather than an HTTP DELETE.
     *
     * Not a shortcut: HTML forms can only issue GET and POST. Since the point of
     * Actions here is that they work without JavaScript, the delete button has to
     * be a POST form. The Action is what makes that safe and typed.
     */
    delete: defineAction({
      accept: 'form',
      input: z.object({ id: z.coerce.number() }),
      handler: async ({ id }) => {
        try {
          await deletePost(id)
          return { id, deleted: true }
        } catch (error) {
          throw toActionError(error)
        }
      },
    }),
  },
}
