import type { APIRoute } from 'astro'
import { z } from 'astro/zod'

import { updateAdminReview } from '../../../../lib/medusa-admin'

export const prerender = false

/**
 * POST /api/reviews/:id/moderate  — { "status": "approved" | "rejected" }
 *
 * Strictly speaking this is redundant: PATCH /api/reviews/:id with the same body
 * does the same thing. It exists to make a design point.
 *
 * "Approve this review" is an INTENT. "Set the status column to approved" is an
 * implementation detail. Naming the intent as its own endpoint means:
 *
 *   • the audit log reads as decisions, not column writes
 *   • extra behaviour (notify the author, recompute a rating) has an obvious home
 *   • callers cannot accidentally moderate while editing the title
 *
 * This is the same reasoning that puts Medusa's mutations in named workflows
 * rather than raw service calls. Naming the operation is what makes it
 * extensible later.
 */

const BodySchema = z.object({
  status: z.enum(['approved', 'rejected', 'pending']),
})

export const POST: APIRoute = async ({ params, request }) => {
  const id = params.id!

  let raw: Record<string, unknown>
  const contentType = request.headers.get('content-type') ?? ''

  try {
    raw = contentType.includes('application/json')
      ? ((await request.json()) as Record<string, unknown>)
      : Object.fromEntries(await request.formData())
  } catch {
    return Response.json({ error: { message: 'Could not parse the request body.' } }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(raw)

  if (!parsed.success) {
    return Response.json(
      { error: { message: 'status must be one of approved, rejected, pending.' } },
      { status: 422 },
    )
  }

  try {
    const { review } = await updateAdminReview(id, { status: parsed.data.status })

    return Response.json({ id: review.id, status: review.status, moderated: true })
  } catch (error) {
    return Response.json(
      { error: { message: error instanceof Error ? error.message : 'Moderation failed.' } },
      { status: 502 },
    )
  }
}
