import type { APIRoute } from 'astro'
import { z } from 'astro/zod'

import { getStoreReview } from '../../../lib/medusa'
import { deleteAdminReview, getAdminReview, updateAdminReview } from '../../../lib/medusa-admin'

export const prerender = false

/**
 * /api/reviews/:id — read, update, delete a single review.
 *
 * `[id].ts` gives you `params.id`, exactly as `[id].astro` would for a page.
 *
 * ── This file is where the BFF earns its keep ───────────────────────────────
 * The verbs here are the ones a client EXPECTS: PATCH to update, DELETE to
 * delete. Medusa's admin API uses POST for updates. Rather than teaching every
 * caller that quirk, the translation happens once, here.
 *
 * It also routes reads to whichever surface can answer: `?admin=true` uses the
 * authenticated surface (any status, all columns), otherwise the public one
 * (approved only). The browser never sees a credential either way.
 */

const UpdateBodySchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    content: z.string().min(10).max(4000).optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    author_name: z.string().min(1).max(120).optional(),
    author_email: z.email().nullish(),
    status: z.enum(['pending', 'approved', 'rejected']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update.',
  })

function fail(status: number, message: string, detail?: unknown): Response {
  return Response.json({ error: { message, detail } }, { status })
}

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id!
  const useAdmin = url.searchParams.get('admin') === 'true'

  try {
    if (useAdmin) {
      const { review } = await getAdminReview(id)
      return Response.json({ review, source: 'admin' })
    }

    const { review } = await getStoreReview(id)
    return Response.json({ review, source: 'store' })
  } catch (error) {
    // A pending review is a 404 on the store surface — not an error in this
    // endpoint, so report it as not-found rather than as a bad gateway.
    const message = error instanceof Error ? error.message : 'Not found'
    return fail(404, message)
  }
}

/** PATCH here → POST to Medusa. The whole point of the translation layer. */
export const PATCH: APIRoute = async ({ params, request }) => {
  const id = params.id!

  let raw: Record<string, unknown>
  const contentType = request.headers.get('content-type') ?? ''

  try {
    raw = contentType.includes('application/json')
      ? ((await request.json()) as Record<string, unknown>)
      : Object.fromEntries(await request.formData())
  } catch {
    return fail(400, 'Could not parse the request body.')
  }

  // Form submissions send every field, including blanks. Dropping empty strings
  // keeps a blank optional input from overwriting a stored value with ''.
  for (const [key, value] of Object.entries(raw)) {
    if (value === '') {
      delete raw[key]
    }
  }

  const parsed = UpdateBodySchema.safeParse(raw)

  if (!parsed.success) {
    return fail(422, 'Validation failed.', z.flattenError(parsed.error).fieldErrors)
  }

  try {
    const { review } = await updateAdminReview(id, parsed.data)
    return Response.json({ review })
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : 'Medusa rejected the update.')
  }
}

/**
 * A real HTTP DELETE — reachable from `fetch`, curl, or any HTTP client.
 *
 * Contrast with the post delete Action, which had to be a form POST because HTML
 * forms cannot issue DELETE. Two mechanisms, two constraints; that difference is
 * the clearest practical distinction between the patterns.
 */
export const DELETE: APIRoute = async ({ params }) => {
  const id = params.id!

  try {
    const result = await deleteAdminReview(id)
    return Response.json({ id: result.id, deleted: true })
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : 'Medusa rejected the delete.')
  }
}
