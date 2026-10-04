import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { DetailWidgetProps, AdminProduct } from "@medusajs/framework/types"
import {
  Badge,
  Button,
  Container,
  Heading,
  Text,
  Table,
  toast,
} from "@medusajs/ui"
import { useEffect, useState } from "react"

type Review = {
  id: string
  title: string
  content: string
  rating: number
  author_name: string
  author_email: string | null
  status: "pending" | "approved" | "rejected"
  created_at: string
}

const STATUS_COLOR = {
  approved: "green",
  pending: "orange",
  rejected: "red",
} as const

/**
 * A moderation panel injected into the admin's product detail page.
 *
 * ── How admin extensions work ──────────────────────────────────────────────
 * Medusa's dashboard is a React app that scans `src/admin/widgets/**` at build
 * time. A file becomes a widget by default-exporting a component and exporting a
 * `defineWidgetConfig({ zone })`. The `zone` string names a declared insertion
 * point — here, after the product details card.
 *
 * You are NOT forking or patching the dashboard. Your component is compiled into
 * it, which is why upgrading Medusa does not break this file as long as the zone
 * still exists.
 *
 * ── The fetch calls ────────────────────────────────────────────────────────
 * Requests go to `/admin/reviews`, the routes in src/api/admin/. Note there is no
 * Authorization header anywhere below: the dashboard is a browser session, so the
 * auth cookie rides along automatically — `credentials: "include"` is the only
 * thing needed. That is the same session mechanism the Astro storefront cannot
 * use, which is why it logs in for a JWT instead.
 */
const ProductReviewsWidget = ({ data: product }: DetailWidgetProps<AdminProduct>) => {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/admin/reviews?product_id=${product.id}&limit=100&order=-created_at`,
        { credentials: "include" }
      )
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status}`)
      }
      const body = await res.json()
      setReviews(body.reviews ?? [])
    } catch (error) {
      toast.error("Could not load reviews", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [product.id])

  const moderate = async (id: string, status: Review["status"]) => {
    setBusyId(id)
    try {
      // POST, not PATCH — Medusa's admin convention for updates.
      const res = await fetch(`/admin/reviews/${id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status}`)
      }
      toast.success(`Review ${status}`)
      await load()
    } catch (error) {
      toast.error("Could not update review", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/admin/reviews/${id}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (!res.ok) {
        throw new Error(`Request failed with ${res.status}`)
      }
      toast.success("Review deleted (soft — the row is still in Postgres)")
      await load()
    } catch (error) {
      toast.error("Could not delete review", {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusyId(null)
    }
  }

  const approved = reviews.filter((r) => r.status === "approved")
  const average = approved.length
    ? Math.round((approved.reduce((sum, r) => sum + r.rating, 0) / approved.length) * 10) / 10
    : 0

  return (
    <Container className="divide-y p-0">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <Heading level="h2">Reviews</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            {reviews.length} total · {approved.length} approved
            {approved.length > 0 ? ` · ${average}★ average` : ""}
          </Text>
        </div>
        <Button size="small" variant="secondary" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {!loading && reviews.length === 0 && (
        <div className="px-6 py-8">
          <Text size="small" className="text-ui-fg-subtle">
            No reviews linked to this product yet. Run{" "}
            <code>npm run seed:reviews</code> in apps/commerce, or POST one to{" "}
            <code>/store/reviews</code>.
          </Text>
        </div>
      )}

      {reviews.length > 0 && (
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>Review</Table.HeaderCell>
              <Table.HeaderCell>Rating</Table.HeaderCell>
              <Table.HeaderCell>Status</Table.HeaderCell>
              <Table.HeaderCell className="text-right">Actions</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {reviews.map((review) => (
              <Table.Row key={review.id}>
                <Table.Cell>
                  <Text weight="plus" size="small">
                    {review.title}
                  </Text>
                  <Text size="small" className="text-ui-fg-subtle line-clamp-2">
                    {review.content}
                  </Text>
                  <Text size="xsmall" className="text-ui-fg-muted">
                    {review.author_name}
                    {review.author_email ? ` · ${review.author_email}` : ""}
                  </Text>
                </Table.Cell>
                <Table.Cell>{"★".repeat(review.rating)}</Table.Cell>
                <Table.Cell>
                  <Badge size="2xsmall" color={STATUS_COLOR[review.status]}>
                    {review.status}
                  </Badge>
                </Table.Cell>
                <Table.Cell className="text-right">
                  <div className="flex justify-end gap-2">
                    {review.status !== "approved" && (
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === review.id}
                        onClick={() => moderate(review.id, "approved")}
                      >
                        Approve
                      </Button>
                    )}
                    {review.status !== "rejected" && (
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={busyId === review.id}
                        onClick={() => moderate(review.id, "rejected")}
                      >
                        Reject
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="danger"
                      disabled={busyId === review.id}
                      onClick={() => remove(review.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      )}
    </Container>
  )
}

/**
 * The zone determines where this renders. Other useful zones follow the same
 * `<entity>.<page>.<position>` shape, e.g. `order.details.before`,
 * `customer.details.after`, `product.list.before`.
 */
export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductReviewsWidget
