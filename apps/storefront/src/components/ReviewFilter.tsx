import { useMemo, useState } from 'react'

/**
 * The ONE React island in this app.
 *
 * ── Why an island at all, when everything else is server-rendered ─────────
 *
 * Islands architecture is what Astro is known for: the page is static HTML, and
 * only the interactive bits ship JavaScript. Every other page here proves the
 * "no JavaScript" half. This proves the other half, and shows what it costs.
 *
 * ── Why THIS is a legitimate island ───────────────────────────────────────
 *
 * Filtering an already-loaded list is instant, local, and needs no server. Doing
 * it server-side would mean a round trip per keystroke, and the data is already
 * in the browser. That is the test for an island: *does interactivity require
 * client state that the server cannot pre-compute?*
 *
 * Contrast with the two patterns in src/actions and src/pages/api. Creating a
 * review must reach the server, so it is NOT island work — and making it one
 * would mean shipping validation logic twice.
 *
 * ── What it costs ─────────────────────────────────────────────────────────
 *
 * Measured on this repo's production build:
 *
 *   /_astro/client.*.js        179 kB   the React renderer
 *   /_astro/react.*.js           7 kB   shared chunk
 *   /_astro/ReviewFilter.*.js    2 kB   this component
 *   ─────────────────────────────────
 *                              188 kB   uncompressed, for one filter box
 *
 * Against /posts, which does full CRUD — create, edit, delete — and ships
 * **0 bytes** of JavaScript.
 *
 * Reproduce it:
 *
 *   npm run build && PORT=4399 node dist/server/entry.mjs
 *   curl -s localhost:4399/reviews | grep -oE 'component-url="[^"]+"|renderer-url="[^"]+"'
 *
 * Note the JS is referenced by `astro-island` ATTRIBUTES, not a <script src>, so
 * counting script tags undercounts badly — /reviews reports just 1.
 *
 * The lesson is not "islands are bad" — it is that `client:*` is a bill, and you
 * should know the amount before signing.
 */

export type FilterableReview = {
  id: string
  title: string
  content: string
  author_name: string
  rating: number
  status: 'pending' | 'approved' | 'rejected'
}

type Props = {
  reviews: FilterableReview[]
}

const STATUSES = ['all', 'approved', 'pending', 'rejected'] as const

export default function ReviewFilter({ reviews }: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all')
  const [minRating, setMinRating] = useState(0)

  /**
   * `useMemo` so filtering does not re-run on unrelated re-renders. With eleven
   * rows it is unnecessary; with a thousand it is not, and the habit is cheap.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()

    return reviews.filter((review) => {
      if (status !== 'all' && review.status !== status) return false
      if (review.rating < minRating) return false
      if (!q) return true

      return (
        review.title.toLowerCase().includes(q) ||
        review.content.toLowerCase().includes(q) ||
        review.author_name.toLowerCase().includes(q)
      )
    })
  }, [reviews, query, status, minRating])

  return (
    <div className="rf">
      <div className="rf-controls">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title, text or author…"
          aria-label="Filter reviews"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
          aria-label="Filter by status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'Any status' : s}
            </option>
          ))}
        </select>

        <select
          value={minRating}
          onChange={(e) => setMinRating(Number(e.target.value))}
          aria-label="Minimum rating"
        >
          <option value={0}>Any rating</option>
          {[5, 4, 3, 2, 1].map((n) => (
            <option key={n} value={n}>
              {n}★ and up
            </option>
          ))}
        </select>
      </div>

      <p className="rf-count">
        {filtered.length} of {reviews.length} shown
        {filtered.length !== reviews.length && (
          <button
            type="button"
            className="rf-reset"
            onClick={() => {
              setQuery('')
              setStatus('all')
              setMinRating(0)
            }}
          >
            reset
          </button>
        )}
      </p>

      {filtered.length === 0 ? (
        <p className="rf-empty">Nothing matches. Try a broader filter.</p>
      ) : (
        <ul className="rf-list">
          {filtered.map((review) => (
            <li key={review.id}>
              <span className={`badge ${review.status}`}>{review.status}</span>
              <span className="rf-title">{review.title}</span>
              <span className="rf-stars">{'★'.repeat(review.rating)}</span>
              <span className="rf-author">{review.author_name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
